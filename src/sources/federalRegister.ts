/**
 * Federal Register API v1 SourceClient (spec §5, §7; DATA_SOURCES.md).
 *
 * Gives us proposed/final rules, notices, and presidential documents with
 * comment-period metadata - the canonical source for federal rules, comment
 * deadlines, and executive actions (e.g. the Section-321 de minimis suspension,
 * eval anchor C, lands here as an executive action, NOT on Congress.gov).
 *
 * No API key. Incremental polling is by publication_date: the cursor is an ISO
 * publication-date watermark; each poll requests documents published on/after
 * the cursor, newest first, and returns the max publication_date seen as the
 * next cursor. Cold start (cursor === null) pulls a bounded recent window, not
 * all of history (DATA_SOURCES.md cursor rule 1).
 *
 * No fabrication (spec §15): every NormalizedItem field comes from a real API
 * field. Absent dates/fields become null - comment_close_date is parsed only
 * from `comments_close_on`.
 */
import type { SourceClient } from "@/lib/interfaces";
import type { NormalizedItem, Stage } from "@/lib/types";
import { contentHashFor } from "@/lib/hash";
import { fetchJson } from "@/sources/http";

const BASE_URL = "https://www.federalregister.gov/api/v1/documents.json";
const PER_PAGE = 100;
/** Cold-start lookback (days) - a bounded recent window, not all of history. */
const COLD_START_LOOKBACK_DAYS = 30;
/** Safety cap on pages walked per poll so a wide window can't run unbounded. */
const MAX_PAGES = 20;

/** One issuing agency as returned by the Federal Register API. */
interface FRAgency {
  name?: string | null;
  raw_name?: string | null;
}

/** A single documents.json result (only the fields we read are typed). */
export interface FederalRegisterDoc {
  document_number?: string | null;
  title?: string | null;
  abstract?: string | null;
  type?: string | null; // 'Rule' | 'Proposed Rule' | 'Notice' | 'Presidential Document'
  publication_date?: string | null; // ISO date
  comments_close_on?: string | null; // ISO date or null
  effective_on?: string | null; // ISO date or null (used to detect in_effect)
  html_url?: string | null;
  agencies?: FRAgency[] | null;
  regulation_id_numbers?: string[] | null;
  topics?: string[] | null;
  action?: string | null;
}

interface DocumentsResponse {
  count?: number;
  total_pages?: number;
  results?: FederalRegisterDoc[] | null;
}

/** Map a Federal Register `type` string to our NormalizedItem.type. */
function mapType(rawType: string | null | undefined): NormalizedItem["type"] {
  switch ((rawType ?? "").trim()) {
    case "Rule":
      return "final_rule";
    case "Proposed Rule":
      return "proposed_rule";
    default:
      // Notice, Presidential Document, or anything unknown → notice.
      return "notice";
  }
}

/** Is `date` (ISO yyyy-mm-dd) strictly after `today`? Null/invalid ⇒ false. */
function isFutureDate(date: string | null, today: Date): boolean {
  if (!date) return false;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return false;
  // Compare on the date boundary in UTC.
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return t > todayUtc;
}

/**
 * Normalized lifecycle stage (spec §2 Tracker, §6 items.stage):
 *  - proposed_rule + a future comments_close_on → 'comment_open'
 *  - proposed_rule otherwise                    → 'proposed'
 *  - final_rule with a (current/past) effective date → 'in_effect', else 'finalized'
 *  - notice                                     → 'proposed' if a comment window is open, else null
 */
function deriveStage(
  itemType: NormalizedItem["type"],
  commentsCloseOn: string | null,
  effectiveOn: string | null,
  now: Date,
): Stage | null {
  switch (itemType) {
    case "proposed_rule":
      return isFutureDate(commentsCloseOn, now) ? "comment_open" : "proposed";
    case "final_rule":
      // Effective on/before "now" ⇒ in effect; a future/absent effective date ⇒ finalized.
      if (effectiveOn && !isFutureDate(effectiveOn, now)) return "in_effect";
      return "finalized";
    case "notice":
      return isFutureDate(commentsCloseOn, now) ? "comment_open" : null;
    default:
      return null;
  }
}

/** Primary issuing agency name, or null. Used as the Stage-0 agency signal. */
function primaryAgency(doc: FederalRegisterDoc): string | null {
  for (const a of doc.agencies ?? []) {
    const name = a?.name ?? a?.raw_name ?? null;
    if (name && name.trim()) return name.trim();
  }
  return null;
}

/**
 * Pure normalizer: a single Federal Register document → NormalizedItem.
 * Exported for direct unit testing. No network, no fabrication.
 *
 * The issuing agency is set on the typed `agency` field (and mirrored into
 * `subjects` + `raw`), so Stage-0 `classifyItem` - which reads
 * `item.title + item.summary + (item.agency ?? item.source)` - keys on the real
 * agency token (e.g. "Federal Trade Commission"), not just title/summary
 * keyword overlap.
 */
