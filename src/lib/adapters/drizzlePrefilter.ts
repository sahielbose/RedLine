/**
 * DrizzlePrefilter - the production Stage A pgvector prefilter (spec §7).
 *
 * A faithful SQL implementation of the {@link Prefilter} interface, equivalent to
 * the in-memory {@link MemoryPrefilter}: it applies the SAME WHERE semantics
 * (Stage 0 category overlap + jurisdiction membership) and orders what survives by
 * cosine similarity to the profile embedding. The ranking SEMANTICS are proven
 * hermetically against MemoryPrefilter (cosine in JS); this adapter is validated
 * against a live Postgres + pgvector by the env-gated integration test
 * (tests/drizzlePrefilter.test.ts). The two prefilters are interchangeable behind
 * `scoreBoard` (src/pipeline/score.ts).
 *
 * The §7 query:
 *
 *   SELECT i.id, 1 - (i.embedding <=> $1) AS similarity
 *   FROM items i
 *   WHERE i.jurisdiction = ANY($2) AND i.categories && $3 AND i.embedding IS NOT NULL
 *   ORDER BY i.embedding <=> $1 ASC
 *   LIMIT $4;
 *
 * (`<=>` is the pgvector cosine-distance operator; `&&` is the Postgres array
 * overlap operator; `= ANY($2)` is jurisdiction membership.)
 *
 * Notes on the mapping / mirroring drizzleItemStore.ts:
 *  - We stay inside the typed query builder (db.select().from(items)…) and drop to
 *    `sql` fragments only for the two pgvector / array operators, mirroring how
 *    drizzleItemStore uses `sql` for now()/xmax. The select projection types the
 *    returned rows directly - no manual `.rows` unwrapping.
 *  - SAFE pgvector literal: the profile embedding is a number[]. pgvector has no
 *    native param binding here, so the vector is rendered into the SQL text. To
 *    keep that injection-proof we VALIDATE every element is a finite number first
 *    (toVectorLiteral throws otherwise) and emit only `[n,n,...]` - there is no
 *    path for attacker-controlled strings to reach the SQL. The literal is cast
 *    `::vector` so Postgres parses it as a vector value.
 *  - jurisdictions / subscribed_categories are bound as `text[]` PARAMS via
 *    sql.param(...) - parameterized, never interpolated (Stage 0 holds, and the
 *    array contents can never break out of the query).
 *  - `embedding IS NOT NULL` keeps NULL-embedding rows out of the cosine ordering
 *    (they would sort unpredictably and never have a meaningful similarity).
 *  - Null profile embedding: there is nothing to rank against, so we fall back to
 *    `ORDER BY last_synced_at DESC` (freshest first) but STILL apply the
 *    jurisdiction + category-overlap WHERE so Stage 0 is never bypassed - exactly
 *    MemoryPrefilter's behavior (it returns the same matched set, similarity 0).
 *  - similarity is `1 - cosine_distance` ∈ [-1, 1] (1 = identical direction),
 *    matching cosineSimilarity() used by MemoryPrefilter. In the null-embedding
 *    fallback we report 0, also matching MemoryPrefilter.
 *
 * Known, bounded divergences from MemoryPrefilter (both moot in practice):
 *  1. NULL-embedding ITEM rows: when the PROFILE has an embedding, this adapter's
 *     `embedding IS NOT NULL` predicate drops a category+jurisdiction match that
 *     happens to lack an item embedding, whereas MemoryPrefilter would surface it
 *     at similarity 0. The ingest loop (runIngest) embeds EVERY item before
 *     upsert, so a persisted item with categories set but a NULL embedding does
 *     not occur in practice - the divergence is unreachable on real data.
 *  2. Spec §7's Stage-A query lists `AND i.last_synced_at > $4` (a freshness
 *     window). We intentionally omit it: scoreBoard scores the FULL current board
 *     for a profile, not just freshly-synced items. Incremental "score only what
 *     changed" windowing is the ingest cursor's job, not the prefilter's.
 *
 * This adapter is read-only (no writes), so it touches neither the audit log nor
 * the approval gate; it only shortlists candidates for the (cost-bearing) judge.
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import type {
  Prefilter,
  PrefilterCandidate,
  PrefilterOpts,
  PrefilterProfile,
} from "@/pipeline/prefilter";
import { items } from "@db/schema";

/**
 * Render a number[] as a pgvector literal string (`[n,n,...]`), SAFELY.
 *
 * pgvector accepts a literal of the form `[1,2,3]`. We validate that every
 * element is a finite number before interpolation so the produced string is
 * always digits / signs / dots / commas - there is no way for caller data to
 * inject SQL. `Number.isFinite` rejects NaN, ±Infinity, and non-numbers. The
 * vector must be non-empty (an empty vector has no meaningful cosine distance).
 */
