/**
 * DrizzlePrefilter - INTEGRATION test (spec §7, §14).
 *
 * Hits a REAL Postgres + pgvector and is therefore gated behind RUN_DB_TESTS so
 * the default green gate (`npm run test`) stays fully hermetic - with the flag
 * unset the whole suite is skipped and no socket is opened. The Stage-A ranking
 * SEMANTICS are proven hermetically against MemoryPrefilter in the pipeline tests;
 * here we verify the production SQL mapping behaves IDENTICALLY against pg:
 *
 *   - only items whose categories overlap AND whose jurisdiction is in the
 *     profile's set are returned (Stage 0 + jurisdiction gate);
 *   - survivors are ordered by descending cosine similarity to the profile vector;
 *   - the limit is respected;
 *   - a null-embedding profile still applies the SAME category/jurisdiction WHERE
 *     (Stage 0 holds), ordering by recency instead of similarity.
 *
 * To run it (requires Docker + a migrated DB):
 *
 *     npm run db:up && npm run db:migrate
 *     RUN_DB_TESTS=1 npm run test
 *
 * The test inserts a clearly-scoped set of synthetic items (real hash embeddings,
 * EMBED_DIM-wide) and deletes exactly those rows on cleanup - it never touches
 * real data. It closes the pool at the end.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { DrizzlePrefilter } from "@/lib/adapters/drizzlePrefilter";
import { closeDb, getDb } from "@/lib/db";
import { HashEmbedder } from "@/lib/embedder";
import { env } from "@/lib/env";
import { MemoryPrefilter, type PrefilterableItem, type PrefilterProfile } from "@/pipeline/prefilter";
import { items, type NewItem } from "@db/schema";

const RUN = Boolean(process.env.RUN_DB_TESTS);

// All synthetic rows share this source so cleanup is exact and never hits real data.
const TEST_SOURCE = "federal_register" as const;
const PREFIX = "REDLINE-TEST-DRIZZLE-PREFILTER";

describe.skipIf(!RUN)("DrizzlePrefilter (integration, RUN_DB_TESTS)", () => {
  const db = getDb();
  const prefilter = new DrizzlePrefilter();
  const embedder = new HashEmbedder(env().EMBED_DIM);

  // ── Fixture set ─────────────────────────────────────────────────────────────
  // Four items spanning categories × jurisdictions. The text drives the hash
  // embedding so cosine ordering is deterministic and meaningful.
  //
  //   goods-us    : categories ['goods'],        jurisdiction 'us'   ← matches profile
  //   goods-ca    : categories ['goods','taxes'],jurisdiction 'us-ca'← matches profile
  //   food-us     : categories ['food'],         jurisdiction 'us'   ← wrong category
  //   goods-ny    : categories ['goods'],         jurisdiction 'us-ny'← wrong jurisdiction
  //
  // Profile: jurisdictions ['us','us-ca'], subscribed ['goods','taxes'] → only the
  // first two items survive Stage 0 + jurisdiction. The profile concern text leans
  // toward import duties so 'goods-us' should out-rank 'goods-ca' by similarity.
  const specs = [
    { ext: "GOODS-US", jurisdiction: "us", categories: ["goods"], text: "import duty tariff customs de minimis goods threshold" },
    { ext: "GOODS-CA", jurisdiction: "us-ca", categories: ["goods", "taxes"], text: "state sales tax nexus filing for goods sellers" },
    { ext: "FOOD-US", jurisdiction: "us", categories: ["food"], text: "food safety traceability FSMA labeling permit" },
    { ext: "GOODS-NY", jurisdiction: "us-ny", categories: ["goods"], text: "import duty tariff customs de minimis goods threshold" },
  ] as const;

  const profileConcern = "import duty tariff customs de minimis goods threshold";

  type Inserted = { ext: string; id: string };
  let inserted: Inserted[] = [];

  function extOf(ext: string): string {
    return `${PREFIX}-${ext}`;
  }

  async function cleanup(): Promise<void> {
    const allExternalIds = specs.map((s) => extOf(s.ext));
    await db.delete(items).where(inArray(items.externalId, allExternalIds));
  }

  async function seed(): Promise<void> {
    const embeddings = await embedder.embed(specs.map((s) => s.text));
    const rows: NewItem[] = specs.map((s, i) => ({
      source: TEST_SOURCE,
      externalId: extOf(s.ext),
      jurisdiction: s.jurisdiction,
      type: "proposed_rule",
      identifier: `RL-${s.ext}`,
      title: `Test item ${s.ext}`,
      summary: s.text,
      status: "proposed",
      stage: "proposed",
      categories: [...s.categories],
      raw: { external_id: extOf(s.ext) },
      contentHash: `hash-${s.ext}`,
      embedding: embeddings[i],
    }));
    const out = await db.insert(items).values(rows).returning({ id: items.id, externalId: items.externalId });
    inserted = out.map((r) => ({ ext: r.externalId, id: r.id }));
  }

  function idFor(ext: string): string {
    const row = inserted.find((r) => r.ext === extOf(ext));
    if (!row) throw new Error(`fixture not inserted: ${ext}`);
    return row.id;
  }

  // Scope assertions to THIS test's fixtures so the suite is robust against a
  // dev DB that also holds real ingested items (which legitimately match the
  // same category/jurisdiction gate). We assert the gate's behavior over our
  // controlled set, not that the DB contains nothing else.
  function isFixtureId(id: string): boolean {
    return inserted.some((r) => r.id === id);
  }

  // Build the equivalent in-memory fixture so we can assert the DB adapter and
  // MemoryPrefilter agree observably (same surviving set, same order). The profile
  // embedding is supplied to prefilter() at call time, not here.
  async function memoryEquivalent(): Promise<MemoryPrefilter> {
    const embeddings = await embedder.embed(specs.map((s) => s.text));
    const memItems: PrefilterableItem[] = specs.map((s, i) => ({
      id: idFor(s.ext),
      jurisdiction: s.jurisdiction,
      categories: [...s.categories],
      embedding: embeddings[i],
    }));
    return new MemoryPrefilter(memItems);
  }

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  it("returns ONLY category+jurisdiction matches, ordered by descending similarity", async () => {
    const [profileEmbedding] = await embedder.embed([profileConcern]);
    const profile: PrefilterProfile = {
      embedding: profileEmbedding,
      jurisdictions: ["us", "us-ca"],
      subscribed_categories: ["goods", "taxes"],
    };

    const candidates = await prefilter.prefilter(profile);
    const ids = candidates.map((c) => c.id);
    const fxIds = ids.filter(isFixtureId); // scope to our fixtures (DB may hold real rows)

    // food-us (wrong category) and goods-ny (wrong jurisdiction) are excluded.
    expect(ids).not.toContain(idFor("FOOD-US"));
    expect(ids).not.toContain(idFor("GOODS-NY"));
    expect(new Set(fxIds)).toEqual(new Set([idFor("GOODS-US"), idFor("GOODS-CA")]));

    // Ordered by descending similarity; goods-us shares the profile's exact text.
    expect(fxIds[0]).toBe(idFor("GOODS-US"));
    expect(fxIds[1]).toBe(idFor("GOODS-CA"));
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].similarity).toBeGreaterThanOrEqual(candidates[i].similarity);
    }
    // Identical-text item ≈ cosine 1.
    const goodsUs = candidates.find((c) => c.id === idFor("GOODS-US"));
    expect(goodsUs?.similarity).toBeGreaterThan(0.99);

    // Observably matches MemoryPrefilter (same surviving fixture set + order).
    const mem = await memoryEquivalent();
    const memIds = (await mem.prefilter(profile)).map((c) => c.id);
    expect(fxIds).toEqual(memIds);
  });

  it("respects the limit", async () => {
    const [profileEmbedding] = await embedder.embed([profileConcern]);
    const profile: PrefilterProfile = {
      embedding: profileEmbedding,
      jurisdictions: ["us", "us-ca"],
      subscribed_categories: ["goods", "taxes"],
    };

    const limited = await prefilter.prefilter(profile, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].id).toBe(idFor("GOODS-US")); // the closest survivor
  });

  it("excludes everything when no category overlaps (Stage 0 gate)", async () => {
    const [profileEmbedding] = await embedder.embed([profileConcern]);
    const profile: PrefilterProfile = {
      embedding: profileEmbedding,
      jurisdictions: ["us", "us-ca"],
      subscribed_categories: ["data_privacy"], // none of the fixtures carry this
    };
    // No FIXTURE survives the Stage-0 gate (the DB may hold unrelated real rows).
    const survivors = (await prefilter.prefilter(profile)).filter((c) => isFixtureId(c.id));
    expect(survivors).toHaveLength(0);
  });

  it("null profile embedding still applies the category+jurisdiction WHERE (Stage 0 holds)", async () => {
    const profile: PrefilterProfile = {
      embedding: null,
      jurisdictions: ["us", "us-ca"],
      subscribed_categories: ["goods", "taxes"],
    };

    const candidates = await prefilter.prefilter(profile);
    const ids = candidates.map((c) => c.id);
    const fxIds = ids.filter(isFixtureId);

    // Same surviving fixture set as the embedding case - only the ordering changes.
    expect(new Set(fxIds)).toEqual(new Set([idFor("GOODS-US"), idFor("GOODS-CA")]));
    expect(ids).not.toContain(idFor("FOOD-US"));
    expect(ids).not.toContain(idFor("GOODS-NY"));
    // similarity is reported as 0 (no vector to rank against), matching MemoryPrefilter.
    for (const c of candidates) expect(c.similarity).toBe(0);

    // MemoryPrefilter returns the same set for a null embedding.
    const mem = await memoryEquivalent();
    const memIds = (await mem.prefilter(profile)).map((c) => c.id);
    expect(new Set(fxIds)).toEqual(new Set(memIds));
  });
});
