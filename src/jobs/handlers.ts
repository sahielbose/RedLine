/**
 * Job handlers — the WORK behind the pg-boss schedules (spec §3, §7, §8).
 *
 * Each handler is a plain async function over an injected {@link HandlerDeps}
 * bag, so the orchestration is unit-testable hermetically (stub the deps) and
 * runs in production unchanged (the deps default to the real adapters, all
 * constructed lazily — importing this module opens NO DB / SMTP connection).
 *
 * The three jobs, mapped to the architecture diagram (spec §3):
 *   - ingestSource(deps, sourceKey)  poll one SourceClient → upsert/diff/embed.
 *   - scoreActiveProfiles(deps)      Stage 0/A/B per active profile → log every
 *                                    judgment, DRAFT a memo for high scores.
 *   - sendDigests(deps)              deliver the digest of APPROVED memos only.
 *
 * TRUST (spec §8, CLAUDE.md rules 7 & 10):
 *   - scoreActiveProfiles only ever writes memos as `draft` (via persistMemoDraft,
 *     which hard-codes status "draft"); nothing here approves or sends.
 *   - sendDigests delegates to `@/pipeline/digest`'s `sendDigest`, which selects
 *     APPROVED memos and marks them sent via review.ts#markSent (approved→sent
 *     only). NO path in this file can send a draft. No fabricated figures: every
 *     value persisted comes verbatim from the (already-sanitized) pipeline output.
 */
import type { Database } from "@/lib/db";
import type { Embedder, LLM, SourceClient } from "@/lib/interfaces";
import type { Source } from "@/lib/types";
import type { IngestStats } from "@/pipeline/ingest";
import type { BusinessProfile } from "@/lib/types";

import { getDb } from "@/lib/db";
import { getEmbedder } from "@/lib/embedder";
import { getLLM } from "@/lib/llm";
import { enabledSourceClients } from "@/sources";
import { env } from "@/lib/env";
import { DrizzleItemStore } from "@/lib/adapters/drizzleItemStore";
import { DrizzlePrefilter } from "@/lib/adapters/drizzlePrefilter";
import { runIngest } from "@/pipeline/ingest";
import { scoreBoard, type ScorableItem } from "@/pipeline/score";
import { persistJudgment, persistMemoDraft } from "@/pipeline/persist";
import { sendDigest as sendOrgDigest } from "@/pipeline/digest";
import { getMailer } from "@/lib/mailer";
import { orgProfiles, items as itemsTable, organizations, users } from "@db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

// ── digest contract ───────────────────────────────────────────────────────────
// The digest job is a MULTI-ORG orchestrator (SendDigestFn): it enumerates orgs +
// recipients and delegates each org's approved-only send to `@/pipeline/digest`'s
// per-org `sendDigest`. Importing this module opens no connection (the db client
// is lazy; the digest fn only queries when called). Tests inject their own
// `sendDigest` dep, so the default multi-org adapter only runs against a live DB.

/** What the digest job reports per org (a thin, faithful summary). */
export interface DigestResult {
  orgId: string;
  /** Memos delivered (already APPROVED — never drafts). */
  sent: number;
  /** True if there was nothing approved to send (a no-op, not an error). */
  empty: boolean;
}

/** Cadence the scheduler asks the digest for (mirrors digest settings, spec §2). */
export type DigestCadence = "daily" | "weekly";

/**
 * The digest function this handler delegates to (implemented in
 * `@/pipeline/digest`). It MUST be approved-only and mark-sent via review.ts —
 * this handler never inspects memo status itself, so the trust guarantee lives
 * in exactly one place.
 */
export type SendDigestFn = (a: {
  db: Database;
  cadence: DigestCadence;
}) => Promise<DigestResult[]>;

// ── deps ────────────────────────────────────────────────────────────────────

/** A minimal structured logger; defaults to console.info / console.error. */
export interface JobLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const consoleLogger: JobLogger = {
  info(msg, meta) {
    // eslint-disable-next-line no-console
    console.info(`[jobs] ${msg}`, meta ?? "");
  },
  error(msg, meta) {
    // eslint-disable-next-line no-console
    console.error(`[jobs] ${msg}`, meta ?? "");
  },
};

/**
 * Production multi-org digest adapter (the default {@link SendDigestFn}).
 *
 * Enumerates every org, picks the recipient as the org's earliest user
 * (`users.email` — the schema has no dedicated delivery-config table yet, so the
 * owner address stands in), and delegates each org's APPROVED-ONLY send + the
 * markSent transition to `@/pipeline/digest`'s per-org `sendDigest`. Orgs with no
 * user are skipped (logged), never errored. Uses the configured Mailer
 * (LogMailer when no SMTP_URL). No status is read/written here — the approved-only
 * guarantee lives entirely in `sendDigest`/`markSent` (spec §8).
 */
