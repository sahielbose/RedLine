# Data model

> Expands [`REDLINE_MASTER_SPEC.md` §6](./REDLINE_MASTER_SPEC.md#6-data-model).
> The canonical SQL is in spec §6; this doc explains **why each column exists** and which TypeScript type it maps to in `src/lib/types.ts`.
> Multi-tenant from line one — `org_id` appears on every business-scoped table.
> Siblings: [PIPELINE](./PIPELINE.md) · [DATA_SOURCES](./DATA_SOURCES.md) · [TAXONOMY](./TAXONOMY.md) · [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md).

## Conventions

- Postgres with the `vector` extension (`CREATE EXTENSION IF NOT EXISTS vector`). Mirror the SQL in `db/schema.ts` (Drizzle).
- All primary keys are `uuid DEFAULT gen_random_uuid()`. All timestamps are `timestamptz`.
- **`EMBED_DIM` must match the embedder** (`src/lib/env.ts`, default 384): hash / bge-small = 384, nomic = 768, openai-3-small = 1536. The spec SQL shows `vector(1536)` as an example; the actual column dimension follows `EMBED_DIM`. A mismatch fails inserts loudly — that is intended.
- Enum-like text columns are constrained at the type layer by the `as const` unions in `src/lib/types.ts`, not by DB CHECKs, so a new category/stage/source is one edit in one file.

---

## `organizations`
The tenant root. `name`, `created_at`. Everything business-scoped references `organizations(id)`.

## `users`
`org_id` (FK), `email UNIQUE`, `role` (default `member`). Auth.js magic-link in v1 (stub day one). `users.id` is the actor recorded in `memos.approved_by` and referenced by `audit_log` / `relevance_feedback`.

## `org_profiles` — the business profile
Maps to `BusinessProfile` + `ProfileAttributes` in `src/lib/types.ts`. Built by onboarding ([ONBOARDING](./ONBOARDING.md)).

| Column | Type maps to | Why it exists |
|---|---|---|
| `org_id` | — | Tenant scope. |
| `business_types text[]` | `BusinessType[]` (= `MODULE_CATEGORIES`: `software`/`goods`/`food`/`hardware`) | Which modules toggled on. Drives `subscribed_categories`. |
| `jurisdictions text[]` | `string[]` (`'us'`,`'us-ca'`,…) | Stage A filter (`items.jurisdiction = ANY`). |
| `attributes jsonb` | `ProfileAttributes` | Structured onboarding answers, **including negatives** (`imports_goods:false`, `serves_food:false`) that make the judge reject off-target rules. Typed keys + an index signature keep it extensible. |
| `subscribed_categories text[]` | `Category[]` | Base (always 8) + module cats. The Stage 0 intersection set. |
| `concern_text text` | `string` | Generated free-text encoding positives **and** negatives; embedded and handed to the Stage B judge. |
| `embedding vector(EMBED_DIM)` | `number[] \| null` | Stage A prefilter operand (`profile.embedding <=> item.embedding`). |
| `is_active boolean` | `boolean` | Scoring iterates only active profiles. |

## `items` — unified bill **and** rule
Maps to the stored superset of `NormalizedItem` (`src/lib/types.ts`). `type` discriminates a statute from a rulemaking; `source` says which API it came from.

| Column | Maps to | Why |
|---|---|---|
| `source text` | `Source` (`congress`/`federal_register`/`regulations_gov`/`openstates`) | Provenance + per-source dedup. |
| `external_id text` | `external_id` | Stable source id; half of the dedup key. |
| `jurisdiction text` | `jurisdiction` (`'us'`,`'us-ca'`) | Stage A jurisdiction filter; map shading. |
| `type text` | `ItemType` | bill / resolution / proposed_rule / final_rule / notice / docket. |
| `identifier text` | `identifier` | Human id (`TX-HB-892`); rendered mono in the UI. |
| `title`, `summary`, `full_text_url`, `full_text` | same | Display + memo source text. `full_text` fetched lazily for memo gen. |
| `status text`, `stage text` | `status`, `Stage` | `stage` is the normalized lifecycle bucket (`STAGES`): proposed / comment_open / finalized / in_effect / contested_vacated — drives the Tracker kanban. |
| `introduced_date date`, `last_action_date timestamptz`, `last_action_text` | same | Recency ordering + STATUS card facts. |
| `comment_close_date date` | same | Powers comment-deadline alerts. |
| `sponsors jsonb`, `subjects text[]` | `unknown[]`, `string[]` | Source-native sponsor list + subject tags. No PII directory built from these (see guardrails). |
| `categories text[]` | `Category[]` | Taxonomy tags set at ingest (Stage 0). GIN-indexed. |
| `raw jsonb` | `unknown` | Full source payload — the auditable ground truth behind every claim. |
| `content_hash text` | `content_hash` | Change detection; unchanged hash = no new status-history row. |
| `embedding vector(EMBED_DIM)` | `number[]` | Stage A operand; HNSW-indexed. |
| `first_seen_at`, `last_synced_at`, `updated_at` | — | First sighting, last poll touch, last content change. |

**Indexes & why:**
- `UNIQUE (source, external_id)` — idempotent upsert; re-running a sync never duplicates.
- `USING hnsw (embedding vector_cosine_ops)` — fast Stage A nearest-neighbour.
- `USING gin (categories)` — the `categories && subscribed_categories` Stage 0 / Stage A array-overlap.
- `(jurisdiction, last_action_date DESC)` — the recent-by-state read the feed and map make constantly.

## `item_status_history` — the "no missed amendment" backbone
Append-only. `item_id`, `status`, `action_text`, `action_date`, `raw`, `recorded_at`. A row is written **every time** a poll observes a change (new `content_hash` / new action). This is what proves a late amendment was caught, feeds the Tracker, and backs the item-detail timeline. Never updated in place.

## `relevance_judgments` — the trust-tuning log
Maps to `Judgment` (`src/lib/types.ts`). **Every** relevance decision is logged, forever — including the ones that filtered an item *out*.

| Column | Maps to | Why |
|---|---|---|
| `item_id`, `org_id` | — | Which item, which business. |
| `stage text` | `PipelineStage` (`category`/`prefilter`/`llm_judge`) | Where the decision happened. |
| `score int` | `score` (0–5) | The rubric score (judge stage). |
| `similarity double precision` | `similarity` | Cosine similarity (prefilter stage). |
| `justification text` | `justification` | One concrete sentence (judge). |
| `matched_concern text` | `matched_concern` | Which profile element matched, or null. |
| `model`, `prompt_version`, `rubric_version` | same | Reproducibility — `RUBRIC_VERSION`/`PROMPT_VERSION` are `v1` in `types.ts`. Bump on any prompt change so old judgments stay attributable. |

Index `(org_id, created_at DESC)` — the per-org audit/debug read.

## `memos` — cited, draft-until-approved
Maps to `MemoContent` + `MemoStatus`.

| Column | Maps to | Why |
|---|---|---|
| `item_id`, `org_id`, `judgment_id` | — | The item, the business, the judgment that triggered it. |
| `what_it_does`, `status_and_next_steps`, `who_is_affected` | same | The four-part memo body. |
| `recommended_action text` | `RecommendedAction` (`comment`/`monitor`/`call_counsel`/`no_action`) | Action chip; links to **official portals only**, never a person. |
| `recommended_action_note` | same | Free-text rationale. |
| `impact_estimate text` | `string \| null` | **Labeled** estimate + assumptions, or empty. **Never** a bare fabricated number (enforced in code + prompt). |
| `citations jsonb` | `Citation[]` (`{claim, snippet, locator, verified}`) | `verified` is set by **code** (whitespace-normalized substring check), not the model. |
| `confidence`, `model`, `prompt_version` | same | Calibration + reproducibility. |
| `status text` | `MemoStatus` (default `draft`) | The approval gate. Nothing sends from `draft`. |
| `approved_by`, `approved_at` | — | Who approved, when. |

## `tracked_items`
`org_id`, `item_id`, `note`, `added_at`, `UNIQUE(org_id, item_id)`. Backs the Tracker kanban (by `items.stage`). The unique constraint makes "track" idempotent.

## `relevance_feedback`
👍/👎 on flagged items → labels for the eval set. `org_id`, `item_id`, `judgment_id`, `user_id`, `label` (`relevant`/`not_relevant`). The human-in-the-loop signal that grows [EVALS](./EVALS.md).

## `audit_log`
Every state change → one row: `org_id`, `actor` (user uuid or `'system'`), `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`. A trust feature **and** a debugger. See [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#audit-log).

## `sync_state`
`source PRIMARY KEY`, `cursor`, `last_run_at`. One row per `SourceClient`; the cursor is the opaque "changed since" token that makes polling incremental ([DATA_SOURCES](./DATA_SOURCES.md)).

---

## Entity map

```
organizations ─┬─ users ──────────── memos.approved_by
               ├─ org_profiles (attrs + embedding)
               ├─ relevance_judgments ── judgment_id ── memos
               ├─ tracked_items
               ├─ relevance_feedback
               └─ audit_log
items ─┬─ item_status_history   (append-only)
       ├─ relevance_judgments / memos / tracked_items / relevance_feedback
sync_state  (per source, standalone)
```
