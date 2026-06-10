/**
 * Stage A — pgvector prefilter (spec §7). Cheap embedding shortlist before the
 * (cost-bearing) Stage B judge. Behind a `Prefilter` interface so the ranking is
 * testable hermetically (MemoryPrefilter, cosine in JS); the production
 * DrizzlePrefilter runs the equivalent SQL:
 *
 *   SELECT i.id, 1 - (i.embedding <=> $1) AS similarity
 *   FROM items i
 *   WHERE i.jurisdiction = ANY($2) AND i.categories && $3 AND i.last_synced_at > $4
 *   ORDER BY i.embedding <=> $1 LIMIT 50;
 *
 * Stage 0 (category intersection) and jurisdiction are applied here as the WHERE
 * clause; the embedding orders what survives.
 */
import { env } from "@/lib/env";

export interface PrefilterableItem {
  id: string;
  jurisdiction: string;
  categories: string[];
  embedding: number[];
}

export interface PrefilterCandidate {
  id: string;
  similarity: number;
}

export interface PrefilterProfile {
  embedding?: number[] | null;
  jurisdictions: string[];
  subscribed_categories: string[];
}

export interface PrefilterOpts {
  limit?: number;
}

export interface Prefilter {
  /** Top candidates for a profile, ordered by descending cosine similarity. */
  prefilter(profile: PrefilterProfile, opts?: PrefilterOpts): Promise<PrefilterCandidate[]>;
}

/** Cosine similarity of two equal-length vectors. 0 if either is zero/empty. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * In-memory Stage-A prefilter over a fixed item set. Applies the same WHERE
 * semantics as the SQL (jurisdiction membership + category overlap) and orders
 * by cosine similarity to the profile embedding. Used by tests and the
 * (DB-free) dashboard demo path.
 */
export class MemoryPrefilter implements Prefilter {
  constructor(private readonly items: PrefilterableItem[]) {}

  async prefilter(profile: PrefilterProfile, opts: PrefilterOpts = {}): Promise<PrefilterCandidate[]> {
    const limit = opts.limit ?? env().PREFILTER_LIMIT;
    const jurisdictions = new Set(profile.jurisdictions);
    const subscribed = new Set(profile.subscribed_categories);
    const emb = profile.embedding ?? null;

    return this.items
      .filter((i) => jurisdictions.has(i.jurisdiction))
      .filter((i) => i.categories.some((c) => subscribed.has(c)))
      .map((i) => ({ id: i.id, similarity: emb ? cosineSimilarity(emb, i.embedding) : 0 }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
