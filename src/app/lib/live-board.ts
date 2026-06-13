/**
 * LIVE board: the dashboard read over REAL ingested data (spec §2, §6).
 *
 * Unlike board.ts (which scores the hermetic seeded dataset on demand), this
 * reads what the ingestion + scoring jobs already wrote to Postgres - real bills
 * and rules from Congress.gov, the Federal Register, and Open States, with the
 * relevance judgments + cited memos the pipeline logged for each org profile.
 *
 * It returns the SAME DashboardData/BoardData shape board.ts does, so the UI is
 * an unchanged renderer: the dashboard page prefers this and falls back to the
 * seeded board only when the DB is empty or unreachable. No fabrication anywhere
 * - every field is a column the pipeline populated from a verifiable source.
 */
import { getPool } from "@/lib/db";
import { env } from "@/lib/env";
import { severityLabel, type BusinessProfile, type MemoContent, type RecommendedAction } from "@/lib/types";
import { jurisdictionToPostal } from "@/app/lib/geo";
import { heuristicJudge, type JudgeableItem } from "@/pipeline/relevance";
import type {
  BoardData,
  BoardProfile,
  DashboardData,
  FilteredCard,
  ProfileSummary,
  StateThreat,
  SurfacedCard,
} from "@/app/lib/board";

/** Score at/above which an item is "surfaced" (shown on the board); below this it
 *  lands in the "filtered out" expander with its honest justification. */
const SURFACE_MIN = 3;
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface ProfileRow {
  id: string;
  org_id: string;
  name: string | null;
  business_types: string[];
  jurisdictions: string[];
  concern_text: string | null;
}

interface JudgedRow {
  id: string;
  source: string;
  jurisdiction: string;
  identifier: string | null;
  title: string;
  summary: string | null;
  status: string | null;
  stage: string | null;
  last_action_date: Date | null;
  last_action_text: string | null;
  comment_close_date: Date | null;
  introduced_date: Date | null;
  categories: string[];
  full_text_url: string | null;
  raw: unknown;
  first_seen_at: Date | null;
  score: number | null;
  justification: string | null;
  matched_concern: string | null;
  // memo (nullable - drafted only for high scorers)
  what_it_does: string | null;
  status_and_next_steps: string | null;
  who_is_affected: string | null;
  recommended_action: string | null;
  recommended_action_note: string | null;
  impact_estimate: string | null;
  citations: unknown;
  confidence: string | null;
  memo_status: string | null;
}

/** Human display label/kind for the seeded orgs; user-added profiles derive theirs. */
const ORG_LABELS: Record<string, { label: string; kind: string }> = {
  "saas-remote": { label: "Remote SaaS Co.", kind: "B2B Software" },
  "ecom-goods": { label: "E-commerce Retailer", kind: "Consumer Goods" },
  "food-cpg": { label: "Food CPG Maker", kind: "Food & Beverage" },
  "hardware-maker": { label: "Hardware Maker", kind: "Electronics / Hardware" },
};

const TYPE_KIND: Record<string, string> = {
  software: "B2B Software",
  goods: "Consumer Goods",
  food: "Food & Beverage",
  hardware: "Electronics / Hardware",
  services: "Services",
};

function deriveLabels(p: ProfileRow): { label: string; kind: string; meta: string } {
  const known = p.name ? ORG_LABELS[p.name] : undefined;
  const primaryType = p.business_types[0] ?? "business";
  const kind = known?.kind ?? TYPE_KIND[primaryType] ?? "Your business";
  const label =
    known?.label ??
    (p.name
      ? p.name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "Your business");
  // meta: the leading clause of the generated concern text (real, honest), else a
  // jurisdiction + type summary.
  const lead = (p.concern_text ?? "").split(/[.;]/)[0]?.trim() ?? "";
  const meta = lead
    ? lead.length > 90
      ? lead.slice(0, 88) + "…"
      : lead
    : [primaryType, p.jurisdictions.join(", ")].filter(Boolean).join(" · ");
  return { label, kind, meta };
}

