/**
 * Congress.gov API v3 SourceClient (spec §5, DATA_SOURCES.md → `key: 'congress'`).
 *
 * Federal bills + resolutions. Auth is a free api.data.gov key (`?api_key=`);
 * 5,000 req/hr, ≤250 items/page. There is NO full-text search on the list
 * endpoint — we poll "changed since cursor" over UPDATE time
 * (`fromDateTime`/`toDateTime`), sorted by `updateDate`, and filter locally
 * downstream (Stage 0/A/B). Full bill text is fetched lazily, per-bill, only at
 * memo time via `fetchFullText`.
 *
 * Two exports:
 *  - `normalizeCongressBill(raw)` — PURE map of one /bill list entry →
 *    NormalizedItem. No I/O, no fabrication (absent fields → null).
 *  - `CongressClient` — implements SourceClient. Constructor takes optional
 *    `{ apiKey, fetchImpl }` so tests inject a fixture-returning fetch and never
 *    hit the live API.
 */
import type { SourceClient } from "@/lib/interfaces";
import type { ItemType, NormalizedItem, Stage } from "@/lib/types";
import { contentHashFor } from "@/lib/hash";
import { fetchJson } from "@/sources/http";

const BASE = "https://api.congress.gov/v3";

/** Cold-start lookback when no cursor is supplied (ISO datetime, ms = false). */
const DEFAULT_LOOKBACK_DAYS = 7;

/** Congress.gov caps list pages at 250 items (spec §5). */
const PAGE_LIMIT = 250;

/** Safety cap on pages walked per fetchSince (stays well under 5,000 req/hr). */
const MAX_PAGES = 20;

// ── Raw shapes (only the fields we read; everything else is preserved in `raw`) ──
// Paraphrased from the public /bill list + /bill/{...} response shape.

export interface RawCongressLatestAction {
  actionDate?: string | null; // 'YYYY-MM-DD'
  actionTime?: string | null; // 'HH:MM:SS' (sometimes present)
  text?: string | null;
}

export interface RawCongressSponsor {
  bioguideId?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  party?: string | null;
  state?: string | null;
  district?: number | null;
}

export interface RawCongressSummary {
  text?: string | null;
  actionDate?: string | null;
  updateDate?: string | null;
}

export interface RawCongressBill {
  congress?: number | null;
  type?: string | null; // 'HR', 'S', 'HJRES', 'SRES', ...
  number?: string | number | null;
  title?: string | null;
  updateDate?: string | null; // ISO date or datetime — the polling watermark
  updateDateIncludingText?: string | null;
  introducedDate?: string | null; // 'YYYY-MM-DD'
  originChamber?: string | null;
  latestAction?: RawCongressLatestAction | null;
  sponsors?: RawCongressSponsor[] | null;
  policyArea?: { name?: string | null } | null;
  // The list endpoint usually returns subjects only as a sub-resource link, but
  // detail responses may inline a legislativeSubjects array — read it if present.
  subjects?:
    | {
        legislativeSubjects?: { name?: string | null }[] | null;
        policyArea?: { name?: string | null } | null;
      }
    | null;
  // Link the detail endpoint exposes; we surface it as full_text_url for lazy text.
  textVersions?: { url?: string | null } | null;
  url?: string | null; // canonical API url for the bill
}

interface RawBillListResponse {
  bills?: RawCongressBill[];
  pagination?: { count?: number; next?: string | null };
}

interface RawTextVersionsResponse {
  textVersions?: {
    type?: string | null;
    date?: string | null;
    formats?: { type?: string | null; url?: string | null }[] | null;
  }[];
}

// ── Mapping helpers (pure) ───────────────────────────────────────────────────

/** Resolution bill types per Congress.gov: *RES (incl. joint/concurrent). */
function billTypeToItemType(type: string | null | undefined): ItemType {
  const t = (type ?? "").toUpperCase();
  return t.endsWith("RES") ? "resolution" : "bill";
}

/** 'HR' + '1234' → 'HR-1234'; null if we can't form a real identifier. */
function makeIdentifier(type: string | null | undefined, number: unknown): string | null {
  const t = (type ?? "").toUpperCase().trim();
  const n = number === null || number === undefined ? "" : String(number).trim();
  if (!t || !n) return null;
  return `${t}-${n}`;
}

/**
 * Map a Congress.gov latestAction → normalized Stage, from the action text only.
 * Conservative: unknown/early actions → 'proposed'; only clear terminal signals
 * map to 'finalized'/'in_effect'. Never fabricate a stage we can't read.
 */
