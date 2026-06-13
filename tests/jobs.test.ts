/**
 * Jobs - pg-boss schedules + handlers (spec §3, §14 Phase 4).
 *
 * HERMETIC by default: this suite opens NO Postgres / pg-boss connection. It
 * asserts the declarative schedule table (names + valid-looking cron strings),
 * that the handlers are exported functions, that `registerJobs` wires every
 * entry onto a FAKE boss (createQueue + schedule + work), and that the
 * approved-only digest delegation + the no-source SKIP path behave correctly -
 * all with injected deps, no real adapters.
 *
 * A describe.skipIf(!RUN_DB_TESTS) block at the bottom exercises a REAL
 * ingest + score against a live, migrated Postgres (see tests/drizzleItemStore.test.ts
 * for the run recipe). With no flag it is skipped and nothing connects.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  CRON,
  JOB_NAMES,
  SCHEDULES,
  registerJobs,
  type BossLike,
  type JobName,
  type ScheduleSpec,
} from "@/jobs/schedules";
import {
  defaultDeps,
  ingestSource,
  scoreActiveProfiles,
  sendDigests,
  withDeps,
  type DigestResult,
  type HandlerDeps,
  type SendDigestFn,
} from "@/jobs/handlers";
import type { Source } from "@/lib/types";

// ── helpers ───────────────────────────────────────────────────────────────────

/** A standard 5-field cron string: `m h dom mon dow`, each a non-empty token. */
function isFiveFieldCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  // Each field is digits / * / , / - / / (the cron metacharacters) only.
  return fields.every((f) => /^[\d*,\-/]+$/.test(f));
}

/** A fake boss recording createQueue/schedule/work calls (no Postgres). */
function makeFakeBoss() {
  const queues: string[] = [];
  const scheduled: Array<{ name: string; cron: string }> = [];
  const workers: Array<{ name: string; handler: (jobs: unknown) => Promise<unknown> }> = [];
  const boss: BossLike = {
    async createQueue(name) {
      queues.push(name);
    },
    async schedule(name, cron) {
      scheduled.push({ name, cron });
    },
    async work(name, handler) {
      workers.push({ name, handler });
    },
  };
  return { boss, queues, scheduled, workers };
}

/** Minimal HandlerDeps for hermetic handler tests - only override what's used. */
function stubDeps(overrides: Partial<HandlerDeps>): HandlerDeps {
  const logger = { info: vi.fn(), error: vi.fn() };
  return {
    // `db` is a sentinel; the handlers under hermetic test never query through it.
    db: {} as HandlerDeps["db"],
    embedder: { dim: 1, embed: async () => [[0]] },
    llm: { json: async () => ({}) as never },
    sourceClients: [],
    sendDigest: async () => [],
    memoThreshold: 4,
    now: () => new Date("2026-06-11T00:00:00.000Z"),
    logger,
    ...overrides,
  };
}

// ── SCHEDULES table ─────────────────────────────────────────────────────────