/** Federal agency name for a Federal Register item (from the raw payload), else null. */
function agencyOf(source: string, raw: unknown): string | null {
  if (source !== "federal_register") return null;
  const r = raw as { agencies?: { name?: string | null }[] } | null;
  return r?.agencies?.[0]?.name ?? null;
}

/** Bill sponsors (display names) from the raw payload — Congress + Open States shapes.
 *  Factual public-record names only; empty when the source list endpoint omits them. */
function sponsorsOf(raw: unknown): string[] {
  const r = raw as Record<string, unknown> | null;
  if (!r) return [];
  if (Array.isArray(r.sponsors)) {
    return (r.sponsors as Record<string, unknown>[])
      .map((s) => (s.fullName as string) || [s.firstName, s.lastName].filter(Boolean).join(" "))
      .filter((n): n is string => Boolean(n))
      .slice(0, 3);
  }
  if (Array.isArray(r.sponsorships)) {
    return (r.sponsorships as Record<string, unknown>[])
      .filter((s) => s.classification === "primary" || !s.classification)
      .map((s) => s.name as string)
      .filter(Boolean)
      .slice(0, 3);
  }
  return [];
}

function toIsoDate(d: Date | string | null): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

function memoFrom(r: JudgedRow): MemoContent | null {
  if (r.what_it_does === null && r.who_is_affected === null) return null;
  const citations = Array.isArray(r.citations)
    ? (r.citations as MemoContent["citations"])
    : [];
  const conf = r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
  return {
    what_it_does: r.what_it_does ?? "",
    status_and_next_steps: r.status_and_next_steps ?? "",
    who_is_affected: r.who_is_affected ?? "",
    recommended_action: (r.recommended_action ?? "monitor") as RecommendedAction,
    recommended_action_note: r.recommended_action_note,
    impact_estimate: r.impact_estimate,
    citations,
    confidence: conf,
  };
}

function surfacedCardFrom(r: JudgedRow): SurfacedCard {
  const score = r.score ?? 0;
  const firstSeen = r.first_seen_at ? new Date(r.first_seen_at).getTime() : 0;
  return {
    id: r.id,
    identifier: r.identifier ?? "",
    title: r.title,
    summary: r.summary ?? "",
    source: r.source,
    agency: agencyOf(r.source, r.raw),
    jurisdiction: r.jurisdiction,
    postal: jurisdictionToPostal(r.jurisdiction),
    categories: r.categories ?? [],
    sponsors: sponsorsOf(r.raw),
    score,
    severity: severityLabel(score),
    justification: r.justification ?? "",
    matchedConcern: r.matched_concern,
    status: r.status ?? "",
    stage: r.stage ?? "",
    lastActionDate: toIsoDate(r.last_action_date) || toIsoDate(r.introduced_date),
    commentCloseDate: r.comment_close_date ? toIsoDate(r.comment_close_date) : null,
    provenance: r.last_action_text,
    actionUrl: r.full_text_url,
    isNew: firstSeen > 0 && Date.now() - firstSeen < NEW_WINDOW_MS,
    sample: false,
    memo: memoFrom(r),
  };
}

/** All scored items for one org, newest-judgment-per-item, joined to its memo. */
async function judgedRowsForOrg(orgId: string): Promise<JudgedRow[]> {
  const { rows } = await getPool().query<JudgedRow>(
    `SELECT DISTINCT ON (rj.item_id)
       i.id, i.source, i.jurisdiction, i.identifier, i.title, i.summary,
       i.status, i.stage, i.last_action_date, i.last_action_text, i.comment_close_date,
       i.introduced_date, i.categories, i.full_text_url, i.raw, i.first_seen_at,
       rj.score, rj.justification, rj.matched_concern,
       m.what_it_does, m.status_and_next_steps, m.who_is_affected, m.recommended_action,
       m.recommended_action_note, m.impact_estimate, m.citations, m.confidence,
       m.status AS memo_status
     FROM relevance_judgments rj
     JOIN items i ON i.id = rj.item_id
     LEFT JOIN memos m ON m.item_id = rj.item_id AND m.org_id = rj.org_id
     WHERE rj.org_id = $1 AND rj.score IS NOT NULL
     ORDER BY rj.item_id, rj.created_at DESC`,
    [orgId],
  );
  return rows;
}