export function stageFromAction(actionText: string | null | undefined): Stage | null {
  if (!actionText) return null;
  const t = actionText.toLowerCase();

  // Enacted / signed into law → in effect.
  if (
    t.includes("became public law") ||
    t.includes("became private law") ||
    t.includes("signed by president") ||
    t.includes("enacted")
  ) {
    return "in_effect";
  }

  // Vetoed / failed / withdrawn → contested/vacated bucket.
  if (
    t.includes("vetoed") ||
    t.includes("failed") ||
    t.includes("motion to table agreed") ||
    t.includes("withdrawn")
  ) {
    return "contested_vacated";
  }

  // Passed/agreed-to a chamber, or presented to the president → finalized leg. step.
  if (
    t.includes("passed") ||
    t.includes("agreed to") ||
    t.includes("resolution agreed") ||
    t.includes("presented to president") ||
    t.includes("cleared for white house")
  ) {
    return "finalized";
  }

  // Introduced / referred / reported / placed on calendar → proposed.
  return "proposed";
}

/** Combine actionDate (+ optional actionTime) into an ISO datetime, or null. */
function actionToIso(action: RawCongressLatestAction | null | undefined): string | null {
  const date = action?.actionDate?.trim();
  if (!date) return null;
  const time = action?.actionTime?.trim();
  // 'YYYY-MM-DD' (+ 'HH:MM:SS') → ISO UTC. Only parse fields the API gave us.
  const iso = time ? `${date}T${time}Z` : `${date}T00:00:00Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize an ISO-ish date/datetime string to a full ISO datetime, or null. */
function toIsoDateTime(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  // Bare date → midnight UTC; otherwise let Date parse the datetime.
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Pull a non-empty subjects[] from policyArea + legislativeSubjects, deduped. */
function collectSubjects(raw: RawCongressBill): string[] {
  const out: string[] = [];
  const policy = raw.policyArea?.name?.trim() || raw.subjects?.policyArea?.name?.trim();
  if (policy) out.push(policy);
  for (const s of raw.subjects?.legislativeSubjects ?? []) {
    const name = s?.name?.trim();
    if (name) out.push(name);
  }
  return Array.from(new Set(out));
}

/**
 * The full-text pointer. The /bill list entry doesn't carry the text body; it
 * carries a `textVersions` sub-resource URL (or the bill's canonical `url`). We
 * record whichever is present so `fetchFullText` can resolve it lazily.
 */
/** Bill type → the public Congress.gov URL segment. */
const CONGRESS_URL_SEGMENT: Record<string, string> = {
  HR: "house-bill",
  S: "senate-bill",
  HJRES: "house-joint-resolution",
  SJRES: "senate-joint-resolution",
  HCONRES: "house-concurrent-resolution",
  SCONRES: "senate-concurrent-resolution",
  HRES: "house-resolution",
  SRES: "senate-resolution",
};

/** The PUBLIC, human-facing Congress.gov bill page - NOT the api.congress.gov
 *  endpoint (raw.textVersions.url / raw.url), which requires an API key and
 *  returns JSON. We build it from congress + type + number so the "official
 *  source" link a user clicks lands on a readable page, never an API error. */
function fullTextUrl(raw: RawCongressBill): string | null {
  const congress = raw.congress;
  const type = (raw.type ?? "").toUpperCase().trim();
  const number = raw.number == null ? "" : String(raw.number).trim();
  const segment = CONGRESS_URL_SEGMENT[type];
  if (congress && segment && number) {
    return `https://www.congress.gov/bill/${congress}th-congress/${segment}/${number}`;
  }
  return null; // no public link we can build; never expose the key-gated API url
}

// ── Pure normalize ───────────────────────────────────────────────────────────

export function normalizeCongressBill(raw: RawCongressBill): NormalizedItem {
  const congress = raw.congress ?? null;
  const type = (raw.type ?? "").toUpperCase().trim();
  const number = raw.number ?? null;

  // external_id: `${congress}-${type}-${number}` (stable across re-polls).
  const external_id = [congress, type, number]
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("-");

  const latestAction = raw.latestAction ?? null;
  const last_action_text = latestAction?.text?.trim() || null;
  const last_action_date = actionToIso(latestAction);

  // summary: only if the API actually returned summary text; else null.
  const summary = null; // list endpoint carries no summary text — never fabricate one.

  const item: NormalizedItem = {
    source: "congress",
    external_id,
    jurisdiction: "us",
    type: billTypeToItemType(type),
    identifier: makeIdentifier(type, number),
    title: raw.title?.trim() || external_id,
    summary,
    full_text_url: fullTextUrl(raw),
    full_text: null,
    status: last_action_text, // status mirrors the latest action text (no separate status field)
    stage: stageFromAction(last_action_text),
    introduced_date: raw.introducedDate?.trim() || null,
    last_action_date,
    last_action_text,
    comment_close_date: null, // bills have no comment period — that's Federal Register / Regs.gov
    sponsors: Array.isArray(raw.sponsors) ? raw.sponsors : [],
    subjects: collectSubjects(raw),
    raw,
    content_hash: "", // set below
  };

  item.content_hash = contentHashFor(item);
  return item;
}

