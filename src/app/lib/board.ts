/**
 * Server-side board computation for the dashboard. Runs the REAL relevance
 * engine (Stage 0→A→B + memo) over the seeded demo data for every profile, so
 * the UI is a thin renderer and the "Viewing as" switch just swaps precomputed,
 * serializable board data — instant recolor, no keys/DB.
 *
 * `computeBoardForProfile` is also the engine behind the "Add your business"
 * API (/api/profiles): onboarding builds a real BusinessProfile, and this runs
 * the same pipeline over it — so a user-created profile re-scores the board
 * through the actual engine, not a UI imitation.
 *
 * Map shading is driven by STATE-level surfaced items (so the choropleth varies
 * per profile); federal items appear in the rail/cards as a national baseline.
 * Coverage honesty (spec §15): this is clearly-labeled seeded demo data, and
 * state items carry `sample: true`.
 */
import { getEmbedder } from "@/lib/embedder";
import { getLLM } from "@/lib/llm";
import { scoreBoard, type ScorableItem } from "@/pipeline/score";
import { heuristicJudge } from "@/pipeline/relevance";
import { severityLabel, type BusinessProfile, type MemoContent, type SeverityLabel } from "@/lib/types";
import { DEMO_ITEMS, DEMO_PROFILES, type DemoItem } from "@/app/lib/demo-data";
import { jurisdictionToPostal } from "@/app/lib/geo";

export interface SurfacedCard {
  id: string;
  identifier: string;
  title: string;
  summary: string;
  source: string;
  agency: string | null;
  jurisdiction: string;
  postal: string | null;
  categories: string[];
  score: number;
  severity: SeverityLabel;
  justification: string;
  matchedConcern: string | null;
  status: string;
  stage: string;
  lastActionDate: string;
  commentCloseDate: string | null;
  provenance: string | null;
  actionUrl: string | null;
  isNew: boolean;
  sample: boolean;
  memo: MemoContent | null;
}

/** An item the pipeline filtered out BEFORE the judge (Stage 0/A reject), with
 *  an honest engine-produced justification — precision made visible (spec §2). */
export interface FilteredCard {
  id: string;
  identifier: string;
  title: string;
  source: string;
  categories: string[];
  score: number;
  justification: string;
  sample: boolean;
}

export interface StateThreat {
  score: number;
  severity: SeverityLabel;
  count: number;
  /** Title of the highest-scoring item in this state (tile tooltip). */
  top: string;
}

export interface BoardData {
  profileId: string;
  label: string;
  kind: string;
  meta: string;
  surfaced: SurfacedCard[];
  /** Stage-0/A rejects with engine justifications (the "filtered out" expander). */
  filtered: FilteredCard[];
  filteredOut: number;
  totalItems: number;
  mapByState: Record<string, StateThreat>;
}

export interface ProfileSummary {
  id: string;
  label: string;
  kind: string;
  meta: string;
  businessTypes: string[];
  jurisdictions: string[];
}

export interface DashboardData {
  boards: Record<string, BoardData>;
  profiles: ProfileSummary[];
  demoMode: true;
}

/** A profile plus the display strings the switcher renders. */
export type BoardProfile = BusinessProfile & { label: string; kind?: string; meta?: string };

/** Build a ScorableItem (with a deterministic hash embedding) from a demo item. */
function toScorable(item: DemoItem, embedding: number[]): ScorableItem {
  return {
    id: item.id,
    jurisdiction: item.jurisdiction,
    categories: item.categories,
    embedding,
    title: item.title,
    summary: item.summary,
    full_text: item.full_text,
    identifier: item.identifier,
    type: item.type,
    source: item.source,
    agency: item.agency ?? null,
  };
}

/** Display jurisdiction: "Federal" or the state name-ish code ("California" is
 *  resolved client-side from postal; here we keep it simple + serializable). */
export function profileSummaryOf(profile: BoardProfile): ProfileSummary {
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind ?? "Your business",
    meta: profile.meta ?? "",
    businessTypes: profile.business_types,
    jurisdictions: profile.jurisdictions,
  };
}