const defaultSendDigest: SendDigestFn = async ({ db, cadence }) => {
  const mailer = getMailer();
  const periodLabel = cadence === "weekly" ? "Weekly digest" : "Daily brief";

  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  const results: DigestResult[] = [];

  for (const org of orgs) {
    const recipient = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.orgId, org.id))
      .orderBy(asc(users.createdAt))
      .limit(1);
    const to = recipient[0]?.email;
    if (!to) {
      results.push({ orgId: org.id, sent: 0, empty: true });
      continue;
    }

    const r = await sendOrgDigest(db, mailer, {
      orgId: org.id,
      to,
      periodLabel,
      orgLabel: org.name,
    });
    results.push({ orgId: org.id, sent: r.memoIds.length, empty: !r.sent });
  }

  return results;
};

/**
 * Injected dependencies for every handler. All have lazy production defaults
 * (no connection at import time) and are overridable in tests.
 */
export interface HandlerDeps {
  db: Database;
  embedder: Embedder;
  llm: LLM;
  /** SourceClients that can poll live right now (have any required key). */
  sourceClients: SourceClient[];
  /** Approved-only digest delivery (see {@link SendDigestFn}). */
  sendDigest: SendDigestFn;
  /** Memo-draft threshold (default env().MEMO_THRESHOLD). */
  memoThreshold: number;
  /** Clock — injected for determinism in tests. */
  now: () => Date;
  logger: JobLogger;
}

/**
 * Build the production deps (real adapters), all constructed lazily so calling
 * this opens no socket until a handler actually queries. Tests build their own
 * partial deps via {@link withDeps}.
 */
export function defaultDeps(): HandlerDeps {
  return {
    db: getDb(),
    embedder: getEmbedder(),
    llm: getLLM(),
    sourceClients: enabledSourceClients(),
    sendDigest: defaultSendDigest,
    memoThreshold: env().MEMO_THRESHOLD,
    now: () => new Date(),
    logger: consoleLogger,
  };
}

/** Merge partial overrides onto the production defaults (test ergonomics). */
export function withDeps(overrides: Partial<HandlerDeps>): HandlerDeps {
  return { ...defaultDeps(), ...overrides };
}

// ── handler: ingestSource ─────────────────────────────────────────────────────

/**
 * Poll ONE source through the ingest loop (spec §7). Finds the live-ready
 * SourceClient by key in `deps.sourceClients`; if it is absent (no API key, or
 * the source is not implemented), this is a SKIP — logged and reported, never an
 * error, so a missing-key source doesn't fail the whole schedule.
 *
 * Returns the {@link IngestStats} on a real run, or `null` when skipped.
 */
export async function ingestSource(
  deps: HandlerDeps,
  sourceKey: Source,
): Promise<IngestStats | null> {
  const client = deps.sourceClients.find((c) => c.key === sourceKey);
  if (!client) {
    deps.logger.info(`ingest skipped: source "${sourceKey}" is not live-ready (no key)`, {
      source: sourceKey,
    });
    return null;
  }

  const store = new DrizzleItemStore({ db: deps.db });
  const stats = await runIngest({
    client,
    store,
    embedder: deps.embedder,
    now: deps.now,
  });
  deps.logger.info(`ingest done: ${sourceKey}`, { ...stats });
  return stats;
}

// ── handler: scoreActiveProfiles ──────────────────────────────────────────────

export interface ScoreRunSummary {
  profiles: number;
  judgmentsLogged: number;
  memosDrafted: number;
}

/** Map a Drizzle org_profiles row → the engine's BusinessProfile shape. */
function rowToProfile(row: typeof orgProfiles.$inferSelect): BusinessProfile {
  return {
    id: row.id,
    org_id: row.orgId,
    business_types: (row.businessTypes ?? []) as BusinessProfile["business_types"],
    jurisdictions: row.jurisdictions ?? [],
    attributes: (row.attributes ?? {}) as BusinessProfile["attributes"],
    subscribed_categories: (row.subscribedCategories ?? []) as BusinessProfile["subscribed_categories"],
    concern_text: row.concernText ?? "",
    embedding: row.embedding ?? null,
    is_active: row.isActive,
  };
}

/** Map a stored items row → a ScorableItem the engine can score. */
function rowToScorable(row: typeof itemsTable.$inferSelect): ScorableItem | null {
  // The DrizzlePrefilter only returns rows with a non-null embedding; an item
  // without one cannot be scored (no Stage-A vector), so skip it defensively.
  if (!row.embedding) return null;
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    categories: row.categories ?? [],
    embedding: row.embedding,
    title: row.title,
    summary: row.summary,
    full_text: row.fullText,
    identifier: row.identifier,
    type: row.type,
    source: row.source,
  };
}

