# RedLine — build progress (shared subagent state)

Living task board. The orchestrator and every subagent read/update this. Source of
truth for *what's done*; the spec (`docs/REDLINE_MASTER_SPEC.md`) is truth for *what to build*.

**Green gate (must pass before every commit):** `npm run typecheck && npm run test && npm run eval`

---

## Phase 0 — Scaffold & docs  · _in progress_

Integration contract (landed first, by orchestrator):
- [x] Repo cloned; spec + CLAUDE.md + README placed
- [x] `package.json`, `tsconfig.json`, `next.config.mjs`, ESLint, Vitest, Drizzle config
- [x] `.env.example` (every key, no values), `.gitignore`, MIT `LICENSE`
- [x] `docker-compose.yml` (pgvector/pgvector:pg16 on :5433)
- [x] `src/lib/interfaces.ts` (§7) + `src/lib/types.ts` (§6/§9/§10 contract) + `src/lib/env.ts`
- [x] Minimal Next app boots (`src/app/`), design tokens in `globals.css` (§12)

Fan-out (parallel subagents — all landed, adversarially verified):
- [x] **adapters** — `Embedder` (hash/local/ollama/api), `Mailer` (log/smtp) + tests
- [x] **db** — `db/schema.ts` (all 11 §6 tables + hnsw/gin/btree indexes), `db/migrate.ts`, `db/seed.ts`, `src/lib/db.ts`, migration `0000_*` generated
- [x] **relevance core** — `taxonomy.ts`, `classify.ts` (Stage 0 §9), `relevance.ts` (general heuristic judge), `judge.ts`, `llm.ts` + heuristic/anthropic/ollama adapters, `citations.ts` (code-verified)
- [x] **evals** — `run.ts`, `thresholds.json` (precision .85 / recall 1.0 / f1 .9), 4 profiles, 11 fixtures (anchors A–D + decoys I/J/K + expansion E–H), per-profile cases, **Stage-0 tagging audit**
- [x] **docs** — the 11 expansion `docs/*.md` files (§13)
- [x] **CI** — `.github/workflows/ci.yml` (typecheck + test + eval, zero secrets)
- [x] verify→fix loop: tightened customs-import + FSMA gates, made the eval's `band` field a real check, added the Stage-0 recall audit
- [x] bumped security deps (drizzle-orm 0.45.2, nodemailer 8, drizzle-kit 0.31, vitest 4) — high/critical advisories cleared

**Checkpoint — MET:** app boots (verified) · `npm run typecheck && test && eval` green (71 tests; eval P/R/F1 = 1.000) · CI defined · docs written.
**Headline acceptance (eval-level) — PASSES:** import de minimis (item C) scores Critical for
`ecom-goods`/`hardware-maker`, filtered out for `saas-remote`/`food-cpg`.

_Deferred to Phase 1 (needs Docker running):_ live `db:migrate` + `db:seed` smoke test against
pgvector — Docker daemon (colima) isn't started yet; schema is validated by `drizzle-kit generate`
+ 21 hermetic schema tests.

---

## Phase 1 — Ingestion (parallel)  · _not started_
Federal (Congress.gov, Federal Register) + 1–3 states (CA first); cursor + backoff; normalize →
upsert → status_history; classify; embed. Checkpoint: real rows, no dupes on re-run, cursor advances.

## Phase 2 — Pipeline + evals  · _not started_
Onboarding → profile; Stage 0/A/B wired to DB; log judgments; memo + citation verify + approval gate
+ audit. Checkpoint: `npm run eval` green; profile switch re-scores correctly.

## Phase 3 — UI  · _not started_
AppShell + ProfileSwitcher + Bills feed + MemoPanel + Overview map + floating cards + Tracker +
ReviewQueue + Auth.js stub. Checkpoint: usable end-to-end on seeded data.

## Phase 4 — Delivery + hardening  · _not started_
pg-boss schedules; SMTP digest of approved items; comment-deadline alerts; grow eval set; expand CA.
Checkpoint: digest sends; eval thresholds hold.