/**
 * Variant normalizer for when a summary IS present (e.g. a detail response or a
 * pre-joined list entry that inlines the latest summary). Kept separate so the
 * list-path normalizer never invents a summary the list endpoint didn't send.
 */
export function normalizeCongressBillWithSummary(
  raw: RawCongressBill,
  summaryText: string | null,
): NormalizedItem {
  const item = normalizeCongressBill(raw);
  const summary = summaryText?.trim() || null;
  if (summary === item.summary) return item;
  const next = { ...item, summary };
  next.content_hash = contentHashFor(next);
  return next;
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface CongressClientDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Clock injectable for deterministic cold-start windows / cursors in tests. */
  now?: () => Date;
}

export class CongressClient implements SourceClient {
  readonly key = "congress" as const;
  private readonly apiKey?: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => Date;

  constructor(deps: CongressClientDeps = {}) {
    this.apiKey = deps.apiKey;
    this.fetchImpl = deps.fetchImpl;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Poll bills changed since `cursor` (an ISO update-time watermark). Cold start
   * (cursor === null) uses a bounded recent lookback, not all of history. Walks
   * up to MAX_PAGES of ≤250 sorted by updateDate asc, normalizes, and returns
   * the new watermark = max updateDate seen (else the request's toDateTime).
   */
  async fetchSince(cursor: string | null): Promise<{ items: NormalizedItem[]; cursor: string }> {
    // Congress.gov rejects sub-second precision (400) — it wants YYYY-MM-DDTHH:MM:SSZ.
    // The cursor we persist can carry milliseconds (from updateDate), so strip here
    // at the query boundary regardless of the source.
    const noMs = (iso: string) => iso.replace(/\.\d{3}(Z|[+-]\d{2}:?\d{2})$/, "$1");
    const toDateTime = noMs(this.now().toISOString());
    const fromDateTime = noMs(cursor ?? this.defaultFrom());

    const items: NormalizedItem[] = [];
    let maxUpdate: string | null = null;
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetchJson<RawBillListResponse>(`${BASE}/bill`, {
        query: {
          api_key: this.apiKey,
          format: "json",
          fromDateTime,
          toDateTime,
          // Value is "updateDate asc"; URLSearchParams encodes the space to '+',
          // yielding the gateway's documented `sort=updateDate+asc`.
          sort: "updateDate asc",
          limit: PAGE_LIMIT,
          offset,
        },
        fetchImpl: this.fetchImpl,
      });

      const bills = res.bills ?? [];
      for (const raw of bills) {
        const item = normalizeCongressBill(raw);
        items.push(item);
        const upd = toIsoDateTime(raw.updateDate);
        if (upd && (maxUpdate === null || upd > maxUpdate)) maxUpdate = upd;
      }

      // Stop when a short page (no more results) or the documented next link is absent.
      if (bills.length < PAGE_LIMIT || !res.pagination?.next) break;
      offset += PAGE_LIMIT;
    }

    // New cursor = max updateDate observed, else the toDateTime watermark (so the
    // window always advances even on an empty poll).
    return { items, cursor: maxUpdate ?? toDateTime };
  }

  /**
   * Lazily fetch the latest bill text version (memo time only). Resolves the
   * recorded `full_text_url` (the /bill/.../text endpoint), then GETs the first
   * 'Formatted Text'/'Text' format URL. Returns the URL of the latest version so
   * the memo layer can fetch the body — or null if none is published yet.
   * (We return a pointer, not the raw HTML body, to avoid hard-coding a parser
   * here; the memo stage owns body retrieval/cleaning.)
   */
  async fetchFullText(item: NormalizedItem): Promise<string | null> {
    const url = item.full_text_url;
    if (!url) return null;
    try {
      const res = await fetchJson<RawTextVersionsResponse>(url, {
        query: { api_key: this.apiKey, format: "json" },
        fetchImpl: this.fetchImpl,
      });
      const versions = res.textVersions ?? [];
      // Latest version = last by date; prefer a formatted-text format URL.
      const latest = [...versions].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? ""),
      )[versions.length - 1];
      const fmt =
        latest?.formats?.find((f) => /text/i.test(f?.type ?? "")) ?? latest?.formats?.[0];
      return fmt?.url?.trim() || null;
    } catch {
      // Text not published / transient error → no text (never fabricate).
      return null;
    }
  }

  private defaultFrom(): string {
    const d = this.now();
    d.setUTCDate(d.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
    return d.toISOString();
  }
}
