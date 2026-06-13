/**
 * Pipeline persistence - judgment log + DRAFT memo (spec §6, §7, §8).
 *
 * The cost-bearing pipeline (Stage B judge → memo generator) runs pure with
 * injected I/O (see src/pipeline/score.ts, src/pipeline/memo.ts). THIS module is
 * the thin, faithful SQL sink that lands those results in Postgres:
 *
 *   - `persistJudgment` appends one `relevance_judgments` row - THE trust-tuning
 *     log; every relevance decision, with its model/prompt/rubric versions,
 *     forever (spec §6). Returns the new judgment id (so a memo can FK to it).
 *
 *   - `persistMemoDraft` inserts one `memos` row with status "draft" - and ONLY
 *     "draft". The approval gate (spec §8, CLAUDE.md rule 10) means no memo is
 *     ever born approved or sent; a human moves it forward via review.ts. The
 *     write is paired with an `audit_log` row (action "memo.draft.created",
 *     before = null, after = the new row) so the memo's whole lifecycle is
 *     auditable from creation.
 *
 * Mapping notes (mirroring src/lib/adapters/drizzleItemStore.ts):
 *   - jsonb columns (`citations`) take the value as-is.
 *   - `created_at` / `approved_at` use schema defaults / stay null - never a
 *     fabricated timestamp.
 *   - Absent fields are stored as NULL, never invented (spec §15).
 */
import type { Database } from "@/lib/db";
import { buildAuditEntry, recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import type { Judgment, MemoContent, PipelineStage } from "@/lib/types";
import { memos, relevanceJudgments } from "@db/schema";

/** The shared Drizzle client type (matches `@/lib/db`'s `getDb()` / `db`). */
type Db = Database;

/**
 * Explicit args for a relevance judgment row (spec §6 relevance_judgments).
 * Mirrors the column set; `stage` is the pipeline stage that produced it.
 */
export interface PersistJudgmentArgs {
  orgId: string;
  itemId: string;
  stage: PipelineStage;
  score?: number | null;
  similarity?: number | null;
  justification?: string | null;
  matchedConcern?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  rubricVersion?: string | null;
}

/**
 * Insert one `relevance_judgments` row and return its id.
 *
 * Accepts either the explicit column args above OR a {@link Judgment} object
 * (the shape `judge()` / `score.ts` emit) plus `{ orgId, itemId }`; the Judgment
 * branch maps snake_case → columns so callers can log straight from the engine.
 */
export async function persistJudgment(
  db: Db,
  args: PersistJudgmentArgs | (Judgment & { orgId: string; itemId: string }),
): Promise<string> {
  const row = "matched_concern" in args ? fromJudgment(args) : args;

  const inserted = await db
    .insert(relevanceJudgments)
    .values({
      orgId: row.orgId,
      itemId: row.itemId,
      stage: row.stage,
      score: row.score ?? null,
      similarity: row.similarity ?? null,
      justification: row.justification ?? null,
      matchedConcern: row.matchedConcern ?? null,
      model: row.model ?? null,
      promptVersion: row.promptVersion ?? null,
      rubricVersion: row.rubricVersion ?? null,
      // created_at uses the schema default now().
    })
    .returning({ id: relevanceJudgments.id });

  const out = inserted[0];
  if (!out) throw new Error("persistJudgment: no row returned from relevance_judgments insert");
  return out.id;
}

/** Normalize a {@link Judgment} (snake_case) into the explicit column args. */
function fromJudgment(j: Judgment & { orgId: string; itemId: string }): PersistJudgmentArgs {
  return {
    orgId: j.orgId,
    itemId: j.itemId,
    stage: j.stage,
    score: j.score,
    similarity: j.similarity ?? null,
    justification: j.justification,
    matchedConcern: j.matched_concern,
    model: j.model,
    promptVersion: j.prompt_version,
    rubricVersion: j.rubric_version,
  };
}

/** Args for persisting a DRAFT memo (spec §6 memos, §8 approval gate). */
export interface PersistMemoDraftArgs {
  orgId: string;
  itemId: string;
  /** FK to the relevance_judgments row that triggered this memo (nullable). */
  judgmentId?: string | null;
  /** The verified, sanitized memo body (from src/pipeline/memo.ts). */
  memo: MemoContent;
  model?: string | null;
  promptVersion?: string | null;
}

/**
 * Insert a memo with status "draft" (NEVER any other status here - the approval
 * gate, spec §8 / CLAUDE.md rule 10) and record a "memo.draft.created" audit row
 * (before = null, after = the persisted row). Returns the new memo id.
 *
 * Actor is `"system"`: the pipeline created this draft, no human acted yet.
 */
export async function persistMemoDraft(db: Db, args: PersistMemoDraftArgs): Promise<string> {
  const { orgId, itemId, judgmentId, memo } = args;

  // Insert + audit commit ATOMICALLY: a draft memo can never exist without its
  // "memo.draft.created" audit row (spec §8 trust guarantee).
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(memos)
      .values({
        itemId,
        orgId,
        judgmentId: judgmentId ?? null,
        whatItDoes: memo.what_it_does,
        statusAndNextSteps: memo.status_and_next_steps,
        whoIsAffected: memo.who_is_affected,
        recommendedAction: memo.recommended_action,
        recommendedActionNote: memo.recommended_action_note,
        // LABELED estimate + assumptions or null - never a bare figure (spec §15);
        // sanitize happens upstream in generateMemo, persisted faithfully here.
        impactEstimate: memo.impact_estimate,
        // jsonb: store the (code-verified) citations array as-is.
        citations: memo.citations,
        confidence: memo.confidence,
        model: args.model ?? null,
        promptVersion: args.promptVersion ?? null,
        // status defaults to "draft" in the schema; we set it explicitly to make
        // the approval gate unmissable. NEVER set any other status here.
        status: "draft",
        // approved_by / approved_at stay null; created_at uses default now().
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error("persistMemoDraft: no row returned from memos insert");

    // Audit: a create has no before-image; after = the full persisted row.
    await recordAudit(
      tx,
      buildAuditEntry({
        orgId,
        actor: SYSTEM_ACTOR,
        action: "memo.draft.created",
        entityType: "memo",
        entityId: row.id,
        before: null,
        after: row,
      }),
    );

    return row.id;
  });
}
