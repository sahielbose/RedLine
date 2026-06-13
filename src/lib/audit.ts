/**
 * Audit log - the trust layer's tamper-evident change record (spec §6, §8).
 *
 * Every state change in RedLine writes an `audit_log` row capturing BOTH the
 * before-image and the after-image of the affected entity. That is the trust
 * feature (you can reconstruct who changed what, when) and the debugger.
 *
 * Two pieces, deliberately split so the shape is hermetically testable:
 *   - `buildAuditEntry(...)` is PURE - it maps its arguments to a plain object
 *     matching the §6 `audit_log` columns (camelCase, Drizzle-insert shape). No
 *     I/O, no clock, no DB. Tests assert the shape with zero infrastructure.
 *   - `recordAudit(db, entry)` is a thin insert that persists one row, letting
 *     the DB default `created_at = now()` (we never fabricate a timestamp).
 *
 * `actor` is a user uuid (the approver/rejecter) or the literal string
 * "system" for pipeline-driven changes (e.g. a draft the engine created).
 */
import type { DbExecutor } from "@/lib/db";
import type { NewAuditLogRow } from "@db/schema";
import { auditLog } from "@db/schema";

/** The sentinel actor for pipeline-driven (non-human) state changes (spec §6). */
export const SYSTEM_ACTOR = "system" as const;

/** Inputs to {@link buildAuditEntry}. `actor` is a user uuid or `"system"`. */
export interface AuditEntryInput {
  /** Owning org (nullable in §6 - system-wide events may have no org). */
  orgId: string | null;
  /** User uuid that performed the action, or `"system"`. */
  actor: string;
  /** Dotted verb, e.g. "memo.draft.created" | "memo.approved" | "memo.sent". */
  action: string;
  /** The table/entity the action touched, e.g. "memo". */
  entityType: string;
  /** The row id the action touched (nullable for entity-less events). */
  entityId: string | null;
  /** State BEFORE the change (null for a create). */
  before?: unknown;
  /** State AFTER the change (null for a delete). */
  after?: unknown;
}

/**
 * Build a plain object matching the `audit_log` insert columns (spec §6).
 *
 * PURE: no DB, no clock - `created_at` is intentionally omitted so the column
 * default (`now()`) supplies an authoritative server timestamp on insert (we
 * never fabricate time, per the no-fabrication guardrail). `before`/`after`
 * default to `null` (a create has no before; a delete has no after).
 */
export function buildAuditEntry(input: AuditEntryInput): NewAuditLogRow {
  return {
    orgId: input.orgId,
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    // jsonb columns: store the snapshot as-is, or NULL when absent.
    before: input.before ?? null,
    after: input.after ?? null,
  };
}

/**
 * Persist a single audit row (thin). Pass the object from {@link buildAuditEntry}.
 * Returns the new audit_log id.
 */
export async function recordAudit(db: DbExecutor, entry: NewAuditLogRow): Promise<string> {
  const rows = await db.insert(auditLog).values(entry).returning({ id: auditLog.id });
  const row = rows[0];
  if (!row) {
    // RETURNING on an insert always yields the row; defensive only.
    throw new Error("recordAudit: no row returned from audit_log insert");
  }
  return row.id;
}
