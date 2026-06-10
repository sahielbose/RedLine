# CLAUDE.md — RedLine operating manual

You are working in the **RedLine** repo (`github.com/sahielbose/RedLine`): an open-source AI regulatory watchdog for small businesses. **Read `docs/REDLINE_MASTER_SPEC.md` first — it is the source of truth.** This file is how you operate day-to-day.

## What we're building (10-second version)
Ingest public legislative + regulatory data (Congress, Federal Register, all 50 states) → score each item against a specific business via a two-stage filter → write a cited, plain-English memo → deliver a digest + an interactive dashboard. The model is ~5%; coverage + precision + trust is the product.

## Golden rules (do not violate)
1. **Spec first.** Code to the data model (spec §6) and interfaces (§7). They're the shared contract — don't drift.
2. **Eval-gated.** `npm run eval` after every prompt/rubric/classifier change. A drop in recall is a regression — fix before committing.
3. **Main is always green.** Before every commit: `npm run typecheck && npm run test && npm run eval` must pass. Never leave `main` broken.
4. **Commit small and often, push to main frequently.** One logical change per commit, Conventional Commits style (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). After each green checkpoint, commit and push. Prefer many small green commits over one big risky one.
5. **Use subagents aggressively.** Parallelize independent work (ingestion sources, pipeline, evals, frontend, docs) across specialized subagents. Each subagent reads the spec + this file. Integrate on the schema/interfaces.
6. **Secrets in `.env` only.** Commit `.env.example` (keys, no values). Never print, log, or commit a real key. Never enter credentials into any external form or site.
7. **No fabrication.** Never emit invented dollar impacts, probabilities, or vote predictions — in prompts and in code. `impact_estimate` is a labeled estimate with assumptions, or empty.
8. **No PII directories.** Never build or seed a directory of named individuals' personal contact info. "Recommended action" links to official public portals only.
9. **Citations verified by code,** not trusted from the model: a citation's snippet must be a whitespace-normalized substring of the source text, or it's dropped/flagged.
10. **Approval gate.** Memos and any outbound start as `draft`; nothing sends without human approval. Ask the human before any destructive/irreversible action (force-push, history rewrite, mass delete, publishing, payments, changing repo settings).
11. **OSS deps only** (MIT/Apache). LLM + embeddings behind interfaces with a documented local (Ollama) fallback. Flag any closed dependency before adding it.
12. **Clone the idea, not anyone's brand.** Our own name and copy. Paraphrase sources; never reproduce another product's copy/screenshots/branding.

## Commands
```bash
npm run dev         # Next.js app
npm run typecheck   # tsc --noEmit
npm run test        # unit/integration tests
npm run eval        # run /evals against the matrix → precision/recall/F1, fails below thresholds
npm run db:migrate  # apply Drizzle migrations
npm run db:seed     # seed example orgs/profiles + eval fixtures
npm run lint
```

## Repo map (see spec §13 for the full tree)
- `docs/` — the spec and its per-section expansions. Keep docs in sync when behavior changes.
- `db/` — Drizzle schema + migrations + seed.
- `src/lib/` — interfaces + LLM/Embedder/Mailer/db adapters.
- `src/sources/` — one `SourceClient` per data source.
- `src/pipeline/` — `classify` (Stage 0) · `prefilter` (Stage A) · `judge` (Stage B) · `memo` · `digest`.
- `src/jobs/` — pg-boss schedules + handlers.
- `src/app/` — Next.js App Router (dashboard, api, components).
- `evals/` — golden `cases/`, `fixtures/`, `profiles/`, `run.ts`, `thresholds.json`.

## Definition of done (per phase, spec §14)
A phase is done only when: typecheck + tests + `npm run eval` are green on `main`, the relevant feature is reachable in the app or verifiable via a command, docs reflect it, and the commit history shows small tested steps. The headline acceptance test for the pipeline: **switching the active business profile re-scores the board correctly** — the import de minimis item flags Critical for the goods/hardware profiles and is filtered out for the SaaS and food profiles.

## Design (spec §12)
Match the reference aesthetic: warm parchment canvas, antique-engraving hero, white app card, US threat-map with auto-cycling floating cards, deep-navy + soft blue-grey + one royal-blue accent (`--accent:#2F6BFF`). Branded **RedLine**, our own copy. The "Viewing as" profile switcher is the signature interaction. A Bills-feed prototype exists — re-theme it to these tokens and add the Overview map. Quality floor: responsive, keyboard focus, reduced-motion respected, directive empty/error states.