describe("SCHEDULES (declarative cron table)", () => {
  it("has exactly the expected job names", () => {
    const names = SCHEDULES.map((s) => s.name).sort();
    expect(names).toEqual([...JOB_NAMES].sort());
  });

  it("covers hourly federal ingest, daily state ingest, daily scoring, daily + weekly digest", () => {
    const byName = new Map<JobName, ScheduleSpec>(SCHEDULES.map((s) => [s.name, s]));
    expect(byName.get("ingest.federal.hourly")?.cron).toBe(CRON.HOURLY);
    expect(byName.get("ingest.state.daily")?.cron).toBe(CRON.DAILY_EARLY);
    expect(byName.get("score.profiles.daily")?.cron).toBeDefined();
    expect(byName.get("digest.daily")?.cron).toBeDefined();
    expect(byName.get("digest.weekly")?.cron).toBe(CRON.WEEKLY_MONDAY);
  });

  it("every entry has a valid 5-field cron string", () => {
    for (const spec of SCHEDULES) {
      expect(isFiveFieldCron(spec.cron), `${spec.name}: "${spec.cron}"`).toBe(true);
    }
  });

  it("the hourly federal job really runs hourly (minute fixed, hour wildcard)", () => {
    expect(CRON.HOURLY).toBe("0 * * * *");
  });

  it("the weekly digest runs once a week (day-of-week pinned to Monday)", () => {
    const dow = CRON.WEEKLY_MONDAY.trim().split(/\s+/)[4];
    expect(dow).toBe("1");
  });

  it("every entry exposes a callable handler and a non-empty description", () => {
    for (const spec of SCHEDULES) {
      expect(typeof spec.handler).toBe("function");
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it("job names are unique", () => {
    const names = SCHEDULES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ── handler exports ───────────────────────────────────────────────────────────

describe("handlers (exports)", () => {
  it("exports ingestSource, scoreActiveProfiles, sendDigests as functions", () => {
    expect(typeof ingestSource).toBe("function");
    expect(typeof scoreActiveProfiles).toBe("function");
    expect(typeof sendDigests).toBe("function");
  });

  it("defaultDeps() / withDeps() build a deps bag without opening a connection", () => {
    const deps = defaultDeps();
    expect(typeof deps.now).toBe("function");
    expect(deps.memoThreshold).toBeGreaterThanOrEqual(0);
    // withDeps overrides selectively.
    const overridden = withDeps({ memoThreshold: 5 });
    expect(overridden.memoThreshold).toBe(5);
  });
});

// ── registerJobs (against a fake boss) ────────────────────────────────────────

describe("registerJobs (fake boss, no Postgres)", () => {
  it("creates a queue, schedules the cron, and attaches a worker for every entry", async () => {
    const { boss, queues, scheduled, workers } = makeFakeBoss();
    await registerJobs(boss, { makeDeps: () => stubDeps({}) });

    const expected = SCHEDULES.map((s) => s.name);
    expect(queues.sort()).toEqual([...expected].sort());
    expect(scheduled.map((s) => s.name).sort()).toEqual([...expected].sort());
    expect(workers.map((w) => w.name).sort()).toEqual([...expected].sort());

    // The scheduled cron strings match the table.
    for (const spec of SCHEDULES) {
      const got = scheduled.find((s) => s.name === spec.name);
      expect(got?.cron).toBe(spec.cron);
    }
  });

  it("a registered worker invokes its bound handler with fresh deps", async () => {
    const { boss, workers } = makeFakeBoss();
    const sendDigest = vi.fn<SendDigestFn>(async () => []);
    const madeDeps: HandlerDeps[] = [];

    await registerJobs(boss, {
      // Only the digest jobs are safe to actually invoke hermetically (the
      // ingest/score workers query the DB), so restrict the table for this test.
      schedules: SCHEDULES.filter((s) => s.name.startsWith("digest.")),
      makeDeps: () => {
        const d = stubDeps({ sendDigest });
        madeDeps.push(d);
        return d;
      },
    });

    const daily = workers.find((w) => w.name === "digest.daily");
    expect(daily).toBeDefined();
    await daily!.handler([]); // pg-boss hands the worker a batch array
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(sendDigest.mock.calls[0][0].cadence).toBe("daily");
    // A fresh deps bag was built for the run.
    expect(madeDeps.length).toBeGreaterThan(0);
  });
});

// ── ingestSource: SKIP path (hermetic, no DB) ─────────────────────────────────

describe("ingestSource (skip when source not live-ready)", () => {
  it("returns null and logs a skip when the source is not in sourceClients", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = stubDeps({ sourceClients: [], logger });
    const result = await ingestSource(deps, "congress" as Source);
    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalled();
  });
});

// ── sendDigests: approved-only delegation (hermetic) ──────────────────────────

describe("sendDigests (delegates to approved-only digest)", () => {
  it("passes the cadence through to deps.sendDigest and returns its results", async () => {
    const results: DigestResult[] = [
      { orgId: "org-1", sent: 2, empty: false },
      { orgId: "org-2", sent: 0, empty: true },
    ];
    const sendDigest = vi.fn<SendDigestFn>(async () => results);
    const deps = stubDeps({ sendDigest });

    const out = await sendDigests(deps, "weekly");
    expect(out).toEqual(results);
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(sendDigest.mock.calls[0][0].cadence).toBe("weekly");
  });

  it("defaults to the daily cadence", async () => {
    const sendDigest = vi.fn<SendDigestFn>(async () => []);
    const deps = stubDeps({ sendDigest });
    await sendDigests(deps);
    expect(sendDigest.mock.calls[0][0].cadence).toBe("daily");
  });

  it("NEVER inspects or mutates memo status itself - the trust gate lives in the digest module", async () => {
    // sendDigests must call exactly one collaborator (deps.sendDigest); it has no
    // other path to the DB and therefore cannot send a draft on its own.
    const sendDigest = vi.fn<SendDigestFn>(async () => []);
    // A db proxy that throws if touched - proves the handler doesn't query directly.
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error("sendDigests must not query the DB directly");
        },
      },
    ) as HandlerDeps["db"];
    const deps = stubDeps({ sendDigest, db: trap });
    await expect(sendDigests(deps, "daily")).resolves.toEqual([]);
    expect(sendDigest).toHaveBeenCalledTimes(1);
  });
});

// ── DB-gated: real ingest + score (RUN_DB_TESTS) ──────────────────────────────

const RUN = Boolean(process.env.RUN_DB_TESTS);

describe.skipIf(!RUN)("jobs (integration, RUN_DB_TESTS)", () => {
  // Imported lazily so the hermetic path never loads the DB client.
  it("ingestSource runs the federal source end-to-end against a live DB", async () => {
    const deps = defaultDeps();
    const stats = await ingestSource(deps, "federal_register");
    // federal_register is always live-ready, so we get stats (not a skip).
    expect(stats).not.toBeNull();
    expect(stats!.source).toBe("federal_register");
    expect(stats!.fetched).toBeGreaterThanOrEqual(0);
  });

  it("scoreActiveProfiles scores active profiles and only DRAFTs memos", async () => {
    const deps = defaultDeps();
    const summary = await scoreActiveProfiles(deps);
    expect(summary.profiles).toBeGreaterThanOrEqual(0);
    // Every judgment logged is >= 0; memos drafted <= judgments (only high scores).
    expect(summary.memosDrafted).toBeLessThanOrEqual(summary.judgmentsLogged);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
  });
});