/**
 * Score the demo dataset for ONE profile through the real pipeline and shape it
 * for the UI. Deterministic + hermetic (heuristic judge + hash embedder by
 * default). Exported for the /api/profiles route ("Add your business").
 */
export async function computeBoardForProfile(profile: BoardProfile): Promise<BoardData> {
  const embedder = getEmbedder();
  const llm = getLLM();

  const itemEmbeddings = await embedder.embed(
    DEMO_ITEMS.map((i) => [i.title, i.summary, i.full_text].join("\n")),
  );
  const byIndex = new Map(DEMO_ITEMS.map((it, i) => [it.id, itemEmbeddings[i]]));
  const itemById = new Map(DEMO_ITEMS.map((it) => [it.id, it]));

  const [profileEmbedding] = await embedder.embed([profile.concern_text]);
  const scorable = DEMO_ITEMS.map((it) => toScorable(it, byIndex.get(it.id)!));

  const board = await scoreBoard({
    profile: { ...profile, embedding: profileEmbedding },
    items: scorable,
    llm,
  });

  const surfaced: SurfacedCard[] = board.surfaced.map((s) => {
    const di = itemById.get(s.id)!;
    return {
      id: s.id,
      identifier: di.identifier,
      title: di.title,
      summary: di.summary,
      source: di.source,
      agency: di.agency ?? null,
      jurisdiction: di.jurisdiction,
      postal: jurisdictionToPostal(di.jurisdiction),
      categories: di.categories,
      score: s.score,
      severity: s.severity,
      justification: s.judgment.justification,
      matchedConcern: s.judgment.matched_concern,
      status: di.status,
      stage: di.stage,
      lastActionDate: di.last_action_date,
      commentCloseDate: di.comment_close_date ?? null,
      provenance: di.provenance ?? null,
      actionUrl: di.action_url ?? null,
      isNew: Boolean(di.is_new),
      sample: Boolean(di.sample),
      memo: s.memo?.content ?? null,
    };
  });

  // Stage-0/A rejects: judge them directly (cheap + deterministic) so the
  // "filtered out" expander shows the REAL reason each item didn't apply.
  const surfacedIds = new Set(surfaced.map((s) => s.id));
  const filtered: FilteredCard[] = DEMO_ITEMS.filter((it) => !surfacedIds.has(it.id)).map((it) => {
    const j = heuristicJudge(profile, toScorable(it, byIndex.get(it.id)!));
    return {
      id: it.id,
      identifier: it.identifier,
      title: it.title,
      source: it.source,
      categories: it.categories,
      score: j.score,
      justification: j.justification,
      sample: Boolean(it.sample),
    };
  });

  // Map shading: STATE-level surfaced items only (federal is a national baseline,
  // shown in the rail/cards) — so the map varies per business. Track the top item.
  const mapByState: Record<string, StateThreat> = {};
  for (const card of surfaced) {
    if (!card.postal || card.score < 3) continue;
    const cur = mapByState[card.postal];
    if (!cur) {
      mapByState[card.postal] = { score: card.score, severity: severityLabel(card.score), count: 1, top: card.title };
    } else {
      cur.count += 1;
      if (card.score > cur.score) {
        cur.score = card.score;
        cur.severity = severityLabel(card.score);
        cur.top = card.title;
      }
    }
  }

  return {
    profileId: profile.id,
    label: profile.label,
    kind: profile.kind ?? "Your business",
    meta: profile.meta ?? "",
    surfaced,
    filtered,
    filteredOut: board.filteredOut,
    totalItems: DEMO_ITEMS.length,
    mapByState,
  };
}

/** Compute the full dashboard dataset for every demo profile. */
export async function computeDashboard(): Promise<DashboardData> {
  const boards: Record<string, BoardData> = {};
  const profiles: ProfileSummary[] = [];

  for (const profile of DEMO_PROFILES) {
    profiles.push(profileSummaryOf(profile));
    boards[profile.id] = await computeBoardForProfile(profile);
  }

  return { boards, profiles, demoMode: true };
}
