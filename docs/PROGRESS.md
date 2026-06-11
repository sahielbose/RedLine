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

## Phase 1 — Ingestion (parallel)  · _code complete; live run pending Docker/keys_

- [x] Ingest contract: `hash.ts` (content-hash dedup), `itemStore.ts` (ItemStore + MemoryItemStore), `ingest.ts` (upsert→diff→status_history→classify→embed→cursor), `http.ts` (rate-limit/backoff), `agency` field added to NormalizedItem
- [x] **Congress.gov v3** SourceClient — `fromDateTime` watermark, ascending sort, ≤250/page, fetchFullText
- [x] **Federal Register v1** SourceClient — comment_close_date, stage (comment_open/finalized/in_effect), agency→Stage-0 wiring
- [x] **Open States v3** SourceClient (CA first) — identifier normalization, updated_at watermark, state-register gap documented
- [x] **DrizzleItemStore** — ON CONFLICT upsert, `xmax` isNew, pgvector embedding, sync_state cursor (gated integration test)
- [x] source registry (`src/sources/index.ts`); verify→fix loop: agency→classify wiring (recall), ascending-sort cursors (no-skip on truncation)
- [x] **Green:** typecheck · 128 tests (+6 gated DB) · eval P/R/F1 = 1.000. Ingest idempotency/diff/cursor proven hermetically via MemoryItemStore.

_Live run deferred:_ "real rows land, a known recent rule appears" needs live API keys + a running DB
(Docker/colima). The loop + upsert/diff/cursor semantics are proven against MemoryItemStore; the
DrizzleItemStore integration test runs with `RUN_DB_TESTS=1` after `db:up && db:migrate`.

## Phase 2 — Pipeline + evals  · _complete (hermetic); live DB gated_

- [x] **Onboarding → profile** (`onboarding.ts`): answers → business_types + subscribed_categories + concern_text (positives AND negatives) + embedding
- [x] **Stage A prefilter** (`prefilter.ts`): `Prefilter` interface + `MemoryPrefilter` (cosine) + production `DrizzlePrefilter` (pgvector SQL, injection-safe)
- [x] **Scoring orchestrator** (`score.ts`): Stage 0→A→B + memo drafting; logs every judgment; true Stage-0 `filteredOut` count
- [x] **Memo generator** (`memo.ts`): draft-only; citations verified by CODE (dropped if unverifiable); strict no-fabrication guard (figure ⇒ requires stated assumptions)
- [x] **Trust layer**: `persist.ts` (judgment log + draft memo), `review.ts` (approval-gate state machine, **atomic** state-change+audit via transactions), `audit.ts` (before/after)
- [x] verify→fix loop: tightened `sanitizeImpactEstimate` (closed the label-word bypass), made audit writes transactional, fixed `filteredOut` overcount, documented prefilter edge cases
- [x] **Green:** typecheck · 147 tests (+16 gated DB) · eval P/R/F1 = 1.000. **Headline holds through the FULL pipeline** (prefilter+judge+memo), not just the judge.

_Live DB gated:_ persistence/review/prefilter integration tests run with `RUN_DB_TESTS=1` after `db:up && db:migrate`. The approval gate, citation verify, and no-fabrication guard are all enforced in CODE and unit-tested hermetically.

## Phase 3 — UI  · _complete; usable end-to-end on seeded data_

- [x] Data layer: `demo-data.ts` (federal anchors + state bills across CA/TX/WA/NY/IL/CO/GA), `board.ts` (runs the real engine per profile, derives per-state shading + floating cards), `geo.ts`, shared `ui.tsx` primitives
- [x] **AppShell** (window chrome + tabs + last-sync + honest "seeded demo" note) + **ProfileSwitcher** (accessible listbox — the signature control)
- [x] **Overview**: SURFACED THREATS rail + **US choropleth** (d3-geo + us-atlas) + auto-cycling **floating cards** (THREAT/STATUS/IMPACT/ACTION, pausable, reduced-motion aware)
- [x] **Bills** feed + SeverityStamps + **MemoPanel** slide-over (code-verified citations, "Draft — pending approval", "never an unlabeled figure")
- [x] **Alerts** review queue (approval gate, Approve/Reject, no-auto-send copy) + digest settings; **Tracker** kanban by stage
- [x] **Browser-verified**: zero console errors; the "Viewing as" switch re-scores + recolors live (SaaS→CA only; Harbor Goods→TX/CA/NY; de minimis 5 Critical for goods, filtered for SaaS); ESC closes the dialog
- [x] verify→fix: collapsed duplicate FloatingCards mount, declared transitive @types, doc-accuracy on the map transition
- [x] **Green:** typecheck · 151 tests · eval P/R/F1 = 1.000

_Notes:_ Auth.js left as a stub (demo runs without login, per spec "stub day 1"). Inter loads via the CSS
stack with a system fallback (not wired through next/font, to keep the build network-free).

## Phase 4 — Delivery + hardening  · _not started_
pg-boss schedules; SMTP digest of approved items; comment-deadline alerts; grow eval set; expand CA.
Checkpoint: digest sends; eval thresholds hold.
