# Data sources

> Expands [`REDLINE_MASTER_SPEC.md` §5](./REDLINE_MASTER_SPEC.md#5-data-sources).
> Every source implements the `SourceClient` interface from `src/lib/interfaces.ts` and emits `NormalizedItem` (`src/lib/types.ts`). Do not redefine those shapes.
> Siblings: [ARCHITECTURE](./ARCHITECTURE.md) · [DATA_MODEL](./DATA_MODEL.md) · [PIPELINE](./PIPELINE.md).

## The contract every source codes against

```ts
interface SourceClient {
  key: 'congress' | 'federal_register' | 'openstates' | 'regulations_gov';
  fetchSince(cursor: string | null): Promise<{ items: NormalizedItem[]; cursor: string }>;
  fetchFullText?(item: NormalizedItem): Promise<string | null>;
}
```

- `key` matches `Source` in `src/lib/types.ts`.
- `fetchSince(cursor)` polls **changed-since** and returns the **next** cursor; the orchestrator persists it to `sync_state.cursor`. `cursor === null` is a cold start.
- `fetchFullText` is optional and **lazy** - only called during memo generation, never at ingest, so we don't pull megabytes of bill text we'll never score.
- Each source maps its native payload onto `NormalizedItem`, sets `content_hash` for dedup, and leaves `categories[]` + `embedding` to the pipeline (those are derived downstream).

## Key design consequence (read this first)

**You cannot keyword-search Congress.gov server-side.** So the universal pattern for *every* source is: **poll "changed since cursor" → normalize → upsert → classify + embed → filter locally.** All relevance happens in our pipeline, not in the source query. This is why the cursor + `content_hash` machinery matters more than any clever query.

---

## Per-source reference

### Congress.gov API v3 - `key: 'congress'`
- **Gives:** federal bills, actions, amendments, cosponsors, committees, subjects, summaries, and **text versions**.
- **Auth:** free key from api.data.gov → `CONGRESS_API_KEY` (`src/lib/env.ts`, optional; ingestion-only).
- **Limits:** **5,000 req/hr**, ≤250 items/page.
- **No full-text search on the list endpoint.** Filter by congress / bill type / date. Use `fromDateTime` / `toDateTime` over **update time** for incremental polling.
- **Cursor:** the last `updateDate` (or `toDateTime` watermark) seen, stored as the opaque `sync_state.cursor`. Next poll requests `fromDateTime = cursor`.
- **Full text:** fetched **per bill** via `fetchFullText` only when a memo is being drafted.
- **Maps to:** `type` ∈ `bill`/`resolution`; `jurisdiction = 'us'`.

### Federal Register API v1 - `key: 'federal_register'`
- **Gives:** proposed/final rules, notices, presidential documents; **full-text search**; comment-period metadata.
- **Auth:** **no key.**
- **Limits:** generous. Best source for rules, comment deadlines, and executive actions.
- **Cursor:** publication-date / last-modified watermark; supports filtering by date so incremental polling is straightforward.
- **Maps to:** `type` ∈ `proposed_rule`/`final_rule`/`notice`; `jurisdiction = 'us'`. `comment_close_date` comes from here for federal rules.
- **Why it matters:** executive actions land here, **not** on Congress.gov - e.g. the Section 321 de minimis suspension (eval anchor C) is an EO in the Federal Register, not a bill.

### Regulations.gov API v4 - `key: 'regulations_gov'`
- **Gives:** dockets, documents, **comments + comment close dates**.
- **Auth:** free key from api.data.gov → `REGULATIONS_API_KEY`.
- **Limits:** ~1,000 req/hr.
- **Role:** powers comment-deadline alerts and the official comment-portal links used in `recommended_action` (the only place "Action" ever sends a user - a public portal, never a person).
- **Maps to:** `type` ∈ `docket`/`notice`; `jurisdiction = 'us'`.

### Open States / Plural v3 - `key: 'openstates'`
- **Gives:** **all 50 states + DC + PR** - bills (full-text search), actions, sponsors, votes, legislators.
- **Auth:** free key (`apikey` header) → `OPENSTATES_API_KEY`.
- **Limits / gotchas:** the GraphQL v2 API is sunset - use **v3 REST**. Coverage and latency vary by state. Commercial limits are emerging; for scale, self-host their OSS scrapers / bulk data.
- **Cursor:** per-state `updated_since` watermark. Because coverage varies, the cursor is effectively per-jurisdiction; store the composite in `sync_state.cursor` for the `openstates` row.
- **Maps to:** `type` ∈ `bill`/`resolution`; `jurisdiction = 'us-ca'`, `'us-tx'`, etc.
- **Scope today:** ship 1–3 states first (CA first per roadmap), label the rest as not-yet-covered. **Bills only** - see the gap below.

### LegiScan - backup (not a primary `SourceClient` in v1)
- **Gives:** 50-state bills, full text, status.
- **Auth:** free key + bulk.
- **Role:** cross-check states where Open States lags. Wire as an alternate `openstates`-class adapter if/when coverage demands it.

---

## The state-regulatory-register gap (document, do not hide)

Much of what actually hits a small business is **state *regulation*, not statute** - a state agency rulemaking. That content lives in each state's **regulatory register / OAL-equivalent**, which is:

- **not** in Open States (bills only), and
- **not** in the Federal Register (federal only).

An MVP wired to "Open States + Federal Register" will *look* complete and **silently miss state agency rulemakings**. We treat this as a labeled coverage gap, surfaced honestly in the UI (per [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#coverage-honesty)), and roadmap a **per-state regulatory-register scraper** ([ROADMAP](./ROADMAP.md)). We never imply coverage we have not measured.

---

## Cursor + idempotency rules (all sources)

1. **Cold start:** `cursor === null` → pull a bounded recent window, not all of history.
2. **Incremental:** request "changed since `cursor`"; return the new watermark as the next cursor.
3. **Dedup:** the orchestrator upserts on `UNIQUE(source, external_id)`; an unchanged `content_hash` is a no-op (no new `item_status_history` row). Re-running a sync must never create duplicates or phantom status changes.
4. **Backoff:** respect per-source rate limits with exponential backoff; never burn the 5,000/hr Congress budget on retries.
5. **Lazy text:** `fetchFullText` only at memo time.