/**
 * Score every ACTIVE org profile against the items it surfaces and persist the
 * results (spec §7, §8):
 *
 *   for each active org_profile:
 *     candidates = items overlapping its jurisdictions × subscribed_categories
 *     scoreBoard(profile, candidates, DrizzlePrefilter, llm,
 *                onJudgment: persist EVERY judgment → relevance_judgments)
 *     for each surfaced item with score >= MEMO_THRESHOLD:
 *       persistMemoDraft (status "draft" — the approval gate; NEVER auto-sent)
 *
 * The judgment id captured in the onJudgment hook is threaded into the memo's
 * `judgment_id` FK so a draft links back to the decision that triggered it.
 */
export async function scoreActiveProfiles(deps: HandlerDeps): Promise<ScoreRunSummary> {
  const summary: ScoreRunSummary = { profiles: 0, judgmentsLogged: 0, memosDrafted: 0 };

  const profileRows = await deps.db
    .select()
    .from(orgProfiles)
    .where(eq(orgProfiles.isActive, true));

  for (const row of profileRows) {
    const profile = rowToProfile(row);
    summary.profiles++;

    // Load the candidate items for this profile: same Stage-0 WHERE the
    // DrizzlePrefilter applies (jurisdiction membership × category overlap), so
    // scoreBoard's byId lookup resolves every prefilter candidate id.
    const candidateRows = await deps.db
      .select()
      .from(itemsTable)
      .where(
        and(
          sql`${itemsTable.jurisdiction} = ANY(${sql.param(profile.jurisdictions)})`,
          sql`${itemsTable.categories} && ${sql.param(profile.subscribed_categories)}`,
        ),
      );

    const scorables = candidateRows
      .map(rowToScorable)
      .filter((s): s is ScorableItem => s !== null);

    if (scorables.length === 0) {
      deps.logger.info(`score: no candidate items for profile`, { profileId: profile.id });
      continue;
    }

    // itemId → persisted judgment id, captured as each judgment is logged, so a
    // drafted memo can FK to the judgment that triggered it.
    const judgmentIdByItem = new Map<string, string>();

    const board = await scoreBoard({
      profile,
      items: scorables,
      llm: deps.llm,
      prefilter: new DrizzlePrefilter({ db: deps.db }),
      memoThreshold: deps.memoThreshold,
      withMemos: true,
      onJudgment: async (judgment, itemId) => {
        // Log EVERY judgment to relevance_judgments (the trust-tuning log, §6).
        const judgmentId = await persistJudgment(deps.db, {
          ...judgment,
          orgId: profile.org_id,
          itemId,
        });
        judgmentIdByItem.set(itemId, judgmentId);
        summary.judgmentsLogged++;
      },
    });

    // DRAFT a memo for everything the engine flagged at/above threshold. Status
    // is hard-coded "draft" inside persistMemoDraft — the approval gate (§8).
    for (const scored of board.surfaced) {
      if (!scored.memo) continue;
      await persistMemoDraft(deps.db, {
        orgId: profile.org_id,
        itemId: scored.id,
        judgmentId: judgmentIdByItem.get(scored.id) ?? null,
        memo: scored.memo.content,
        model: scored.memo.model,
        promptVersion: scored.memo.prompt_version,
      });
      summary.memosDrafted++;
    }

    deps.logger.info(`score done: profile`, {
      profileId: profile.id,
      surfaced: board.surfaced.length,
      filteredOut: board.filteredOut,
    });
  }

  return summary;
}

// ── handler: sendDigests ──────────────────────────────────────────────────────

/**
 * Deliver the digest of APPROVED memos (spec §8 — NOTHING auto-sends). This
 * handler is a thin shell: it delegates the entire approved-only selection and
 * the markSent (approved→sent) transition to `deps.sendDigest`
 * (`@/pipeline/digest`). It never reads or mutates memo status itself, so the
 * trust guarantee has exactly one home and no draft can leak into a send.
 *
 * @param cadence which digest to run (daily by default). The digest module
 *   decides which orgs/memos are due for that cadence.
 */
export async function sendDigests(
  deps: HandlerDeps,
  cadence: DigestCadence = "daily",
): Promise<DigestResult[]> {
  const results = await deps.sendDigest({ db: deps.db, cadence });

  const sent = results.reduce((n, r) => n + r.sent, 0);
  deps.logger.info(`digest done: ${cadence}`, {
    cadence,
    orgs: results.length,
    sent,
  });
  return results;
}
