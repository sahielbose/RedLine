<div align="center">

# 🟥 RedLine

### Regulatory watch for small business

Ingest every bill and rule moving through U.S. government, score what threatens **your** business, and get a cited, plain-English brief — in seconds.

[Spec](docs/REDLINE_MASTER_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Design](docs/DESIGN.md) · [Evals](docs/EVALS.md)

`MIT licensed` · `self-hostable` · `Next.js + Postgres/pgvector`

</div>

---

## What it does

Big companies pay $30K/month lobbyists so a routine bill's last-minute amendment doesn't blindside them. Everyone else gets blindsided. RedLine puts that watch within reach of any small business.

- **Monitors everything** — bills + rules across all 50 states + Congress, continuously, from public data.
- **Scores it for *your* business** — onboarding builds a profile (what you do, where, your attributes); a two-stage filter (cheap embedding prefilter → LLM rubric judge) flags only what's relevant. The same rule is Critical for an importer and filtered out for a SaaS company.
- **Explains it, with receipts** — a short memo (what it does / status & next steps / who's affected / recommended action) where every claim is a **verified** citation into the source text.
- **Tells you on time** — daily/weekly email digest, comment-deadline alerts, and a tracker board by legislative stage.

**Horizontal by design.** A base layer every business shares (wages, leave, classification, licensing, taxes, privacy, safety, accessibility) plus toggle-on modules: `software`, `goods`, `food`, `hardware`.

**What it deliberately doesn't do:** no fabricated dollar figures, no invented vote predictions, no directory of people's personal phone numbers, no auto-sending. Trust over theater. (See the spec.)

## Stack

Next.js 15 (App Router) · Postgres + pgvector · Drizzle · pg-boss (jobs+cron) · Claude via API (behind a swappable `LLM` interface) · embeddings via interface (API or local Ollama) · Nodemailer/SMTP · Auth.js · Zod · react-simple-maps. One language (TypeScript), one deploy, fully self-hostable.

## Quickstart

```bash
git clone https://github.com/sahielbose/RedLine.git && cd RedLine
cp .env.example .env          # fill in keys (see below)
npm install
npm run db:migrate
npm run db:seed               # example businesses + eval fixtures
npm run eval                  # sanity-check the relevance engine
npm run dev                   # http://localhost:3000
```

### Environment (`.env.example`)
```
DATABASE_URL=postgres://...
CONGRESS_API_KEY=            # api.data.gov (free)
REGULATIONS_API_KEY=         # api.data.gov (free)
OPENSTATES_API_KEY=          # open.pluralpolicy.com (free)
# Federal Register needs no key
LLM_PROVIDER=anthropic       # or 'ollama'
ANTHROPIC_API_KEY=
EMBEDDER=api                 # or 'ollama' (set EMBED_DIM to match: api=1536, nomic=768, bge=384)
SMTP_URL=                    # any SMTP; or configure the Resend adapter
AUTH_SECRET=
```

## Documentation

The [master spec](docs/REDLINE_MASTER_SPEC.md) is the source of truth. Expansions live in `docs/`: [Architecture](docs/ARCHITECTURE.md), [Data model](docs/DATA_MODEL.md), [Data sources](docs/DATA_SOURCES.md), [Pipeline](docs/PIPELINE.md), [Prompts](docs/PROMPTS.md), [Taxonomy](docs/TAXONOMY.md), [Onboarding](docs/ONBOARDING.md), [Evals](docs/EVALS.md), [Design](docs/DESIGN.md), [Trust & guardrails](docs/TRUST_AND_GUARDRAILS.md), [Roadmap](docs/ROADMAP.md).

## Repo layout

```
docs/   spec + per-area docs        evals/  golden cases, fixtures, runner
db/     Drizzle schema + migrations src/    lib · sources · pipeline · jobs · app
```

## Contributing

Issues and PRs welcome. Rules: code to the spec's data model + interfaces; `npm run typecheck && npm run test && npm run eval` must pass; Conventional Commits; no secrets in commits; no fabricated figures or PII. See [TRUST_AND_GUARDRAILS.md](docs/TRUST_AND_GUARDRAILS.md).

## License

[MIT](LICENSE).

---

<div align="center"><em>Built so no small business gets blindsided by a rule it never saw coming.</em></div>
