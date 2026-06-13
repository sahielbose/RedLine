<div align="center">

# RedLine

### Regulatory monitoring for small business

Ingest every bill and rule moving through U.S. government, score what threatens your business, and produce a cited, plain-English brief. The work a high-priced policy consultant does, made available to businesses that could never afford one.

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-c9a227?style=for-the-badge)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-2F6BFF?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Postgres + pgvector](https://img.shields.io/badge/Postgres-pgvector-15203B?style=for-the-badge&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)

[![tests](https://img.shields.io/badge/tests-197_passing-13705f?style=for-the-badge)](#verification)
[![eval P/R/F1](https://img.shields.io/badge/eval_P%2FR%2FF1-1.000-C2183A?style=for-the-badge)](#verification)
[![runs with zero API keys](https://img.shields.io/badge/runs_with-zero_API_keys-2F6BFF?style=for-the-badge)](#quickstart)
[![self-hostable](https://img.shields.io/badge/self--hostable-yes-3C4660?style=for-the-badge)](#going-live)

<br/>

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Verification](#verification) · [Going live](#going-live) · [Documentation](#documentation)

</div>

---

Large companies pay five-figure monthly retainers to lobbyists so that a routine bill's last-minute amendment does not blindside them. Most businesses get blindsided. RedLine brings that level of monitoring within reach of any small business. The model is roughly five percent of the work. Coverage, precision, and trust are the product.

## What it does

- **Monitors continuously.** Bills and rules across Congress, the Federal Register, and state legislatures (California first, expanding), drawn entirely from public data.
- **Scores each item for your specific business.** Onboarding builds a profile of what you do, where you operate, and your attributes. A two-stage filter (a low-cost embedding prefilter followed by an LLM rubric judge) surfaces only what is relevant. The same rule can score Critical for an importer and be filtered out for a SaaS company.
- **Explains it with evidence.** Each surfaced item gets a structured brief: a plain-English summary, why it matters, status and next steps, affected sections, historical precedent, and a recommended action. Every citation is verified in code against the source text rather than trusted from the model.
- **Personalizes to you.** Describe your company in your own words and that context steers the scoring directly. Add, edit, and remove business profiles at any time. Switching the active profile re-scores the entire board.
- **Runs on your own Anthropic key.** A Settings page lets you paste a key, choose a model, and test the connection live. When Claude is unavailable for any reason, the system falls back to the local engine automatically and says so.
- **Delivers on time.** A daily or weekly email digest of approved items, comment-deadline alerts, relevance feedback, and a one-click draft of a public comment letter that you review and submit yourself.

**Horizontal by design.** A base layer that every business shares (wages, leave, classification, licensing, taxes, privacy, safety, accessibility), plus modules you toggle on: software, goods, food, and hardware.

## Quickstart

RedLine ships a local fallback for every external service (a deterministic rubric judge and an in-process embedder), so the dashboard, the test suite, and the relevance eval all run green on a fresh clone with no keys, no database, and no Docker.

Prerequisites: [Node 20 or newer](https://nodejs.org) and npm.

```bash
git clone https://github.com/sahielbose/RedLine.git && cd RedLine
npm install

npm run dev     # dashboard at http://localhost:2000 (seeded demo, scored live)
npm run eval    # prove the relevance engine: precision, recall, F1
npm run test    # 197 hermetic tests
```

What you will see:

- `npm run dev` serves the full dashboard on seeded data. Change the active profile under "Viewing as" and the map and threat list re-score in real time. Click any item for its cited, code-verified brief.
- `npm run eval` prints a per-business by per-rule score matrix, then a line reading "EVAL GREEN, precision/recall/F1 = 1.000".
- `npm run test` runs the unit and integration suite. Database-backed tests skip automatically until you opt in (see [Going live](#going-live)).

No `.env` file is required to start. The defaults `LLM_PROVIDER=local` and `EMBEDDER=hash` run fully offline.

## Bring your own Anthropic key

Open the Settings tab in the app to paste an Anthropic API key, pick a model (Opus, Sonnet, or Haiku), and run a live connection test. The key is stored on the server and never returned to the browser. With a funded key, the judge, the briefs, the agentic search, and the comment-letter drafter all run on Claude. Without one, everything continues to work on the local engine. You can also set `ANTHROPIC_API_KEY` and `LLM_PROVIDER=anthropic` in `.env` if you prefer to configure it there.

## Going live

When you are ready to ingest real bills and rules and use Claude for analysis quality, add keys and a database. Every key is free, and the Federal Register requires none.

**1. Secrets.** Copy the template and fill in what you have:

```bash
cp .env.example .env
```

| Variable | Purpose | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude for the judge, briefs, and drafts (set `LLM_PROVIDER=anthropic`, or use the Settings tab) | [console.anthropic.com](https://console.anthropic.com) |
| `CONGRESS_API_KEY` | Federal bills | [api.data.gov](https://api.data.gov), free |
| `OPENSTATES_API_KEY` | State bills | [open.pluralpolicy.com](https://open.pluralpolicy.com), free |
| `REGULATIONS_API_KEY` | Comment deadlines | [api.data.gov](https://api.data.gov), free |
| `SMTP_URL` | Email digest delivery | any SMTP server (otherwise logs to the console) |

The Federal Register needs no key. Embeddings can stay on `hash`, or you can set `EMBEDDER=ollama` or `EMBEDDER=api` (keep `EMBED_DIM` in sync).

**2. Database.** Postgres with pgvector via Docker, self-contained on port 5433:

```bash
colima start         # or start Docker Desktop
npm run db:up        # runs pgvector/pgvector:pg16 on port 5433 and waits until ready
npm run db:migrate   # create the schema
npm run db:seed      # four example businesses plus eval fixtures
```

**3. Verify the live paths:**

```bash
RUN_DB_TESTS=1 npm run test   # also runs the database-backed integration suite
```

**4. Schedule ingestion and delivery.** Wire pg-boss to a runner (the remaining piece for production cron):

```ts
import PgBoss from "pg-boss";
import { registerJobs } from "@/jobs/schedules";

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await registerJobs(boss); // hourly federal, daily states, daily score, daily and weekly digest
```

**Approval gate.** Memos are always created as drafts. The digest sends only what a human has approved in the Alerts tab. There is no auto-send, by design.

## How it works

```
  Congress.gov  ┐
  Fed Register  ┤  poll "changed since cursor", normalize, upsert, status-diff
  Open States   ┘                    │
                                     v
                  Postgres + pgvector  (items, profiles, judgments, memos, audit)
                                     │  classify categories at ingest (Stage 0)
                                     v
        ┌──────── relevance pipeline, per business ─────────┐
        │  Stage 0   category intersection                  │
        │  Stage A   pgvector embedding prefilter            │
        │  Stage B   LLM rubric judge, score 0 to 5, logged  │
        └──────────────────┬────────────────────────────────┘
                           │  score at or above threshold
                           v
            Memo with code-verified citations, status = draft
                           │  human approves (approval gate)
                           v
            Daily or weekly digest, Overview map, Bills, Alerts, Tracker
```

The trust layer is the product, built from the first commit. An eval harness gates every prompt change. Citations are verified in code (a snippet must be a substring of the source, or it is dropped). An append-only audit log records every state change. A strict no-fabrication rule forbids invented dollar figures, probabilities, and vote predictions, and is enforced in the prompts and in code.

## Verification

You cannot credibly claim that no bill was ever missed, so the eval set is the evidence. Golden cases label real rules per business profile, because the same rule is signal for one business and noise for another. The runner reports precision, recall, and F1, prints every false negative prominently, and fails CI below threshold.

```text
$ npm run eval
  TP=16  FP=0  FN=0  TN=60
  precision  1.000   (threshold 0.850)  PASS
  recall     1.000   (threshold 1.000)  PASS
  f1         1.000   (threshold 0.900)  PASS
  headline holds, no false negatives, Stage-0 tagging audit clean
```

Change the triage prompt and you see immediately whether recall regressed, instead of discovering it when a customer's rule slips through.

## Stack

| Concern | Choice |
|---|---|
| App, API, dashboard | Next.js 15 (App Router), React 19 |
| Language | TypeScript, strict. One language, one deploy |
| Database | Postgres with pgvector, Drizzle ORM and migrations |
| Jobs and cron | pg-boss, Postgres-backed, no extra infrastructure |
| LLM | Claude behind a swappable `LLM` interface, with a local heuristic fallback |
| Embeddings | `Embedder` interface: hash (default), bge-small, Ollama, or API |
| Email | Nodemailer and SMTP behind a `Mailer` interface |
| Map | d3-geo with us-atlas TopoJSON choropleth |
| Validation | Zod, which also constrains the LLM JSON output |

The only non-open-source pieces, the LLM and the embeddings, sit behind interfaces with local fallbacks, so a fully self-hosted, keyless deployment is real rather than a footnote.

## Repo layout

```
docs/          master spec plus per-area documents
db/            Drizzle schema, migrations, seed
evals/         golden cases, fixtures, runner, thresholds
src/lib/       interfaces and LLM, Embedder, Mailer, and database adapters
src/sources/   one SourceClient per data source
src/pipeline/  classify, prefilter, judge, memo, digest
src/jobs/      pg-boss schedules and handlers
src/app/       Next.js dashboard (Overview, Activity, Search, Bills, Alerts, Tracker, Settings)
```

## Documentation

The [master spec](docs/REDLINE_MASTER_SPEC.md) is the source of truth. Per-area expansions:
[Architecture](docs/ARCHITECTURE.md), [Data model](docs/DATA_MODEL.md), [Data sources](docs/DATA_SOURCES.md), [Pipeline](docs/PIPELINE.md), [Prompts](docs/PROMPTS.md), [Taxonomy](docs/TAXONOMY.md), [Onboarding](docs/ONBOARDING.md), [Evals](docs/EVALS.md), [Design](docs/DESIGN.md), [Trust and guardrails](docs/TRUST_AND_GUARDRAILS.md), [Roadmap](docs/ROADMAP.md).

## Contributing

Issues and pull requests are welcome. House rules: code to the spec's data model and interfaces; `npm run typecheck && npm run test && npm run eval` must pass; use Conventional Commits; never commit secrets; and ship no fabricated figures or PII. See [TRUST_AND_GUARDRAILS.md](docs/TRUST_AND_GUARDRAILS.md).

---

<div align="center">

Team: Sahiel Bose, Shanay Gaitonde

MIT licensed. Self-hostable.

Built so that no small business gets blindsided by a rule it never saw coming.

</div>
