/**
 * Per-business scoring orchestrator (spec §7) — ties the three stages together:
 *   Stage 0  category intersection (inside the prefilter's WHERE)
 *   Stage A  pgvector/cosine prefilter → top-K candidates
 *   Stage B  LLM rubric judge → score 0–5 (+ logged judgment)
 * then drafts a memo for anything at/above MEMO_THRESHOLD.
 *
 * This is the engine behind the dashboard board (`scoreBoard` per profile) and
 * the digest. Pure with respect to I/O: the LLM, prefilter, and judgment sink
 * are injected, so it runs hermetically (HeuristicLLM + MemoryPrefilter) and in
 * production (real LLM + DrizzlePrefilter + DB logging) unchanged.
 */
import type { LLM } from "@/lib/interfaces";
import { env } from "@/lib/env";
import { MemoryPrefilter, type Prefilter } from "@/pipeline/prefilter";
import { judge } from "@/pipeline/judge";
import { generateMemo, type MemoDraft } from "@/pipeline/memo";
import { severityLabel, type BusinessProfile, type Judgment, type SeverityLabel } from "@/lib/types";
import type { JudgeableItem } from "@/pipeline/relevance";

/**
 * An item ready for scoring: judgeable + the fields the prefilter needs, with
 * `id`/`jurisdiction`/`categories`/`embedding` REQUIRED (narrowing JudgeableItem's
 * optional versions). Structurally assignable to PrefilterableItem.
 */
export interface ScorableItem extends JudgeableItem {
  id: string;
  jurisdiction: string;
  categories: string[];
  embedding: number[];
}

export interface ScoredItem {
  id: string;
  item: ScorableItem;
  similarity: number;
  judgment: Judgment;
  score: number;
  severity: SeverityLabel;
  memo?: MemoDraft;
}

export interface ScoreBoardArgs {
  profile: BusinessProfile;
  items: ScorableItem[];
  llm: LLM;
  /** Stage-A prefilter; defaults to an in-memory cosine prefilter over `items`. */
  prefilter?: Prefilter;
  /** score >= this drafts a memo (default env().MEMO_THRESHOLD). */
  memoThreshold?: number;
  /** Generate memos for high scores (default true). */
  withMemos?: boolean;
  prefilterLimit?: number;
  /** Sink for every judgment (→ relevance_judgments in production). */
  onJudgment?: (j: Judgment, itemId: string) => void | Promise<void>;
}

export interface ScoreBoard {
  profileId: string;
  surfaced: ScoredItem[];
  /** Items dropped by Stage 0/A (category/jurisdiction) — never reached the judge. */
  filteredOut: number;
}

/**
 * Score every item for one profile and return a sorted board. Items that fail
 * Stage 0/A (no category overlap / wrong jurisdiction) are counted as
 * `filteredOut` and never reach the (cost-bearing) judge.
 */
export async function scoreBoard(args: ScoreBoardArgs): Promise<ScoreBoard> {
  const { profile, items, llm } = args;
  const prefilter = args.prefilter ?? new MemoryPrefilter(items);
  const threshold = args.memoThreshold ?? env().MEMO_THRESHOLD;
  const withMemos = args.withMemos ?? true;
  const byId = new Map(items.map((i) => [i.id, i]));

  // True Stage-0 reject count (category/jurisdiction), independent of the
  // prefilter top-K cap — so a board with >LIMIT matches doesn't mislabel
  // capped-but-relevant items as "filtered out".
  const jur = new Set<string>(profile.jurisdictions);
  const subs = new Set<string>(profile.subscribed_categories);
  const stage0Rejected = items.filter(
    (i) => !(jur.has(i.jurisdiction) && i.categories.some((c) => subs.has(c))),
  ).length;

  const candidates = await prefilter.prefilter(profile, { limit: args.prefilterLimit });

  const surfaced: ScoredItem[] = [];
  for (const c of candidates) {
    const item = byId.get(c.id);
    if (!item) continue;

    const judgment = await judge({
      profile,
      item,
      llm,
      onJudgment: args.onJudgment ? (j) => args.onJudgment!(j, item.id) : undefined,
    });

    const scored: ScoredItem = {
      id: item.id,
      item,
      similarity: c.similarity,
      judgment,
      score: judgment.score,
      severity: severityLabel(judgment.score),
    };

    if (withMemos && judgment.score >= threshold) {
      scored.memo = await generateMemo({ profile, item, llm });
    }
    surfaced.push(scored);
  }

  // Highest threat first; ties broken by embedding similarity.
  surfaced.sort((a, b) => b.score - a.score || b.similarity - a.similarity);

  return {
    profileId: profile.id,
    surfaced,
    filteredOut: stage0Rejected,
  };
}
