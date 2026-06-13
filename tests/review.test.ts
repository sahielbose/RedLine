/**
 * Trust layer - INTEGRATION test (spec §6, §7, §8, §14).
 *
 * Hits a REAL Postgres, so it is gated behind RUN_DB_TESTS: with no flag set the
 * whole suite is skipped and NO socket is opened, keeping the default gate
 * (`npm run test`) fully hermetic (only tests/audit.test.ts runs without a DB).
 *
 * To run it (requires Docker + a migrated DB):
 *
 *     npm run db:up && npm run db:migrate
 *     RUN_DB_TESTS=1 npm run test
 *
 * It exercises the full approval-gate lifecycle:
 *   seed org + user + item → persistJudgment → persistMemoDraft (asserts status
 *   "draft" + a "memo.draft.created" audit row) → approveMemo (asserts approved +
 *   approver + approved_at + a "memo.approved" audit row with before/after) →
 *   approveMemo on a non-draft throws → markSent only from approved. It cleans up
 *   every row it creates (FK-safe order) and closes the pool.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { closeDb, getDb } from "@/lib/db";
import { contentHashFor } from "@/lib/hash";
import { env } from "@/lib/env";
import { persistJudgment, persistMemoDraft } from "@/pipeline/persist";
import { approveMemo, listDraftMemos, markSent, rejectMemo } from "@/pipeline/review";
import { PROMPT_VERSION, RUBRIC_VERSION, type MemoContent } from "@/lib/types";
import { HEURISTIC_MODEL } from "@/lib/adapters/heuristicLLM";
import {
  auditLog,
  items,
  memos,
  organizations,
  relevanceJudgments,
  users,
} from "@db/schema";

const RUN = Boolean(process.env.RUN_DB_TESTS);

// Clearly-scoped synthetic identifiers so cleanup never touches real data.
const TEST_ORG_NAME = "REDLINE-TEST-REVIEW-ORG";
const TEST_USER_EMAIL = "redline-test-review@example.invalid";
const TEST_SOURCE = "federal_register" as const;
const TEST_EXTERNAL_ID = "REDLINE-TEST-REVIEW-ITEM-1";

const sampleMemo: MemoContent = {
  what_it_does: "Suspends duty-free de minimis treatment for imported goods.",
  status_and_next_steps: "Effective now; monitor CBP guidance for entry requirements.",
  who_is_affected: "Importers of physical goods under the prior de minimis threshold.",
  recommended_action: "monitor",
  recommended_action_note: "Review your import volumes and customs broker arrangements.",
  impact_estimate: null, // no bare fabricated figure (spec §15)
  citations: [
    {
      claim: "Duty-free de minimis treatment is suspended.",
      snippet: "duty-free de minimis treatment is suspended",
      locator: null,
      verified: true,
    },
  ],
  confidence: "medium",
};

describe.skipIf(!RUN)("Trust layer: persist + approval gate + audit (integration, RUN_DB_TESTS)", () => {
  const db = getDb();

  // Seeded ids, captured per-test in beforeEach.
  let orgId = "";
  let userId = "";
  let itemId = "";

  /** Remove every row this test creates, in FK-safe order. Idempotent. */
  async function cleanup(): Promise<void> {
    // Find our org (if any) to scope child deletes precisely.
    const orgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.name, TEST_ORG_NAME));

    for (const o of orgs) {
      await db.delete(auditLog).where(eq(auditLog.orgId, o.id));
      await db.delete(memos).where(eq(memos.orgId, o.id));
      await db.delete(relevanceJudgments).where(eq(relevanceJudgments.orgId, o.id));
      await db.delete(users).where(eq(users.orgId, o.id));
    }
    // Item is keyed by (source, external_id), org-independent.
    await db
      .delete(items)
      .where(and(eq(items.source, TEST_SOURCE), eq(items.externalId, TEST_EXTERNAL_ID)));
    for (const o of orgs) {
      await db.delete(organizations).where(eq(organizations.id, o.id));
    }
  }

  async function seed(): Promise<void> {
    const [org] = await db
      .insert(organizations)
      .values({ name: TEST_ORG_NAME })
      .returning({ id: organizations.id });
    orgId = org!.id;

    const [user] = await db
      .insert(users)
      .values({ orgId, email: TEST_USER_EMAIL, role: "admin" })
      .returning({ id: users.id });
    userId = user!.id;

    const base = {
      source: TEST_SOURCE,
      externalId: TEST_EXTERNAL_ID,
      jurisdiction: "us",
      type: "notice",
      identifier: "FR-REVIEW-TEST-1",
      title: "Suspension of de minimis treatment (test)",
      summary: "Our own paraphrased summary for the review test.",
      raw: { external_id: TEST_EXTERNAL_ID },
    };
    const [item] = await db
      .insert(items)
      .values({
        ...base,
        contentHash: contentHashFor(base),
        // embedding width must match the configured dimension or pgvector rejects it.
        embedding: Array.from({ length: env().EMBED_DIM }, () => 0),
      })
      .returning({ id: items.id });
    itemId = item!.id;
  }

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  it("persists a judgment and returns its id", async () => {
    const judgmentId = await persistJudgment(db, {
      orgId,
      itemId,
      stage: "llm_judge",
      score: 5,
      similarity: 0.82,
      justification: "Directly suspends de minimis treatment this importer relies on.",
      matchedConcern: "imports_goods",
      model: HEURISTIC_MODEL,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
    });
    expect(judgmentId).toMatch(/[0-9a-f-]{36}/);

    const rows = await db
      .select()
      .from(relevanceJudgments)
      .where(eq(relevanceJudgments.id, judgmentId));
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(5);
    expect(rows[0].stage).toBe("llm_judge");
    expect(rows[0].rubricVersion).toBe(RUBRIC_VERSION);
  });

  it("persistMemoDraft writes a DRAFT memo and a memo.draft.created audit row", async () => {
    const judgmentId = await persistJudgment(db, {
      orgId,
      itemId,
      stage: "llm_judge",
      score: 5,
    });

    const memoId = await persistMemoDraft(db, {
      orgId,
      itemId,
      judgmentId,
      memo: sampleMemo,
      model: HEURISTIC_MODEL,
      promptVersion: PROMPT_VERSION,
    });

    const memoRows = await db.select().from(memos).where(eq(memos.id, memoId));
    expect(memoRows).toHaveLength(1);
    const memo = memoRows[0];
    // Approval gate: born "draft", no approver, no fabricated figure.
    expect(memo.status).toBe("draft");
    expect(memo.approvedBy).toBeNull();
    expect(memo.approvedAt).toBeNull();
    expect(memo.impactEstimate).toBeNull();
    expect(memo.recommendedAction).toBe("monitor");
    expect(memo.judgmentId).toBe(judgmentId);
    // citations persisted as jsonb.
    expect(Array.isArray(memo.citations)).toBe(true);
    expect((memo.citations as unknown[]).length).toBe(1);

    // Audit: exactly one create row, actor "system", before null / after present.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, memoId), eq(auditLog.action, "memo.draft.created")));
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("system");
    expect(audits[0].entityType).toBe("memo");
    expect(audits[0].before).toBeNull();
    expect(audits[0].after).not.toBeNull();
    expect((audits[0].after as { status?: string }).status).toBe("draft");

    // listDraftMemos surfaces it with item context.
    const drafts = await listDraftMemos(db, orgId);
    expect(drafts.some((d) => d.memo.id === memoId)).toBe(true);
    const entry = drafts.find((d) => d.memo.id === memoId)!;
    expect(entry.item.id).toBe(itemId);
    expect(entry.item.identifier).toBe("FR-REVIEW-TEST-1");
    expect(entry.item.title).toContain("de minimis");
  });

  it("approveMemo moves draft → approved, sets approver, and audits before/after", async () => {
    const memoId = await persistMemoDraft(db, { orgId, itemId, memo: sampleMemo });

    const approved = await approveMemo(db, { memoId, userId });
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(userId);
    expect(approved.approvedAt).not.toBeNull();

    // No longer in the draft queue.
    const drafts = await listDraftMemos(db, orgId);
    expect(drafts.some((d) => d.memo.id === memoId)).toBe(false);

    // Audit: a memo.approved row, actor = the human, before "draft" / after "approved".
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, memoId), eq(auditLog.action, "memo.approved")));
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe(userId);
    expect((audits[0].before as { status?: string }).status).toBe("draft");
    expect((audits[0].after as { status?: string }).status).toBe("approved");
  });

  it("approveMemo on a non-draft memo throws (approval-gate guard)", async () => {
    const memoId = await persistMemoDraft(db, { orgId, itemId, memo: sampleMemo });
    await approveMemo(db, { memoId, userId }); // now "approved"

    await expect(approveMemo(db, { memoId, userId })).rejects.toThrow(/status is "approved"/);
  });

  it("rejectMemo moves draft → rejected and audits; markSent rejects a non-approved memo", async () => {
    const memoId = await persistMemoDraft(db, { orgId, itemId, memo: sampleMemo });

    const rejected = await rejectMemo(db, { memoId, userId });
    expect(rejected.status).toBe("rejected");
    expect(rejected.approvedBy).toBeNull();

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, memoId), eq(auditLog.action, "memo.rejected")));
    expect(audits).toHaveLength(1);

    // A rejected memo can never be sent (only approved → sent).
    await expect(markSent(db, { memoId })).rejects.toThrow(/expected "approved"/);
  });

  it("markSent moves approved → sent ONLY (nothing auto-sends)", async () => {
    const memoId = await persistMemoDraft(db, { orgId, itemId, memo: sampleMemo });

    // A fresh draft cannot be sent directly.
    await expect(markSent(db, { memoId })).rejects.toThrow(/expected "approved"/);

    await approveMemo(db, { memoId, userId });
    const sent = await markSent(db, { memoId });
    expect(sent.status).toBe("sent");

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, memoId), eq(auditLog.action, "memo.sent")));
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("system");
  });
});
