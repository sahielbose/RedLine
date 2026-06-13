/**
 * Open States / Plural v3 REST SourceClient (spec §5, DATA_SOURCES.md) - state
 * bills, CALIFORNIA first.
 *
 * AUTH: free key, sent as the `X-API-Key` header (the v3 REST gateway also
 * accepts `?apikey=`; we use the header). Set OPENSTATES_API_KEY in .env.
 *
 * V3 REST ONLY. The legacy GraphQL v2 API is sunset - do not use it.
 *
 * ── COVERAGE / LATENCY VARIES BY STATE ──────────────────────────────────────
 * Open States ingests each state's legislature on a per-state cadence; freshness
 * and field completeness differ between jurisdictions. We ship 1–3 states first
 * (CA first per roadmap) and label the rest as not-yet-covered rather than imply
 * coverage we have not measured. The watermark cursor is therefore effectively
 * per-jurisdiction; this client owns one jurisdiction at a time (default CA),
 * and the orchestrator composes the per-source `sync_state.cursor`.
 *
 * ── THE STATE-REGULATORY-REGISTER GAP (document, do not hide) ────────────────
 * Open States covers BILLS ONLY (statute). Much of what actually hits a small
 * business is state *regulation* - a state agency rulemaking - which lives in
 * each state's regulatory register / OAL-equivalent and is NOT in Open States
 * and NOT in the Federal Register (federal only). An MVP wired to
 * "Open States + Federal Register" will look complete and silently miss state
 * agency rulemakings. We treat this as a labeled coverage gap (surfaced in the
 * UI per TRUST_AND_GUARDRAILS) and roadmap a per-state regulatory-register
 * scraper. Nothing here invents that coverage.
 *
 * Base list query (spec §5):
 *   GET https://v3.openstates.org/bills
 *     ?jurisdiction=California&sort=updated_desc
 *     &include=abstracts&include=sponsorships&include=actions
 *     &updated_since=<ISO watermark>&page=<n>&per_page=<n>
 *
 * Commercial limits are emerging; for scale, self-host their OSS scrapers /
 * bulk data (DATA_SOURCES.md). This client polls "changed since cursor" and
 * leaves categories[] + embedding to the pipeline.
 */
import type { SourceClient } from "@/lib/interfaces";
import type { ItemType, NormalizedItem, Stage } from "@/lib/types";
import { contentHashFor } from "@/lib/hash";
import { fetchJson } from "@/sources/http";

const BASE_URL = "https://v3.openstates.org/bills";
const DEFAULT_PER_PAGE = 20;
/** Cold-start safety cap so we don't page through all of history (spec §5).
 *  Kept low because Open States' free tier rate-limits at ~10 req/min; one run
 *  of <=6 pages stays under the window. Ascending sort + cursor means the next
 *  run resumes at the unfetched tail, so this caps per-run, not total, coverage. */
const MAX_PAGES = 6;
/** Cold start: bounded recent window (DATA_SOURCES.md cursor rule #1). */
const COLD_START_LOOKBACK_DAYS = 30;

