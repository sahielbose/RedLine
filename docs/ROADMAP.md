# Roadmap

> Derived from [`REDLINE_MASTER_SPEC.md` §14](./REDLINE_MASTER_SPEC.md#14-build-phases-agent-driven) (build phases) plus the explicit gaps and "beta" items called out across §5, §8, §9, and §11.
> Anything here is **forward-looking** - the current contract is `src/lib/types.ts` / `interfaces.ts` / `env.ts`, and the integration points (DB schema §6, interfaces §7) do not change to chase roadmap items.
> Siblings: [DATA_SOURCES](./DATA_SOURCES.md) · [EVALS](./EVALS.md) · [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md).

## Build phases (each ends green on `main`: typecheck + tests + `npm run eval`)

### Phase 0 - Scaffold & docs
Next.js + TS + Drizzle + pg-boss + pgvector; `.env.example`; MIT license; CI; docs written from the spec.
**Checkpoint:** app boots, CI green.

### Phase 1 - Ingestion (parallel)
`SourceClient` + Congress.gov, Federal Register, Open States (1–3 states) with cursor + backoff; normalize → upsert → `item_status_history`; classify categories; embed.
**Checkpoint:** real rows land, no dupes on re-run, cursor advances.

### Phase 2 - Pipeline + evals
Onboarding → profile; Stage 0/A/B; log judgments; memo gen + citation verify + approval gate + audit; eval harness with the four anchor cases × four profiles.
**Checkpoint:** `npm run eval` green on anchors; switching profile changes scores correctly (anchor C flags goods/hardware, rejects SaaS/food).

### Phase 3 - UI (parallel with Phase 2 where possible)
AppShell + ProfileSwitcher + Bills feed + MemoPanel (re-theme the existing prototype to the warm palette) + Overview map + floating cards + Tracker + ReviewQueue + Auth.js.
**Checkpoint:** app usable end-to-end against seeded data.

### Phase 4 - Delivery + hardening
pg-boss schedules; digest email (SMTP); comment-deadline alerts; grow eval set per module; expand states (CA first).
**Checkpoint:** digest of approved items sends; eval thresholds hold.

---

## Beyond v1

### State expansion
- Today: 1–3 Open States states, **CA first** (most consequential state law for SMBs; most base law is state law per [TAXONOMY](./TAXONOMY.md)).
- Next: roll out states one at a time, each **labeled beta** until it has a real eval slice. Add **LegiScan** as a cross-check where Open States lags.
- Honesty: never imply a state is covered before it is measured.

### State regulatory-register scraper (the documented gap)
The biggest known coverage gap: **state *regulation*, not statute** - state agency rulemakings live in each state's regulatory register / OAL-equivalent, which is **not** in Open States (bills only) and **not** in the Federal Register (federal only). Roadmap a **per-state regulatory-register scraper** as a new `SourceClient` (same interface, new `key` - note this would extend the `Source` union in `src/lib/types.ts`, an orchestrator-owned change). Until then, the gap is surfaced honestly in the UI ([TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#coverage-honesty)).

### Module maturation
Each module (`software`, `goods`, `food`, `hardware`) ships **beta** until it has **~15–20 positives + a generous decoy pile** in the eval set ([EVALS](./EVALS.md)). Maturation order follows the distribution wedge (one community at a time), not engineering convenience. Re-verify expansion eval items (E–H) before promoting a module.

### Delivery: Slack (and beyond)
- v1 delivery is the **digest email** (Nodemailer / SMTP behind the `Mailer` interface) of **approved** memos only.
- Next: a **Slack** delivery adapter behind the same `Mailer`-style boundary (a new adapter, not a contract change) so a team gets the approved digest + comment-deadline alerts in-channel. Still gated by the approval queue - Slack is a delivery surface, not an auto-send bypass.
- Resend remains an optional `Mailer` adapter for hosted email.

### Self-host depth
- Local model paths (`LLM_PROVIDER=ollama`, `EMBEDDER=ollama`/`local`) are first-class today; harden the 100%-offline deploy story and document model/dimension pairings (`EMBED_DIM` must match the embedder).
- Bulk-data / self-hosted scraper ingestion for Open States at scale (commercial limits are emerging).

### Trust deepening
- Grow `relevance_feedback` → eval cases automatically.
- Surface calibration per module/state in-product ("measured on N labeled cases").
- Provenance enrichment: link near-identical bills across states (the "originated from X model legislation" signal) - **sourced, never invented**.

---

## Explicitly out of scope (kept here so it stays out)
Fabricated impact figures · vote/whip-count predictions · a directory of named individuals' contact info · any auto-send. See [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#what-we-deliberately-dont-build-and-why).
