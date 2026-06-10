# Architecture

> Expands [`REDLINE_MASTER_SPEC.md` §3](./REDLINE_MASTER_SPEC.md#3-system-architecture) and §4.
> The shared contract lives in `src/lib/types.ts`, `src/lib/interfaces.ts`, and `src/lib/env.ts` — this doc describes how the pieces fit, not new types.
> Siblings: [DATA_SOURCES](./DATA_SOURCES.md) · [DATA_MODEL](./DATA_MODEL.md) · [PIPELINE](./PIPELINE.md) · [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md).

## One sentence

RedLine polls public legislative + regulatory APIs on a schedule, normalizes everything into one `items` table, classifies + embeds each item, scores it against every active business profile through a three-stage relevance funnel, drafts a cited memo for high scorers, and surfaces the result on a map + feed + review queue — with a human approval gate before anything is delivered.

## Why one language

Everything is **TypeScript / Next.js 15 (App Router)**. The "data-heavy" work here is HTTP polling of JSON APIs, one embeddings call, and one LLM call — there is no training, no pandas, no second runtime. One repo, one deploy, one type system end to end. The shared domain types in `src/lib/types.ts` are imported identically by the ingestion sources, the pipeline, the eval harness, and the React app, so a change to (say) `NormalizedItem` is a compile error everywhere it matters instead of a silent drift.

## Components

| Layer | Where | Responsibility |
|---|---|---|
| **Scheduler** | `src/jobs/` (pg-boss) | Cron + queue, both inside Postgres. Hourly federal, daily states. No extra infra. |
| **Sources** | `src/sources/` | One `SourceClient` (`src/lib/interfaces.ts`) per API: `congress`, `federal_register`, `regulations_gov`, `openstates`. Each polls "changed since cursor", normalizes to `NormalizedItem`, returns the next cursor. |
| **Normalize + upsert** | pipeline ingest path | Dedup by `UNIQUE(source, external_id)` + `content_hash`; append a row to `item_status_history` on every observed change. |
| **Classify** | `src/pipeline/classify.ts` | Stage 0 — tag `categories[]` from agency/keyword rules (recall-first), small LLM classifier later. |
| **Embed** | `src/lib/embedder.ts` behind `Embedder` | Vector for `items.embedding` and `org_profiles.embedding`. |
| **Relevance funnel** | `src/pipeline/{prefilter,judge}.ts` | Stage 0 → Stage A (pgvector) → Stage B (LLM rubric judge). Every decision logged. |
| **Memo** | `src/pipeline/memo.ts` | Structured memo + **code-verified** citations; saved `status='draft'`. |
| **Delivery** | `src/pipeline/digest.ts` behind `Mailer` | Daily/weekly digest of **approved** memos only. |
| **Web app** | `src/app/` | Overview map · Bills feed · Alerts/review queue · Tracker · the "Viewing as" profile switcher. |
| **DB** | Postgres + pgvector, `db/` (Drizzle) | Single store for data, vectors, queue, and audit. |

## Data flow (the happy path)

```
pg-boss tick
  → SourceClient.fetchSince(cursor)         // poll changed-since
  → normalize → upsert items                 // dedup on (source, external_id) + content_hash
  → diff vs prior → append item_status_history
  → classify (Stage 0)  → items.categories[]
  → embed               → items.embedding
  ── for each active org_profile ──
     Stage 0  categories ∩ subscribed_categories   (else stop: never reaches the judge)
     Stage A  pgvector cosine prefilter, top PREFILTER_LIMIT (default 50)
     Stage B  LLM rubric judge → {score 0–5, justification, matched_concern}
              → LOG every judgment to relevance_judgments (model/prompt_version/rubric_version)
     score ≥ MEMO_THRESHOLD (default 4)
       → memo: ensure full_text → chunk + retrieve → structured memo
       → VERIFY each citation is a whitespace-normalized substring of source
       → save memo status='draft'                 // approval gate
  → review queue → human approves → digest email (approved only)
  → UI: profile switch re-runs scoring read-side and re-colors the board
```

Mirror diagram in spec §3 (ASCII + mermaid). The funnel order is load-bearing: each stage is cheaper than the next, so the expensive LLM judge only ever sees category-relevant, embedding-near candidates.

## The local-fallback story (this is the whole self-host pitch)

The only non-OSS pieces are the **LLM** and the **embedder**, and both sit behind interfaces (`LLM`, `Embedder` in `src/lib/interfaces.ts`) so the proprietary path is optional. `src/lib/env.ts` makes the fully-offline path the **default**, so `npm run typecheck && test && eval` are green with **zero secrets**:

- **`LLM_PROVIDER` (default `local`)** — a deterministic, rubric-aligned judge that needs no key and is hermetic. `anthropic` swaps in Claude (`ANTHROPIC_MODEL` default `claude-opus-4-8`) for best quality; `ollama` points at a local Llama via `OLLAMA_BASE_URL`.
- **`EMBEDDER` (default `hash`)** — a deterministic in-process embedder, no deps, hermetic. `local` is transformers.js `bge-small-en` (optional dep, downloaded once), `ollama` is `nomic-embed-text`, `api` is any OpenAI-compatible endpoint.
- **`EMBED_DIM` (default 384)** MUST match the embedder: hash / bge-small = 384, nomic = 768, openai-3-small = 1536. The DB vector column dimension is derived from this — a mismatch is a setup error, not a runtime guess.

**Implementation rule for optional model paths:** transformers.js / ollama HTTP must be loaded via guarded `dynamic import()` so their absence never breaks typecheck or the hermetic path. The hash + local-judge defaults guarantee CI runs without a network or a key.

## Deploy

- **Self-host (the reference):** one Postgres (with the `vector` extension), one Next.js process. pg-boss runs the schedule inside the same Postgres — no Redis, no separate worker tier required. `docker-compose.yml` brings up Postgres on `localhost:5433` (`npm run db:up`); `DATABASE_URL` defaults to that. Set `LLM_PROVIDER=ollama` + `EMBEDDER=ollama` for a 100%-offline deploy, or keep `anthropic` for triage/memo quality.
- **Managed:** any Postgres-with-pgvector provider + any Node host. Email is Nodemailer over `SMTP_URL` (empty = log-only Mailer, so dev never sends real mail).
- **Secrets:** `.env` only; `.env.example` is committed with keys and no values. See [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#security).

## Multi-tenancy

`org_id` is on every business-scoped table from line one (spec §6). Scoring, memos, judgments, tracking, and audit are all per-org. The profile switcher is a read-side re-scope; it never mutates another org's data.

## Boundaries between agents (don't cross)

`package.json`, `tsconfig.json`, and the three contract files (`src/lib/types.ts`, `src/lib/interfaces.ts`, `src/lib/env.ts`) are orchestrator-owned. Modules import from them and never redefine them. Sources own `src/sources/`, pipeline owns `src/pipeline/`, app owns `src/app/`, evals own `evals/`. The schema (§6) + interfaces (§7) are the only coupling.
