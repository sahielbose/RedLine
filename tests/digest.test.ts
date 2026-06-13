/**
 * Digest tests (spec §3 Delivery, §8 trust, §14 Phase 4).
 *
 * Two layers:
 *   - PURE/hermetic (always runs): buildDigestHtml renders only the provided
 *     approved items, HTML-escapes external copy, is severity-ordered, owns its
 *     own copy (no fabricated $ figure / probability / vote count), and the
 *     footer states the approved-only trust guarantee.
 *   - INTEGRATION (gated behind RUN_DB_TESTS): sendDigest sends APPROVED-ONLY
 *     and then marks each included memo "sent" (approved → sent); with no
 *     approved memos it does NOT send. Skipped (no socket opened) by default, so
 *     the default gate stays hermetic.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { buildDigestHtml, sendDigest, type DigestItem } from "@/pipeline/digest";
import type { Mailer } from "@/lib/interfaces";

// ── PURE: buildDigestHtml ──────────────────────────────────────────────────────

const sampleItems: DigestItem[] = [
  {
    identifier: "FR-2025-14967",
    title: "FDA FSMA 204 Food Traceability Rule",
    severity: "High",
    score: 4,
    jurisdiction: "us",
    whatItDoes: "Extends the compliance date for the food traceability recordkeeping rule.",
    recommendedAction: "monitor",
    actionUrl: "https://www.federalregister.gov/example",
    commentCloseDate: "2026-07-20",
  },
  {
    identifier: "CBP-321",
    title: "Suspension of de minimis treatment for imported goods",
    severity: "Critical",
    score: 5,
    jurisdiction: "us",
    whatItDoes: "Suspends duty-free de minimis treatment; all imports owe duties.",
    recommendedAction: "call_counsel",
    actionUrl: "https://www.cbp.gov/example",
  },
  {
    identifier: "CTA-BOI",
    title: "Beneficial-ownership reporting interim rule",
    severity: "Monitor",
    score: 3,
    jurisdiction: "us",
  },
];

describe("buildDigestHtml (pure)", () => {
  const html = buildDigestHtml({
    orgLabel: "Acme SaaS",
    periodLabel: "Daily digest · Jun 11 2026",
    items: sampleItems,
  });

  it("renders a self-contained HTML document with the RedLine brand + period", () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("</html>");
    expect(html).toContain("RedLine");
    expect(html).toContain("Daily digest · Jun 11 2026");
    expect(html).toContain("Acme SaaS");
  });

  it("renders every provided approved item (title + identifier)", () => {
    for (const item of sampleItems) {
      expect(html).toContain(item.title);
      if (item.identifier) expect(html).toContain(item.identifier);
    }
    // Header count reflects the provided items.
    expect(html).toContain("3 approved items this period.");
  });

  it("orders items most-severe first (Critical before High before Monitor)", () => {
    const idxCritical = html.indexOf("de minimis treatment for imported goods");
    const idxHigh = html.indexOf("FDA FSMA 204 Food Traceability Rule");
    const idxMonitor = html.indexOf("Beneficial-ownership reporting interim rule");
    expect(idxCritical).toBeGreaterThan(-1);
    expect(idxCritical).toBeLessThan(idxHigh);
    expect(idxHigh).toBeLessThan(idxMonitor);
  });

  it("shows only provided fields - omits action/comment-date when absent", () => {
    // The Monitor item has no actionUrl and no commentCloseDate; render only what
    // we were given (no placeholder, no invented value).
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
    // commentCloseDate appears only for the item that has one.
    const closeMatches = html.match(/Comment closes:/g) ?? [];
    expect(closeMatches).toHaveLength(1);
    expect(html).toContain("2026-07-20");
  });

  it("links recommended actions to the provided official URL (no PII)", () => {
    expect(html).toContain('href="https://www.cbp.gov/example"');
    expect(html).toContain('href="https://www.federalregister.gov/example"');
    // recommended_action is humanized (underscores → spaces).
    expect(html).toContain("call counsel");
  });

  it("HTML-escapes external copy (titles are never trusted as markup)", () => {
    const evil = buildDigestHtml({
      orgLabel: "Acme",
      periodLabel: "Weekly",
      items: [
        {
          identifier: "<script>",
          title: 'Bill & "quote" <script>alert(1)</script>',
          severity: "High",
          whatItDoes: "Body with <b>tags</b> & ampersand.",
        },
      ],
    });
    // The raw injection must not survive as live markup.
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(evil).toContain("Bill &amp; &quot;quote&quot;");
    expect(evil).toContain("&lt;b&gt;tags&lt;/b&gt; &amp; ampersand.");
  });

  it("contains NO bare $ dollar figure anywhere (no fabricated impact - spec §15)", () => {
    // No "$" followed by a digit, in our copy OR rendered from items.
    expect(html).not.toMatch(/\$\s*\d/);
    // And no fabricated probability/vote-count phrasing in our own copy.
    expect(html.toLowerCase()).not.toContain("likely yes");
    expect(html.toLowerCase()).not.toContain("% chance");
  });

  it("footer states the digest contains only human-APPROVED items", () => {
    const lower = html.toLowerCase();
    expect(lower).toContain("approved");
    expect(lower).toContain("only");
    // The trust promise: nothing sent automatically.
    expect(lower).toContain("nothing is sent automatically");
  });

  it("renders a directive empty state (no items) without sending fabricated copy", () => {
    const empty = buildDigestHtml({ orgLabel: "Acme", periodLabel: "Weekly", items: [] });
    expect(empty).toContain("0 approved items this period.");
    expect(empty).toContain("No approved items this period.");
    expect(empty).not.toMatch(/\$\s*\d/);
    // Footer guarantee still present.
    expect(empty.toLowerCase()).toContain("approved");
  });

  it("uses the score as the severity stamp when no explicit severity is given", () => {
    const scored = buildDigestHtml({
      orgLabel: "Acme",
      periodLabel: "Weekly",
      items: [{ identifier: "X-1", title: "Scored item", score: 5 }],
    });
    expect(scored).toContain("Critical");
    expect(scored).toContain("5/5");
  });
});

// ── INTEGRATION: sendDigest (RUN_DB_TESTS) ──────────────────────────────────────

const RUN = Boolean(process.env.RUN_DB_TESTS);

describe.skipIf(!RUN)("sendDigest - approved-only delivery (integration, RUN_DB_TESTS)", () => {
  // Lazy imports so the hermetic suite never touches the DB layer.
  let getDb: typeof import("@/lib/db").getDb;
  let closeDb: typeof import("@/lib/db").closeDb;
  let env: typeof import("@/lib/env").env;
  let contentHashFor: typeof import("@/lib/hash").contentHashFor;
  let approveMemo: typeof import("@/pipeline/review").approveMemo;
  let persistMemoDraft: typeof import("@/pipeline/persist").persistMemoDraft;
  let schema: typeof import("@db/schema");

  const TEST_ORG_NAME = "REDLINE-TEST-DIGEST-ORG";
  const TEST_USER_EMAIL = "redline-test-digest@example.invalid";
  const TEST_SOURCE = "federal_register" as const;
  const TEST_EXTERNAL_ID = "REDLINE-TEST-DIGEST-ITEM-1";

  let db: import("@/lib/db").Database;
  let orgId = "";
  let userId = "";
  let itemId = "";

  const memo = {
    what_it_does: "Suspends duty-free de minimis treatment for imported goods.",
    status_and_next_steps: "Effective now; monitor CBP guidance for entry requirements.",
    who_is_affected: "Importers of physical goods under the prior de minimis threshold.",
    recommended_action: "monitor" as const,
    recommended_action_note: "Review your import volumes and customs broker arrangements.",
    impact_estimate: null,
    citations: [],
    confidence: "medium" as const,
  };

  async function cleanup(): Promise<void> {
    const { auditLog, items, memos, organizations, relevanceJudgments, users } = schema;
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
    await db
      .delete(items)
      .where(and(eq(items.source, TEST_SOURCE), eq(items.externalId, TEST_EXTERNAL_ID)));
    for (const o of orgs) {
      await db.delete(organizations).where(eq(organizations.id, o.id));
    }
  }

  async function seed(): Promise<void> {
    const { items, organizations, users } = schema;
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
      identifier: "FR-DIGEST-TEST-1",
      title: "Suspension of de minimis treatment (test)",
      summary: "Our own paraphrased summary for the digest test.",
      fullTextUrl: "https://www.federalregister.gov/example-digest",
      commentCloseDate: "2026-07-20",
      raw: { external_id: TEST_EXTERNAL_ID },
    };
    const [item] = await db
      .insert(items)
      .values({
        ...base,
        contentHash: contentHashFor(base),
        embedding: Array.from({ length: env().EMBED_DIM }, () => 0),
      })
      .returning({ id: items.id });
    itemId = item!.id;
  }

  beforeEach(async () => {
    ({ getDb, closeDb } = await import("@/lib/db"));
    ({ env } = await import("@/lib/env"));
    ({ contentHashFor } = await import("@/lib/hash"));
    ({ approveMemo } = await import("@/pipeline/review"));
    ({ persistMemoDraft } = await import("@/pipeline/persist"));
    schema = await import("@db/schema");
    db = getDb();
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    if (db) await cleanup();
    if (closeDb) await closeDb();
  });

  it("does NOT send when there are no approved memos (skipped result)", async () => {
    const send = vi.fn(async () => {});
    const mailer: Mailer = { send };
    const result = await sendDigest(db, mailer, { orgId, to: "owner@example.invalid", periodLabel: "Daily" });
    expect(result.sent).toBe(false);
    expect(result.skippedReason).toBe("no_approved_memos");
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT send when only a DRAFT memo exists (draft never delivered)", async () => {
    await persistMemoDraft(db, { orgId, itemId, memo });
    const send = vi.fn(async () => {});
    const result = await sendDigest(db, { send }, { orgId, to: "owner@example.invalid", periodLabel: "Daily" });
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends approved memos and marks each approved → sent", async () => {
    const { memos } = schema;
    const memoId = await persistMemoDraft(db, { orgId, itemId, memo });
    await approveMemo(db, { memoId, userId });

    const send = vi.fn<Mailer["send"]>(async () => {});
    const result = await sendDigest(db, { send }, {
      orgId,
      to: "owner@example.invalid",
      periodLabel: "Daily digest",
      orgLabel: "Acme SaaS",
    });

    expect(result.sent).toBe(true);
    expect(result.memoIds).toContain(memoId);
    expect(send).toHaveBeenCalledTimes(1);

    // The HTML actually rendered the approved item + footer guarantee.
    const arg = send.mock.calls[0]![0];
    expect(arg.to).toBe("owner@example.invalid");
    expect(arg.subject).toContain("Daily digest");
    expect(arg.html).toContain("de minimis");
    expect(arg.html.toLowerCase()).toContain("approved");

    // The memo is now "sent" (approved → sent), removed from the approved set.
    const rows = await db.select().from(memos).where(eq(memos.id, memoId));
    expect(rows[0]!.status).toBe("sent");

    // A second run finds nothing approved → does not re-send.
    const second = await sendDigest(db, { send }, { orgId, to: "owner@example.invalid", periodLabel: "Daily" });
    expect(second.sent).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
