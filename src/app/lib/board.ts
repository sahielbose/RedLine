/**
 * Server-side board computation for the dashboard. Runs the REAL relevance
 * engine (Stage 0→A→B + memo) over the seeded demo data for every profile, so
 * the UI is a thin renderer and the "Viewing as" switch just swaps precomputed,
 * serializable board data — instant recolor, no keys/DB.
 *
 * Map shading is driven by STATE-level surfaced items (so the choropleth varies
 * per profile); federal items appear in the rail/cards as a national baseline.
 * Coverage honesty (spec §15): this is clearly-labeled seeded demo data.
 */
import { getEmbedder } from "@/lib/embedder";
import { getLLM } from "@/lib/llm";
import { scoreBoard, type ScorableItem } from "@/pipeline/score";
import type { MemoContent, SeverityLabel } from "@/lib/types";
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
  memo: MemoContent | null;
}

export interface StateThreat {
  score: number;
  severity: SeverityLabel;
  count: number;
}

export interface FloatingCardSet {
  threat: { identifier: string; title: string; headline: string; provenance: string | null } | null;
  status: { identifier: string; stage: string; status: string; lastActionDate: string; commentCloseDate: string | null } | null;
  impact: { identifier: string; whoIsAffected: string; impactEstimate: string | null } | null;
  action: { identifier: string; recommendedAction: string; actionUrl: string | null } | null;
}

export interface BoardData {
  profileId: string;
  label: string;
  surfaced: SurfacedCard[];
  filteredOut: number;
  totalItems: number;
  mapByState: Record<string, StateThreat>;
  floating: FloatingCardSet;
}

export interface ProfileSummary {
  id: string;
  label: string;
  businessTypes: string[];
  jurisdictions: string[];
}

export interface DashboardData {
  boards: Record<string, BoardData>;
  profiles: ProfileSummary[];
  demoMode: true;
}

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

function mostSevere(a: SeverityLabel, score: number): SeverityLabel {
  return score >= 5 ? "Critical" : score >= 4 ? "High" : score >= 3 ? "Monitor" : a;
}

/** Compute the full dashboard dataset for every profile. Deterministic + hermetic. */
export async function computeDashboard(): Promise<DashboardData> {
  const embedder = getEmbedder();
  const llm = getLLM();

  const itemEmbeddings = await embedder.embed(
    DEMO_ITEMS.map((i) => [i.title, i.summary, i.full_text].join("\n")),
  );
  const byIndex = new Map(DEMO_ITEMS.map((it, i) => [it.id, itemEmbeddings[i]]));
  const itemById = new Map(DEMO_ITEMS.map((it) => [it.id, it]));

  const boards: Record<string, BoardData> = {};
  const profiles: ProfileSummary[] = [];

  for (const profile of DEMO_PROFILES) {
    profiles.push({
      id: profile.id,
      label: profile.label,
      businessTypes: profile.business_types,
      jurisdictions: profile.jurisdictions,
    });

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
        memo: s.memo?.content ?? null,
      };
    });

    // Map shading: STATE-level surfaced items only (federal is a national baseline,
    // shown in the rail/cards) — so the choropleth varies per business.
    const mapByState: Record<string, StateThreat> = {};
    for (const card of surfaced) {
      if (!card.postal) continue;
      const cur = mapByState[card.postal];
      if (!cur || card.score > cur.score) {
        mapByState[card.postal] = {
          score: card.score,
          severity: mostSevere(card.severity, card.score),
          count: (cur?.count ?? 0) + 1,
        };
      } else {
        cur.count += 1;
      }
    }

    boards[profile.id] = {
      profileId: profile.id,
      label: profile.label,
      surfaced,
      filteredOut: board.filteredOut,
      totalItems: DEMO_ITEMS.length,
      mapByState,
      floating: buildFloating(surfaced),
    };
  }

  return { boards, profiles, demoMode: true };
}

/** Derive the four auto-cycling cards from the top surfaced item. */
function buildFloating(surfaced: SurfacedCard[]): FloatingCardSet {
  const top = surfaced.find((s) => s.score >= 3) ?? surfaced[0];
  if (!top) return { threat: null, status: null, impact: null, action: null };
  return {
    threat: { identifier: top.identifier, title: top.title, headline: top.justification, provenance: top.provenance },
    status: {
      identifier: top.identifier,
      stage: top.stage,
      status: top.status,
      lastActionDate: top.lastActionDate,
      commentCloseDate: top.commentCloseDate,
    },
    impact: {
      identifier: top.identifier,
      whoIsAffected: top.memo?.who_is_affected ?? top.justification,
      impactEstimate: top.memo?.impact_estimate ?? null,
    },
    action: {
      identifier: top.identifier,
      recommendedAction: top.memo?.recommended_action ?? "monitor",
      actionUrl: top.actionUrl,
    },
  };
}
