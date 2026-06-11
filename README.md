<div align="center">

# RedLine

### Regulatory watch for small business

**Ingest every bill and rule moving through U.S. government → score what threatens _your_ business → get a cited, plain-English brief.**
The work a $500/hr policy consultant does, for businesses that could never afford one.

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-c9a227?style=for-the-badge)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-2F6BFF?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Postgres + pgvector](https://img.shields.io/badge/Postgres-pgvector-15203B?style=for-the-badge&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)

[![tests](https://img.shields.io/badge/tests-185_passing-13705f?style=for-the-badge)](#-how-we-prove-it)
[![eval P/R/F1](https://img.shields.io/badge/eval_P%2FR%2FF1-1.000-C2183A?style=for-the-badge)](#-how-we-prove-it)
[![runs with zero API keys](https://img.shields.io/badge/runs_with-zero_API_keys-2F6BFF?style=for-the-badge)](#-quickstart--zero-api-keys)
[![self-hostable](https://img.shields.io/badge/self--hostable-✓-3C4660?style=for-the-badge)](#-go-live-add-keys--data)

<br/>

**[Quickstart](#-quickstart--zero-api-keys)** · **[How it works](#-how-it-works)** · **[Prove it](#-how-we-prove-it)** · **[Go live](#-go-live-add-keys--data)** · **[Docs](#-documentation)**

</div>

---

> Big companies pay **$30K/month lobbyists** so a routine bill's last-minute amendment doesn't blindside them. Everyone else gets blindsided. RedLine puts that watch within reach of any small business — and the model is only ~5% of it. **Coverage, precision, and trust are the product.**

## What it does

- ** Monitors everything** — bills + rules across **Congress, the Federal Register, and state legislatures** (California first, expanding), continuously, from public data.
- ** Scores it for _your_ business** — onboarding builds a profile (what you do, where, your attributes); a two-stage filter (cheap embedding prefilter → LLM rubric judge) flags only what's relevant. **The same rule is `5 Critical` for an importer and filtered out for a SaaS company.**
- **Explains it, with receipts** — a short memo (what it does / status & next steps / who's affected / recommended action) where **every claim is a citation verified by code** against the source text — not trusted from the model.
- ** Tells you on time** — daily/weekly email digest (approved items only), comment-deadline alerts, and a tracker board by legislative stage.

**Horizontal by design.** A base layer every business shares — `wages` · `leave` · `classification` · `licensing` · `taxes` · `privacy` · `safety` · `accessibility` — plus toggle-on modules: `software` · `goods` · `food` · `hardware`.

## ⚡ Quickstart — zero API keys

RedLine ships a **local fallback for every external service** (a deterministic rubric judge + an in-process embedder), so the dashboard, the test suite, and the relevance eval all run **green on a fresh clone — no keys, no database, no Docker.**

**Prerequisites:** [Node 20+](https://nodejs.org) and npm.

```bash
git clone https://github.com/sahielbose/RedLine.git && cd RedLine
npm install

npm run dev        # ▶ dashboard at http://localhost:3000  (seeded demo, scored live)
npm run eval       # ▶ prove the relevance engine — precision / recall / F1
npm run test       # ▶ 185 hermetic tests
```

**What you'll see**

- **`npm run dev`** → the full dashboard on seeded data. Switch _"Viewing as"_ and watch the map + threats re-score in real time. Click any bill for its cited, code-verified memo.
- **`npm run eval`** → a per-business × per-rule score matrix, then `EVAL GREEN — precision/recall/F1 = 1.000`.
- **`npm run test`** → the unit + integration suite (DB-backed tests auto-skip until you opt in below).

> No `.env` needed yet. `LLM_PROVIDER=local` and `EMBEDDER=hash` are the defaults — fully offline.

---

## 🔌 Go live (add keys + data)

When you're ready to ingest real bills/rules and use Claude for memo quality, drop in keys and a database. **All keys are free** (Federal Register needs none).

**1. Secrets** — copy the template and fill in what you have:

```bash
cp .env.example .env
```

| Variable | What it's for | Get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude for the judge + memos (set `LLM_PROVIDER=anthropic`) | [console.anthropic.com](https://console.anthropic.com) |
| `CONGRESS_API_KEY` | Federal bills | [api.data.gov](https://api.data.gov) · free |
| `OPENSTATES_API_KEY` | State bills | [pluralpolicy.com](https://open.pluralpolicy.com) · free |
| `REGULATIONS_API_KEY` | Comment deadlines | [api.data.gov](https://api.data.gov) · free |
| `SMTP_URL` | Email digest delivery | any SMTP (else logs to console) |

_Federal Register needs no key. Embeddings can stay `hash`, or set `EMBEDDER=ollama`/`api` (match `EMBED_DIM`)._

**2. Database** — Postgres + pgvector via Docker (self-contained, on port `5433`):

```bash
colima start                 # or start Docker Desktop
npm run db:up                # docker run pgvector/pgvector:pg16 on :5433, waits until ready
npm run db:migrate           # create the schema
npm run db:seed              # 4 example businesses + eval fixtures
```

**3. Verify the live paths**

```bash
RUN_DB_TESTS=1 npm run test  # runs the DB-backed integration suite too
```

**4. Schedule ingestion + delivery** — wire pg-boss to a runner (the one piece left for production cron):

```ts
import PgBoss from "pg-boss";
import { registerJobs } from "@/jobs/schedules";

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await registerJobs(boss);     // hourly federal · daily states · daily score · daily/weekly digest
```

> **Approval gate:** memos are always drafted as `draft`. The digest sends **only** what a human has approved in the Alerts tab — there is no auto-send, by design.

---

## How it works

```
  Congress.gov ─┐
  Fed Register ─┤  poll "changed since cursor" → normalize → upsert + status-diff
  Open States ─┘                     │
                                     ▼
                    Postgres + pgvector  (items · profiles · judgments · memos · audit)
                                     │  classify categories at ingest (Stage 0)
                                     ▼
        ┌──────── relevance pipeline (per business) ────────┐
        │  Stage 0  category intersection                   │
        │  Stage A  pgvector embedding prefilter             │
        │  Stage B  LLM rubric judge → score 0–5  (logged)   │
        └──────────────────┬─────────────────────────────────┘
                           │  score ≥ threshold
                           ▼
            Memo + CODE-verified citations → status = draft
                           │  human approves (approval gate)
                           ▼
            Daily/weekly digest  ·  Overview map  ·  Bills  ·  Alerts  ·  Tracker
```

**The trust layer is the product** — built from commit #1: an eval harness that gates every prompt change, code-verified citations (a snippet must be a substring of the source or it's dropped), an append-only audit log on every state change, and a hard no-fabrication rule (no invented dollar figures, probabilities, or vote predictions — enforced in prompts _and_ in code).

## How we prove it

You can't claim "no missed bills" — so the **eval set is the evidence.** Golden cases label real rules per business profile (the same rule is signal for one, noise for another), and the runner reports **precision / recall / F1**, prints every false-negative loudly, and **fails CI below threshold.**

```text
$ npm run eval
  TP=16  FP=0  FN=0  TN=60
  precision  1.000   (threshold 0.850)  PASS
  recall     1.000   (threshold 1.000)  PASS   ← recall is sacred
  f1         1.000   (threshold 0.900)  PASS
  ✓ headline holds   ✓ no false negatives   ✓ Stage-0 tagging audit clean
```

Change the triage prompt and you _immediately_ see if recall broke — instead of finding out when a customer's rule slips through.

## Stack

| Concern | Choice |
|---|---|
| App · API · dashboard | **Next.js 15** (App Router) · React 19 |
| Language | **TypeScript** (strict) — one language, one deploy |
| Database | **Postgres + pgvector** · **Drizzle** ORM/migrations |
| Jobs + cron | **pg-boss** (Postgres-backed; zero extra infra) |
| LLM | **Claude** behind a swappable `LLM` interface · local heuristic fallback |
| Embeddings | `Embedder` interface — `hash` (default) · `bge-small` · Ollama · API |
| Email | **Nodemailer / SMTP** behind a `Mailer` interface |
| Map | **d3-geo** + us-atlas TopoJSON choropleth |
| Validation | **Zod** (also constrains LLM JSON output) |

_The only non-OSS pieces (LLM + embeddings) sit behind interfaces with local fallbacks — so a 100% self-hosted, keyless deploy is real, not a footnote._

## Repo layout

```
docs/    master spec + 12 per-area docs        evals/   golden cases · fixtures · runner · thresholds
db/      Drizzle schema · migrations · seed     src/lib/     interfaces + LLM/Embedder/Mailer/db adapters
src/sources/   one SourceClient per data source src/pipeline/ classify · prefilter · judge · memo · digest
src/jobs/      pg-boss schedules + handlers      src/app/      Next.js dashboard (Overview · Bills · Alerts · Tracker)
```

## Documentation

The [**master spec**](docs/REDLINE_MASTER_SPEC.md) is the source of truth. Per-area expansions:
[Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Data sources](docs/DATA_SOURCES.md) · [Pipeline](docs/PIPELINE.md) · [Prompts](docs/PROMPTS.md) · [Taxonomy](docs/TAXONOMY.md) · [Onboarding](docs/ONBOARDING.md) · [Evals](docs/EVALS.md) · [Design](docs/DESIGN.md) · [Trust & guardrails](docs/TRUST_AND_GUARDRAILS.md) · [Roadmap](docs/ROADMAP.md)


## Contributing

Issues and PRs welcome. House rules: code to the spec's data model (§6) + interfaces (§7); `npm run typecheck && npm run test && npm run eval` must pass; Conventional Commits; no secrets in commits; no fabricated figures or PII. See [TRUST_AND_GUARDRAILS.md](docs/TRUST_AND_GUARDRAILS.md).

---

<div align="center">

**Team** Sahiel Bose, Shanay Gaitonde
[MIT](LICENSE) licensed · self-hostable

<em>Built so no small business gets blindsided by a rule it never saw coming.</em>

</div>