export function toVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("DrizzlePrefilter: profile embedding must be a non-empty number[]");
  }
  for (const v of embedding) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(
        `DrizzlePrefilter: profile embedding contains a non-finite value (${String(v)}); refusing to build a vector literal`,
      );
    }
  }
  // Each element is a validated finite number → its decimal form is injection-safe.
  return `[${embedding.join(",")}]`;
}

export class DrizzlePrefilter implements Prefilter {
  private readonly db: ReturnType<typeof getDb>;

  /**
   * @param deps.db Optional Drizzle client (injected in tests / for an explicit
   *   transaction handle). Defaults to the lazy shared client from `@/lib/db`,
   *   so constructing this prefilter opens no connection.
   */
  constructor(deps: { db?: ReturnType<typeof getDb> } = {}) {
    this.db = deps.db ?? getDb();
  }

  async prefilter(profile: PrefilterProfile, opts: PrefilterOpts = {}): Promise<PrefilterCandidate[]> {
    const limit = opts.limit ?? env().PREFILTER_LIMIT;
    const embedding = profile.embedding ?? null;

    // jurisdictions / subscribed_categories are bound as text[] PARAMS (not
    // interpolated) so their contents can never break out of the query.
    const jurisdictions = sql.param(profile.jurisdictions);
    const categories = sql.param(profile.subscribed_categories);

    // Stage 0 + jurisdiction WHERE - applied for BOTH ranking modes so a
    // null-embedding profile never bypasses the category/jurisdiction gate.
    const whereClause = sql`${items.jurisdiction} = ANY(${jurisdictions}) and ${items.categories} && ${categories}`;

    if (embedding === null) {
      // No vector to rank against → freshest-first, but the SAME WHERE holds.
      // similarity is reported as 0, matching MemoryPrefilter's fallback.
      const rows = await this.db
        .select({ id: items.id })
        .from(items)
        .where(whereClause)
        .orderBy(sql`${items.lastSyncedAt} desc`)
        .limit(limit);
      return rows.map((r) => ({ id: r.id, similarity: 0 }));
    }

    // SAFE vector literal from a validated finite number[].
    const vec = sql.raw(`'${toVectorLiteral(embedding)}'::vector`);
    // Cosine distance (`<=>`) for ordering; similarity = 1 - distance for output.
    const distance = sql<number>`(${items.embedding} <=> ${vec})`;

    const rows = await this.db
      .select({
        id: items.id,
        similarity: sql<number>`1 - ${distance}`,
      })
      .from(items)
      // embedding IS NOT NULL: NULL embeddings have no meaningful cosine ordering.
      .where(sql`${whereClause} and ${items.embedding} is not null`)
      .orderBy(sql`${distance} asc`)
      .limit(limit);

    // node-postgres returns numeric/double columns as JS numbers; coerce
    // defensively in case the driver hands back a string for the computed column.
    return rows.map((r) => ({ id: r.id, similarity: Number(r.similarity) }));
  }
}