// ── Raw v3 shapes (only the fields we read; the rest passes through as `raw`) ─
interface OSAbstract {
  abstract?: string | null;
  note?: string | null;
}
interface OSAction {
  description?: string | null;
  date?: string | null;
  classification?: string[] | null;
  order?: number | null;
}
interface OSSponsorship {
  name?: string | null;
  classification?: string | null;
  entity_type?: string | null;
  primary?: boolean | null;
  person?: { id?: string | null; name?: string | null } | null;
  organization?: { id?: string | null; name?: string | null } | null;
}
export interface OpenStatesBill {
  id: string;
  identifier?: string | null;
  title?: string | null;
  classification?: string[] | null;
  subject?: string[] | null;
  session?: string | null;
  jurisdiction?: { id?: string | null; name?: string | null; classification?: string | null } | null;
  abstracts?: OSAbstract[] | null;
  actions?: OSAction[] | null;
  sponsorships?: OSSponsorship[] | null;
  latest_action_date?: string | null;
  latest_action_description?: string | null;
  openstates_url?: string | null;
  first_action_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
interface OpenStatesPage {
  results?: OpenStatesBill[] | null;
  pagination?: {
    per_page?: number | null;
    page?: number | null;
    max_page?: number | null;
    total_items?: number | null;
  } | null;
}

/** A 2-letter US state code → jurisdiction prefix (e.g. 'CA' → 'us-ca'). */
function jurisdictionFromCode(jurisdictionCode: string): string {
  return jurisdictionCode.toLowerCase();
}

/** 2-letter postal code → the full jurisdiction name the v3 query expects. */
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

export interface OSState {
  /** v3 jurisdiction name, e.g. "California". */
  name: string;
  /** Our normalized jurisdiction code, e.g. "us-ca". */
  code: string;
}

/** Parse "CA,TX,NY" into resolved {name, code} states (unknown codes skipped). */
export function parseStates(csv: string | undefined): OSState[] {
  const codes = (csv ?? "CA")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => STATE_NAMES[c]);
  const seen = new Set<string>();
  const out: OSState[] = [];
  for (const c of codes) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push({ name: STATE_NAMES[c], code: `us-${c.toLowerCase()}` });
  }
  return out.length ? out : [{ name: "California", code: "us-ca" }];
}

/**
 * Normalize a v3 `identifier` like 'AB 123' / 'S.B. 45' into a stable, mono-
 * friendly id scoped by jurisdiction: 'CA-AB-123'. We uppercase, strip dots,
 * and collapse the type/number whitespace. If the source has no identifier we
 * return null (no fabrication).
 */
