/**
 * Review queue - the approval gate (spec §8, CLAUDE.md rule 10).
 *
 * Memos are born "draft" (see src/pipeline/persist.ts). NOTHING leaves RedLine
 * without a human acting here: a person approves or rejects a draft, and only an
 * APPROVED memo can later be marked "sent" by the digest - there is no auto-send.
 *
 * The legal state machine (memos.status):
 *
 *     draft ──approveMemo──▶ approved ──markSent──▶ sent
 *       │
 *       └──rejectMemo──▶ rejected
 *
 * Every mutation:
 *   1. reads the prior row (the audit BEFORE-image - never reconstructed),
 *   2. guards the transition (throws a clear error from a non-legal source state),
 *   3. updates the row, and
 *   4. writes an `audit_log` row with before AND after (spec §6, §8).
 *
 * `userId` is the acting human's uuid → recorded as the audit `actor` and, for
 * approval, persisted to `memos.approved_by`. Timestamps come from `now()` (the
 * DB clock) - we never fabricate a time.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/lib/db";
import { buildAuditEntry, recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import type { MemoStatus } from "@/lib/types";
import type { Memo } from "@db/schema";
import { items, memos } from "@db/schema";

/** Public entry points take the top-level client; mutations run in a transaction. */
type Db = Database;

/** A draft memo joined with enough item context for the review UI. */
export interface DraftMemoListItem {
  memo: Memo;
  item: {
    id: string;
    title: string;
    identifier: string | null;
    jurisdiction: string;
    source: string;
  };
}

/**
 * List the org's DRAFT memos, newest first, each joined to its item so the
 * review queue can show a title + identifier. Only status = "draft" appears -
 * approved/rejected/sent memos have left the queue.
 */
export async function listDraftMemos(db: Db, orgId: string): Promise<DraftMemoListItem[]> {
  const rows = await db
    .select({
      memo: memos,
      itemId: items.id,
      itemTitle: items.title,
      itemIdentifier: items.identifier,
      itemJurisdiction: items.jurisdiction,
      itemSource: items.source,
    })
    .from(memos)
    .innerJoin(items, eq(memos.itemId, items.id))
    .where(and(eq(memos.orgId, orgId), eq(memos.status, "draft")))
    .orderBy(desc(memos.createdAt));

  return rows.map((r) => ({
    memo: r.memo,
    item: {
      id: r.itemId,
      title: r.itemTitle,
      identifier: r.itemIdentifier,
      jurisdiction: r.itemJurisdiction,
      source: r.itemSource,
    },
  }));
}

/** Read a memo row by id, or throw a clear not-found error. Accepts a tx. */
async function loadMemo(db: DbExecutor, memoId: string): Promise<Memo> {
  const rows = await db.select().from(memos).where(eq(memos.id, memoId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Memo not found: ${memoId}`);
  return row;
}

/** Throw a clear error if a memo is not in the required source state. */
function assertStatus(memo: Memo, expected: MemoStatus, action: string): void {
  if (memo.status !== expected) {
    throw new Error(
      `Cannot ${action} memo ${memo.id}: status is "${memo.status}", expected "${expected}". ` +
        `(approval-gate state machine, spec §8)`,
    );
  }
}

export interface ApproveMemoArgs {
  memoId: string;
  /** The approving human's user uuid (→ approved_by + audit actor). */
  userId: string;
}

/**
 * Approve a DRAFT memo: status → "approved", approved_by = userId, approved_at =
 * now(). Writes a "memo.approved" audit row (before = draft row, after = approved
 * row). Throws if the memo is not currently "draft" (you can only approve a draft).
 */
export async function approveMemo(db: Db, { memoId, userId }: ApproveMemoArgs): Promise<Memo> {
  // The status change and its audit row commit ATOMICALLY - a crash can never
  // leave a state change without its audit_log entry (spec §8 guarantee).
  return db.transaction(async (tx) => {
    const before = await loadMemo(tx, memoId);
    assertStatus(before, "draft", "approve");

    const updated = await tx
      .update(memos)
      .set({ status: "approved", approvedBy: userId, approvedAt: sql`now()` })
      .where(eq(memos.id, memoId))
      .returning();

    const after = updated[0];
    if (!after) throw new Error(`approveMemo: no row returned updating memo ${memoId}`);

    await recordAudit(
      tx,
      buildAuditEntry({
        orgId: after.orgId,
        actor: userId,
        action: "memo.approved",
        entityType: "memo",
        entityId: after.id,
        before,
        after,
      }),
    );

    return after;
  });
}

export interface RejectMemoArgs {
  memoId: string;
  /** The rejecting human's user uuid (→ audit actor). */
  userId: string;
}

/**
 * Reject a DRAFT memo: status → "rejected". Writes a "memo.rejected" audit row
 * (before/after). Throws if the memo is not currently "draft". A rejected memo
 * carries no approver and never sends.
 */
export async function rejectMemo(db: Db, { memoId, userId }: RejectMemoArgs): Promise<Memo> {
  return db.transaction(async (tx) => {
    const before = await loadMemo(tx, memoId);
    assertStatus(before, "draft", "reject");

    const updated = await tx
      .update(memos)
      .set({ status: "rejected" })
      .where(eq(memos.id, memoId))
      .returning();

    const after = updated[0];
    if (!after) throw new Error(`rejectMemo: no row returned updating memo ${memoId}`);

    await recordAudit(
      tx,
      buildAuditEntry({
        orgId: after.orgId,
        actor: userId,
        action: "memo.rejected",
        entityType: "memo",
        entityId: after.id,
        before,
        after,
      }),
    );

    return after;
  });
}

export interface MarkSentArgs {
  memoId: string;
}

/**
 * Mark an APPROVED memo as "sent" - called by the digest AFTER human approval.
 * Status moves "approved" → "sent" ONLY; throws from any other state. This is
 * the code-level guarantee that nothing auto-sends: a memo cannot reach "sent"
 * without having first passed through human {@link approveMemo}.
 *
 * Actor is "system" - the delivery job marks the send; the human authorization
 * already happened at approval time (recorded in that memo.approved audit row).
 */
export async function markSent(db: Db, { memoId }: MarkSentArgs): Promise<Memo> {
  return db.transaction(async (tx) => {
    const before = await loadMemo(tx, memoId);
    assertStatus(before, "approved", "send");

    const updated = await tx
      .update(memos)
      .set({ status: "sent" })
      .where(eq(memos.id, memoId))
      .returning();

    const after = updated[0];
    if (!after) throw new Error(`markSent: no row returned updating memo ${memoId}`);

    await recordAudit(
      tx,
      buildAuditEntry({
        orgId: after.orgId,
        actor: SYSTEM_ACTOR,
        action: "memo.sent",
        entityType: "memo",
        entityId: after.id,
        before,
        after,
      }),
    );

    return after;
  });
}