function boardFromRows(p: ProfileRow, rows: JudgedRow[], totalItems: number): BoardData {
  const { label, kind, meta } = deriveLabels(p);

  const surfaced: SurfacedCard[] = rows
    .filter((r) => (r.score ?? 0) >= SURFACE_MIN)
    .map(surfacedCardFrom)
    .sort((a, b) => b.score - a.score || (b.lastActionDate > a.lastActionDate ? 1 : -1));

  const filtered: FilteredCard[] = rows
    .filter((r) => (r.score ?? 0) < SURFACE_MIN)
    .map((r) => ({
      id: r.id,
      identifier: r.identifier ?? "",
      title: r.title,
      source: r.source,
      categories: r.categories ?? [],
      score: r.score ?? 0,
      justification: r.justification ?? "",
      sample: false,
    }))
    .sort((a, b) => b.score - a.score);

  const mapByState: Record<string, StateThreat> = {};
  for (const card of surfaced) {
    if (!card.postal || card.score < SURFACE_MIN) continue;
    const cur = mapByState[card.postal];
    if (!cur) {
      mapByState[card.postal] = {
        score: card.score,
        severity: severityLabel(card.score),
        count: 1,
        top: card.title,
      };
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
    profileId: p.id,
    label,
    kind,
    meta,
    surfaced,
    filtered,
    filteredOut: filtered.length,
    totalItems,
    mapByState,
  };
}

function summaryFrom(p: ProfileRow): ProfileSummary {
  const { label, kind, meta } = deriveLabels(p);
  return {
    id: p.id,
    label,
    kind,
    meta,
    businessTypes: p.business_types,
    jurisdictions: p.jurisdictions,
  };
}

/**
 * Read the full dashboard from the DB. Returns null when there is no real data
 * yet (no active profiles or zero judgments) so the caller can fall back to the
 * seeded board. Throws are caught by the caller (DB unreachable → seeded).
 */
export async function computeLiveDashboard(): Promise<DashboardData | null> {
  const pool = getPool();

  const profilesRes = await pool.query<ProfileRow>(
    `SELECT p.id, p.org_id, o.name, p.business_types, p.jurisdictions, p.concern_text
       FROM org_profiles p
       JOIN organizations o ON o.id = p.org_id
      WHERE p.is_active = true
      ORDER BY p.created_at ASC`,
  );
  if (profilesRes.rows.length === 0) return null;

  const totalRes = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM items`);
  const totalItems = Number(totalRes.rows[0]?.count ?? 0);
  if (totalItems === 0) return null;

  const boards: Record<string, BoardData> = {};
  const profiles: ProfileSummary[] = [];
  let anyJudged = false;

  for (const p of profilesRes.rows) {
    const rows = await judgedRowsForOrg(p.org_id);
    if (rows.length > 0) anyJudged = true;
    profiles.push(summaryFrom(p));
    boards[p.id] = boardFromRows(p, rows, totalItems);
  }

  // No org has any scored items yet → let the caller use the seeded board so the
  // UI is never empty before the first `npm run score`.
  if (!anyJudged) return null;

  const coverageRes = await pool.query<{ jurisdiction: string }>(
    `SELECT DISTINCT jurisdiction FROM items WHERE jurisdiction <> 'us'`,
  );
  const stateCoverage = coverageRes.rows
    .map((r) => jurisdictionToPostal(r.jurisdiction))
    .filter((p): p is string => p !== null)
    .map((p) => p.toUpperCase())
    .sort();

  return { boards, profiles, demoMode: false, stateCoverage };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Live scoring for a NEWLY added business ("Add your business" / /api/profiles).
 * Unlike computeLiveDashboard (which reads judgments the scorer already logged),
 * a brand-new profile has no cached judgments, so we score it on the spot:
 * Stage 0 (category gate) + Stage A (jurisdiction + pgvector cosine prefilter)
 * over the REAL ingested items, then the deterministic heuristic judge (instant,
 * free) for each candidate. Returns the same BoardData shape; null if the DB has
 * no items so the caller can fall back to the seeded board.
 * ──────────────────────────────────────────────────────────────────────── */
interface ItemRow {
  id: string;
  source: string;
  jurisdiction: string;
  type: string;
  identifier: string | null;
  title: string;
  summary: string | null;
  status: string | null;
  stage: string | null;
  last_action_date: Date | null;
  last_action_text: string | null;
  comment_close_date: Date | null;
  introduced_date: Date | null;
  categories: string[];
  full_text_url: string | null;
  full_text: string | null;
  raw: unknown;
  first_seen_at: Date | null;
}

export async function computeBoardForProfileLive(profile: BoardProfile): Promise<BoardData | null> {
  const pool = getPool();
  const totalRes = await pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM items`);
  const totalItems = Number(totalRes.rows[0]?.c ?? 0);
  if (totalItems === 0) return null;

  const jurs = profile.jurisdictions?.length ? profile.jurisdictions : ["us"];
  const cats = profile.subscribed_categories ?? [];
  if (cats.length === 0) return null;
  const limit = Math.max(1, Math.min(200, env().PREFILTER_LIMIT));
  const emb = profile.embedding && profile.embedding.length ? profile.embedding : null;
  const order = emb ? `i.embedding <=> $1::vector ASC` : `i.last_action_date DESC NULLS LAST`;
  const vec = emb ? `[${emb.join(",")}]` : "[]";

  const { rows } = await pool.query<ItemRow>(
    `SELECT i.id, i.source, i.jurisdiction, i.type, i.identifier, i.title, i.summary,
            i.status, i.stage, i.last_action_date, i.last_action_text, i.comment_close_date,
            i.introduced_date, i.categories, i.full_text_url, i.full_text, i.raw, i.first_seen_at
       FROM items i
      WHERE i.embedding IS NOT NULL AND i.jurisdiction = ANY($2) AND i.categories && $3
      ORDER BY ${order}
      LIMIT ${limit}`,
    [vec, jurs, cats],
  );

  const surfaced: SurfacedCard[] = [];
  const filtered: FilteredCard[] = [];
  for (const row of rows) {
    const item: JudgeableItem = {
      title: row.title,
      summary: row.summary,
      source: row.source,
      agency: agencyOf(row.source, row.raw),
      categories: row.categories ?? [],
      identifier: row.identifier,
      jurisdiction: row.jurisdiction,
      type: row.type,
      full_text: row.full_text,
    };
    const j = heuristicJudge(profile, item);
    if (j.score >= SURFACE_MIN) {
      surfaced.push(
        surfacedCardFrom({
          ...(row as unknown as JudgedRow),
          score: j.score,
          justification: j.justification,
          matched_concern: j.matched_concern,
          what_it_does: null,
          status_and_next_steps: null,
          who_is_affected: null,
          recommended_action: null,
          recommended_action_note: null,
          impact_estimate: null,
          citations: null,
          confidence: null,
          memo_status: null,
        }),
      );
    } else {
      filtered.push({
        id: row.id,
        identifier: row.identifier ?? "",
        title: row.title,
        source: row.source,
        categories: row.categories ?? [],
        score: j.score,
        justification: j.justification,
        sample: false,
      });
    }
  }

  surfaced.sort((a, b) => b.score - a.score || (b.lastActionDate > a.lastActionDate ? 1 : -1));
  filtered.sort((a, b) => b.score - a.score);

  const mapByState: Record<string, StateThreat> = {};
  for (const card of surfaced) {
    if (!card.postal || card.score < SURFACE_MIN) continue;
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
    filteredOut: filtered.length,
    totalItems,
    mapByState,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Persist a NEWLY added business ("Add your business" / /api/profiles).
 *
 * When the DB is reachable, insert a real organizations row (name = a slug of
 * the business name) and a real org_profiles row from the BusinessProfile that
 * buildProfile produced, mirroring the columns scoreActiveProfiles reads back
 * (business_types, jurisdictions, attributes, subscribed_categories,
 * concern_text, embedding, is_active). Returns the REAL org_profiles.id so the
 * client uses it as the profile id and /api/search's loadProfile(profileId)
 * finds the persisted profile.
 *
 * Returns null when the DB is unreachable (the caller then keeps the synthetic
 * id and the hermetic in-memory behaviour). No fabrication: every column comes
 * verbatim from the structured profile.
 * ──────────────────────────────────────────────────────────────────────── */

/** Slug a business name for organizations.name: lowercased, hyphenated, trimmed. */
function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "business";
}

export async function persistNewProfile(
  profile: BusinessProfile,
  businessName: string,
): Promise<{ orgId: string; profileId: string } | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
      [slugifyName(businessName)],
    );
    const orgId = orgRes.rows[0]?.id;
    if (!orgId) throw new Error("persistNewProfile: no organizations id returned");

    // pgvector literal "[a,b,c]" or NULL when the profile has no embedding.
    const emb =
      profile.embedding && profile.embedding.length ? `[${profile.embedding.join(",")}]` : null;

    const profRes = await client.query<{ id: string }>(
      `INSERT INTO org_profiles
         (org_id, business_types, jurisdictions, attributes,
          subscribed_categories, concern_text, embedding, is_active)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::vector, true)
       RETURNING id`,
      [
        orgId,
        profile.business_types,
        profile.jurisdictions,
        JSON.stringify(profile.attributes ?? {}),
        profile.subscribed_categories,
        profile.concern_text,
        emb,
      ],
    );
    const profileId = profRes.rows[0]?.id;
    if (!profileId) throw new Error("persistNewProfile: no org_profiles id returned");

    await client.query("COMMIT");
    return { orgId, profileId };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* rollback best-effort: the connection may already be unusable */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update an EXISTING org_profiles row in place (edit-your-business). Re-writes the
 * derived fields (types/jurisdictions/attributes/categories/concern_text/embedding)
 * so the re-scored board reflects the edits. Returns the org/profile ids, or null
 * when the id doesn't match a row (client-only profile) or the DB is unreachable.
 */
export async function updateProfile(
  profileId: string,
  profile: BusinessProfile,
  businessName?: string,
): Promise<{ orgId: string; profileId: string } | null> {
  const pool = getPool();
  const emb =
    profile.embedding && profile.embedding.length ? `[${profile.embedding.join(",")}]` : null;
  const res = await pool.query<{ org_id: string }>(
    `UPDATE org_profiles
        SET business_types = $2, jurisdictions = $3, attributes = $4::jsonb,
            subscribed_categories = $5, concern_text = $6, embedding = $7::vector
      WHERE id = $1 AND is_active = true
      RETURNING org_id`,
    [
      profileId,
      profile.business_types,
      profile.jurisdictions,
      JSON.stringify(profile.attributes ?? {}),
      profile.subscribed_categories,
      profile.concern_text,
      emb,
    ],
  );
  const orgId = res.rows[0]?.org_id;
  if (!orgId) return null;
  // Keep the org name in sync so the rename survives a reload (the live board
  // derives the label from the org name, not the in-session form).
  if (businessName) {
    await pool.query(`UPDATE organizations SET name = $2 WHERE id = $1`, [orgId, slugifyName(businessName)]);
  }
  return { orgId, profileId };
}