export function normalizeFederalRegisterDoc(
  doc: FederalRegisterDoc,
  now: Date = new Date(),
): NormalizedItem {
  const externalId = (doc.document_number ?? "").trim();
  const itemType = mapType(doc.type);
  const agency = primaryAgency(doc);

  const commentCloseDate = doc.comments_close_on?.trim() || null;
  const effectiveOn = doc.effective_on?.trim() || null;
  const publicationDate = doc.publication_date?.trim() || null;

  const stage = deriveStage(itemType, commentCloseDate, effectiveOn, now);

  // subjects = issuing agency + topics (agency first so it's a strong signal).
  const subjects: string[] = [];
  if (agency) subjects.push(agency);
  for (const t of doc.topics ?? []) {
    if (t && t.trim()) subjects.push(t.trim());
  }

  // last_action_text: prefer the document's `action`, else its `type` label.
  const lastActionText = doc.action?.trim() || doc.type?.trim() || null;

  const hashable = {
    title: doc.title?.trim() || externalId,
    summary: doc.abstract?.trim() || null,
    status: doc.type?.trim() || null,
    stage,
    last_action_date: publicationDate,
    last_action_text: lastActionText,
    full_text_url: doc.html_url?.trim() || null,
    comment_close_date: commentCloseDate,
  };

  return {
    source: "federal_register",
    external_id: externalId,
    jurisdiction: "us",
    type: itemType,
    identifier: externalId || null,
    // The issuing agency is the strongest Stage-0 signal for a rule; expose it on
    // the typed field so classifyItem (which reads item.agency) can key on it.
    agency,
    title: hashable.title,
    summary: hashable.summary,
    full_text_url: hashable.full_text_url,
    status: hashable.status,
    stage,
    // Federal Register documents have no separate "introduced" date.
    introduced_date: null,
    last_action_date: publicationDate,
    last_action_text: lastActionText,
    comment_close_date: commentCloseDate,
    sponsors: [],
    subjects,
    // Capture the agency into raw so Stage-0 classify can read the agency signal.
    raw: { ...doc, agency },
    content_hash: contentHashFor(hashable),
  };
}

/** yyyy-mm-dd for a Date in UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The cold-start lower bound: today minus the lookback window (UTC date). */
function coldStartSince(now: Date): string {
  const d = new Date(now.getTime() - COLD_START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return isoDate(d);
}

export interface FederalRegisterClientDeps {
  /** Injected for hermetic tests; defaults to global fetch in production. */
  fetchImpl?: typeof fetch;
  /** Clock (injectable for deterministic stage/cursor tests). */
  now?: () => Date;
}

/**
 * Federal Register SourceClient. No API key needed.
 *
 * fetchSince(cursor): cursor is an ISO publication-date watermark. Queries
 * documents.json with conditions[publication_date][gte] = cursor (or a bounded
 * cold-start lookback), order=OLDEST, paginating up to MAX_PAGES; normalizes
 * each document; returns { items, cursor } where the next cursor is the max
 * publication_date observed (or the queried floor if nothing came back).
 *
 * Why oldest-first: if a window exceeds MAX_PAGES, we want the UNFETCHED tail to
 * be NEWER than the cursor we advance to, so the next incremental poll picks it
 * up. Newest-first + max-cursor would strand the older tail (a silent recall
 * hole). Boundary re-fetch (items exactly at the cursor day) is dedup-safe.
 */
export class FederalRegisterClient implements SourceClient {
  readonly key = "federal_register" as const;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => Date;

  constructor(deps: FederalRegisterClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl;
    this.now = deps.now ?? (() => new Date());
  }

  async fetchSince(
    cursor: string | null,
  ): Promise<{ items: NormalizedItem[]; cursor: string }> {
    const now = this.now();
    const since = cursor?.trim() || coldStartSince(now);

    const items: NormalizedItem[] = [];
    let maxPublicationDate = since;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetchJson<DocumentsResponse>(BASE_URL, {
        fetchImpl: this.fetchImpl,
        query: {
          "conditions[publication_date][gte]": since,
          per_page: PER_PAGE,
          page,
          order: "oldest",
        },
      });

      const results = res.results ?? [];
      for (const doc of results) {
        const item = normalizeFederalRegisterDoc(doc, now);
        if (!item.external_id) continue; // skip malformed rows (no fabrication)
        items.push(item);
        if (item.last_action_date && item.last_action_date > maxPublicationDate) {
          maxPublicationDate = item.last_action_date;
        }
      }

      const totalPages = res.total_pages ?? 1;
      if (results.length === 0 || page >= totalPages) break;
    }

    return { items, cursor: maxPublicationDate };
  }
}
