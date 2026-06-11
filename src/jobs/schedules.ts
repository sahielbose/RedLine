/**
 * pg-boss schedules + registration (spec §3, §4, §14 Phase 4).
 *
 * The architecture diagram (spec §3) puts a "pg-boss scheduler (cron, in
 * Postgres)" at the top: *hourly federal* ingest, *daily state* ingest, then the
 * per-business scoring pass and the digest delivery. This module is the
 * DECLARATIVE source of truth for those cron jobs and the function that wires
 * them into a running pg-boss instance.
 *
 * IMPORTANT — no side effects at import:
 *   Importing this module must NOT connect to Postgres or start a worker. It only
 *   declares data ({@link SCHEDULES}) and a function ({@link registerJobs}). The
 *   actual `new PgBoss(...)` + `boss.start()` lives in a runner the human invokes
 *   (e.g. a `tsx` entrypoint), so typecheck/tests/eval stay green with no DB.
 *
 * TRUST (spec §8): the digest job runs `sendDigests`, which delegates to
 * `@/pipeline/digest` (APPROVED-only delivery, markSent = approved→sent only).
 * Scheduling cannot bypass the approval gate — it only triggers the same
 * approved-only path on a clock.
 */
import type { Source } from "@/lib/types";
import {
  defaultDeps,
  ingestSource,
  scoreActiveProfiles,
  sendDigests,
  type DigestCadence,
  type HandlerDeps,
} from "@/jobs/handlers";

// ── cron strings (standard 5-field `m h dom mon dow`, server-local tz) ────────
//
//   "0 * * * *"   → top of every hour            (hourly)
//   "0 6 * * *"   → 06:00 every day              (daily, early morning)
//   "30 6 * * *"  → 06:30 every day              (after the daily ingest)
//   "0 7 * * *"   → 07:00 every day              (after scoring; daily digest)
//   "0 8 * * 1"   → 08:00 every Monday           (weekly digest)
//
// The ordering across a morning is deliberate: state ingest (06:00) → scoring
// (06:30, after fresh items land) → digest (07:00, after drafts are scored and,
// for whatever a human approved, ready to send).
export const CRON = {
  HOURLY: "0 * * * *",
  DAILY_EARLY: "0 6 * * *",
  DAILY_AFTER_INGEST: "30 6 * * *",
  DAILY_MORNING: "0 7 * * *",
  WEEKLY_MONDAY: "0 8 * * 1",
} as const;

// ── job names (the pg-boss queue names) ───────────────────────────────────────
export const JOB_NAMES = [
  "ingest.federal.hourly",
  "ingest.state.daily",
  "score.profiles.daily",
  "digest.daily",
  "digest.weekly",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/**
 * A handler bound for the scheduler: takes the deps bag and returns when the
 * work is done. Each {@link ScheduleSpec} closes over its own fixed arguments
 * (which source to ingest, which digest cadence) so the worker signature is
 * uniform.
 */
export type BoundHandler = (deps: HandlerDeps) => Promise<unknown>;

/** One scheduled job: a queue name, its cron string, and the work to run. */
export interface ScheduleSpec {
  name: JobName;
  cron: string;
  /** Human-readable note for docs / `getSchedules()` review. */
  description: string;
  handler: BoundHandler;
}

const FEDERAL_SOURCE: Source = "federal_register";
const STATE_SOURCE: Source = "openstates";
const DAILY: DigestCadence = "daily";
const WEEKLY: DigestCadence = "weekly";

/**
 * The declarative schedule table (spec §3). Each entry is registered with
 * pg-boss in {@link registerJobs}. Handlers receive the production deps bag;
 * each closes over its fixed arguments so `boss.work` sees a uniform signature.
 */
export const SCHEDULES: readonly ScheduleSpec[] = [
  {
    name: "ingest.federal.hourly",
    cron: CRON.HOURLY,
    description: "Hourly: poll the federal sources (Federal Register; Congress when keyed).",
    handler: (deps) => ingestSource(deps, FEDERAL_SOURCE),
  },
  {
    name: "ingest.state.daily",
    cron: CRON.DAILY_EARLY,
    description: "Daily 06:00: poll state legislatures (Open States; CA first).",
    handler: (deps) => ingestSource(deps, STATE_SOURCE),
  },
  {
    name: "score.profiles.daily",
    cron: CRON.DAILY_AFTER_INGEST,
    description: "Daily 06:30: re-score every active profile; log judgments; DRAFT memos.",
    handler: (deps) => scoreActiveProfiles(deps),
  },
  {
    name: "digest.daily",
    cron: CRON.DAILY_MORNING,
    description: "Daily 07:00: send the digest of APPROVED memos (approval gate; no auto-send).",
    handler: (deps) => sendDigests(deps, DAILY),
  },
  {
    name: "digest.weekly",
    cron: CRON.WEEKLY_MONDAY,
    description: "Weekly Mon 08:00: send the weekly digest of APPROVED memos.",
    handler: (deps) => sendDigests(deps, WEEKLY),
  },
] as const;

// ── pg-boss registration ──────────────────────────────────────────────────────

/**
 * The slice of the pg-boss API we use. Typed structurally so this module does
 * not import the `pg-boss` value (keeps the import side-effect-free and makes
 * `registerJobs` trivially testable with a fake boss). pg-boss 10 requires a
 * queue to exist before scheduling/working it, hence `createQueue`.
 */
export interface BossLike {
  createQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: object): Promise<unknown>;
  work(name: string, handler: (jobs: unknown) => Promise<unknown>): Promise<unknown>;
}

export interface RegisterJobsOptions {
  /** Deps factory for the workers (defaults to the production {@link defaultDeps}). */
  makeDeps?: () => HandlerDeps;
  /** Schedule table to register (defaults to {@link SCHEDULES}); injectable for tests. */
  schedules?: readonly ScheduleSpec[];
}

/**
 * Register every {@link SCHEDULES} entry on a running pg-boss instance:
 * ensure its queue exists, schedule its cron, and attach its worker.
 *
 * Does NOT construct or start pg-boss (no connection here) — the caller passes
 * an already-started boss. The worker builds a FRESH deps bag per run via
 * `makeDeps()` so each invocation gets a current clock and clean adapters.
 *
 * pg-boss delivers jobs to a worker as a batch (an array of jobs); our cron
 * jobs are singletons with no payload, so the worker ignores the batch and just
 * runs the bound handler once.
 */
export async function registerJobs(
  boss: BossLike,
  options: RegisterJobsOptions = {},
): Promise<void> {
  const makeDeps = options.makeDeps ?? defaultDeps;
  const schedules = options.schedules ?? SCHEDULES;

  for (const spec of schedules) {
    await boss.createQueue(spec.name);
    await boss.schedule(spec.name, spec.cron);
    await boss.work(spec.name, async () => {
      // Build deps per run: fresh clock + adapters; never shared mutable state.
      const deps = makeDeps();
      return spec.handler(deps);
    });
  }
}