export function normalizeIdentifier(
  rawIdentifier: string | null | undefined,
  jurisdictionCode = "us-ca",
): string | null {
  if (!rawIdentifier) return null;
  const cleaned = rawIdentifier
    .toUpperCase()
    .replace(/\./g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  // State portion = the part after 'us-' (e.g. 'us-ca' → 'CA').
  const statePart = jurisdictionCode.replace(/^us-?/i, "").toUpperCase() || jurisdictionCode.toUpperCase();
  // 'AB 123' → ['AB','123']; join the whole identifier with hyphens.
  const body = cleaned.split(" ").join("-");
  return `${statePart}-${body}`;
}

/** Map v3 `classification[]` to our ItemType. Bills default to 'bill'. */
function mapType(classification: string[] | null | undefined): ItemType {
  const tags = (classification ?? []).map((c) => c.toLowerCase());
  if (tags.some((t) => t.includes("resolution"))) return "resolution";
  return "bill";
}

/**
 * Map a bill's action history + latest action to our normalized lifecycle
 * Stage. Open States actions carry an OpenCivicData `classification[]`
 * (e.g. 'introduction', 'passage', 'executive-signature', 'became-law',
 * 'withdrawal', 'failure'). We read those real tags only - never guess.
 * Returns null when nothing in the record indicates a stage.
 */
export function mapStage(bill: OpenStatesBill): Stage | null {
  const actionTags = (bill.actions ?? [])
    .flatMap((a) => a.classification ?? [])
    .map((c) => c.toLowerCase());
  const latest = (bill.latest_action_description ?? "").toLowerCase();

  const hasTag = (...needles: string[]) =>
    actionTags.some((t) => needles.some((n) => t.includes(n)));
  const inLatest = (...needles: string[]) =>
    needles.some((n) => latest.includes(n));

  // Contested / dead end (vacated-equivalent for a bill: vetoed, failed, withdrawn).
  if (hasTag("veto", "failure", "withdrawal") || inLatest("vetoed", "failed", "withdrawn"))
    return "contested_vacated";

  // Enacted / chaptered / signed into law → in effect.
  if (hasTag("became-law", "executive-signature", "chapter") || inLatest("chaptered", "approved by the governor", "signed", "enacted", "became law"))
    return "in_effect";

  // Passed both chambers / enrolled but not yet enacted → finalized.
  if (hasTag("passage", "enrollment") || inLatest("enrolled", "passed"))
    return "finalized";

  // Otherwise it's a live bill working through the process.
  if (actionTags.length > 0 || inLatest("introduced", "read", "referred", "committee", "amended"))
    return "proposed";

  return null;
}

/** Extract sponsors as plain pass-through records (no PII fabrication; only what the API returned). */
function mapSponsors(sponsorships: OSSponsorship[] | null | undefined): unknown[] {
  return (sponsorships ?? []).map((s) => ({
    name: s.name ?? s.person?.name ?? s.organization?.name ?? null,
    classification: s.classification ?? null,
    entity_type: s.entity_type ?? null,
    primary: s.primary ?? null,
  }));
}

/**
 * Pure normalizer: one v3 bill → NormalizedItem. No fabrication - absent fields
 * become null. `jurisdictionCode` defaults to 'us-ca' (CA first).
 */
export function normalizeOpenStatesBill(raw: OpenStatesBill, jurisdictionCode = "us-ca"): NormalizedItem {
  const summary = raw.abstracts?.find((a) => a.abstract && a.abstract.trim())?.abstract?.trim() ?? null;
  const lastActionDate = raw.latest_action_date ?? null;
  const lastActionText = raw.latest_action_description ?? null;

  const item: Omit<NormalizedItem, "content_hash"> = {
    source: "openstates",
    external_id: raw.id,
    jurisdiction: jurisdictionFromCode(jurisdictionCode),
    type: mapType(raw.classification),
    identifier: normalizeIdentifier(raw.identifier, jurisdictionCode),
    title: raw.title?.trim() || (raw.identifier ?? raw.id),
    summary,
    full_text_url: raw.openstates_url ?? null,
    full_text: null,
    // Status = the human-readable latest action; stage = our normalized bucket.
    status: lastActionText,
    stage: mapStage(raw),
    introduced_date: raw.first_action_date ?? null,
    last_action_date: lastActionDate,
    last_action_text: lastActionText,
    // Open States bills carry no comment-period metadata (that's federal rules); never invent one.
    comment_close_date: null,
    sponsors: mapSponsors(raw.sponsorships),
    subjects: (raw.subject ?? []).filter((s): s is string => typeof s === "string" && s.length > 0),
    raw,
  };

  return { ...item, content_hash: contentHashFor(item) };
}

export interface OpenStatesClientDeps {
  apiKey?: string;
  /** Legacy single-state: full jurisdiction name, e.g. 'California'. */
  jurisdiction?: string;
  /** Legacy single-state: normalized jurisdiction code, e.g. 'us-ca'. */
  jurisdictionCode?: string;
  /** Multi-state: the states to poll. Overrides env OPENSTATES_STATES. */
  states?: OSState[];
  perPage?: number;
  fetchImpl?: typeof fetch;
}

/** Per-state page budget when polling MORE than one state, to stay under the
 *  free-tier rate window across all states in one run. */
const MULTI_STATE_PAGES = 2;

export class OpenStatesClient implements SourceClient {
  readonly key = "openstates" as const;

  private readonly apiKey?: string;
  private readonly states: OSState[];
  private readonly perPage: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(deps: OpenStatesClientDeps = {}) {
    this.apiKey = deps.apiKey ?? process.env.OPENSTATES_API_KEY;
    this.perPage = deps.perPage ?? DEFAULT_PER_PAGE;
    this.fetchImpl = deps.fetchImpl;
    // Precedence: explicit legacy jurisdiction > explicit states > env > CA.
    if (deps.jurisdiction) {
      this.states = [{ name: deps.jurisdiction, code: deps.jurisdictionCode ?? "us-ca" }];
    } else if (deps.states && deps.states.length) {
      this.states = deps.states;
    } else {
      this.states = parseStates(process.env.OPENSTATES_STATES);
    }
  }

  /** Default cold-start watermark: a bounded recent window, not all of history. */
  private coldStartCursor(): string {
    const since = new Date(Date.now() - COLD_START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    return since.toISOString();
  }

  /** v3 wants YYYY-MM-DDTHH:MM:SS - no ms, no 'Z' (both 400 the gateway). */
  private normSince(raw: string): string {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw.slice(0, 19) : parsed.toISOString().slice(0, 19);
  }

  /** Poll one state "changed since" ascending, paginated; returns items + the max
   *  updated_at seen. Keeps a good partial on a rate-limit error after page 1. */
  private async fetchOneState(
    state: OSState,
    since: string,
    maxPages: number,
    headers: Record<string, string>,
  ): Promise<{ items: NormalizedItem[]; maxUpdated: string }> {
    const items: NormalizedItem[] = [];
    let maxUpdated = since;
    for (let page = 1; page <= maxPages; page++) {
      let data: OpenStatesPage;
      try {
        data = await fetchJson<OpenStatesPage>(BASE_URL, {
          headers,
          query: {
            jurisdiction: state.name,
            sort: "updated_asc",
            // v3 requires REPEATED include params; buildUrl expands the array.
            include: ["abstracts", "sponsorships", "actions"],
            updated_since: since,
            page,
            per_page: this.perPage,
          },
          fetchImpl: this.fetchImpl,
        });
      } catch (err) {
        if (items.length > 0) break;
        throw err;
      }
      const results = data.results ?? [];
      for (const bill of results) {
        items.push(normalizeOpenStatesBill(bill, state.code));
        const u = bill.updated_at ?? null;
        if (u && u > maxUpdated) maxUpdated = u;
      }
      const pg = data.pagination ?? {};
      const maxPage = pg.max_page ?? page;
      if (results.length === 0 || page >= maxPage) break;
    }
    return { items, maxUpdated };
  }

  /**
   * Poll "changed since cursor". Single state: cursor is a plain ISO watermark
   * string (legacy behavior, unchanged). Multiple states: cursor is a JSON map
   * { 'us-ca': watermark, ... } and the page budget is split across states.
   *
   * Ascending sort means an over-budget window's unfetched tail is NEWER than the
   * advanced cursor, so the next poll resumes it (no silent recall hole);
   * boundary re-fetch is dedup-safe (content_hash).
   */
  async fetchSince(cursor: string | null): Promise<{ items: NormalizedItem[]; cursor: string }> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;

    // ── Single state: identical to the original (plain string cursor) ──────────
    if (this.states.length === 1) {
      const since = this.normSince(cursor ?? this.coldStartCursor());
      const { items, maxUpdated } = await this.fetchOneState(this.states[0], since, MAX_PAGES, headers);
      return { items, cursor: maxUpdated };
    }

    // ── Multiple states: per-state watermarks in a JSON cursor map ─────────────
    let map: Record<string, string> = {};
    if (cursor) {
      try {
        const p = JSON.parse(cursor);
        if (p && typeof p === "object") map = p as Record<string, string>;
      } catch {
        /* legacy string cursor → treat as cold start for every state */
      }
    }
    const allItems: NormalizedItem[] = [];
    const nextMap: Record<string, string> = { ...map };
    for (const st of this.states) {
      const since = this.normSince(map[st.code] ?? this.coldStartCursor());
      try {
        const { items, maxUpdated } = await this.fetchOneState(st, since, MULTI_STATE_PAGES, headers);
        allItems.push(...items);
        nextMap[st.code] = maxUpdated;
      } catch {
        // Rate-limited or per-state error: keep prior watermark, try again next run.
        nextMap[st.code] = map[st.code] ?? since;
      }
    }
    return { items: allItems, cursor: JSON.stringify(nextMap) };
  }
}
