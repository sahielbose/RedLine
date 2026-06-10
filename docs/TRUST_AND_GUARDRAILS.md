# Trust layer & guardrails

> Expands [`REDLINE_MASTER_SPEC.md` §8](./REDLINE_MASTER_SPEC.md#8-trust-layer) (trust layer) and [§15](./REDLINE_MASTER_SPEC.md#15-guardrails--non-negotiables) (non-negotiables). Mirrors `CLAUDE.md`'s golden rules.
> Enforced in `src/lib/types.ts` shapes (`Citation.verified`, `MemoContent.impact_estimate`, `MemoStatus`) and in code — **not just in prompts**.
> Siblings: [PIPELINE](./PIPELINE.md) · [DATA_MODEL](./DATA_MODEL.md) · [EVALS](./EVALS.md) · [PROMPTS](./PROMPTS.md).

**The trust layer is ~95% of the product. Build it from commit #1.** The model is ~5%; coverage, precision, citations, and audit are what a small business is actually buying. Each guardrail below is enforced in **code**, with the prompt as a second line of defence.

---

## Approval gate

Memos and any outbound start `status='draft'` (`MemoStatus` in `src/lib/types.ts`). **Nothing sends without explicit human approval.** No auto-send in v1.

- The **review queue** (Alerts tab) is first-class, not an afterthought.
- On approval: `memos.status='approved'`, `approved_by` = the user, `approved_at` = now → eligible for the digest.
- The digest delivers **approved items only**.
- Ask a human before any **destructive/irreversible** action: force-push, history rewrite, mass delete, publishing, payments, changing repo settings.

## Audit log

Every state change → one `audit_log` row with `before`/`after` JSON, `actor` (user uuid or `'system'`), `action`, `entity_type`, `entity_id` ([DATA_MODEL](./DATA_MODEL.md#audit_log)). It is both a **trust feature** (a customer can see exactly what changed and who did it) and a **debugger** (reconstruct any pipeline decision). Memo approvals, status changes, profile edits, and overrides all write here.

## No fabrication

Never emit an invented **dollar impact**, **probability**, or **vote prediction** — in prompts *and* enforced in code.

- `MemoContent.impact_estimate` is a **labeled estimate with stated assumptions, or empty (`null`)** — never a hero number presented as calculated. Code rejects an unlabeled numeric impact claim before save.
- **No outcome / whip-count predictions** ("likely yes 5, swing 3…"). The STATUS surface shows *factual* upcoming events only — hearing dates, `comment_close_date`, status changes — never invented vote forecasts about named people.
- The Stage B judge and memo prompts both forbid invented section numbers and unsupported claims; the eval harness catches drift.

## No PII directories

Never build or seed a directory of named individuals' personal contact info. The lobbyist-relationship layer is a forward-deployed-services moat, not a vibe-codeable feature.

- `recommended_action` ∈ `comment | monitor | call_counsel | no_action`; any link points to an **official public portal** (e.g. the Regulations.gov comment page), **never a person's phone/email**.
- `items.sponsors` is source-native metadata for display/provenance — it is **not** turned into a contact directory.

## Citation verification (by code, not the model)

`Citation.verified` (`src/lib/types.ts`) is set by **code**, never trusted from the model:

> a citation's `snippet` must be a **whitespace-normalized substring** of the source text, or it is dropped/flagged.

The substring check decides `verified`, not the LLM's self-report. Memo claims link to verified source snippets; the item detail shows full `item_status_history` with raw payloads, so every claim traces back to ground truth ([PIPELINE](./PIPELINE.md#memo-generator-srcpipelinememots)).

## Feedback loop

👍/👎 on flagged items → `relevance_feedback` → new labeled eval cases ([EVALS](./EVALS.md)). The human-in-the-loop signal that grows the matrix over time.

## Coverage honesty (calibration)

You **cannot** prove "no missed bills." The **eval set is the evidence**, and only for the categories/states you have labeled. So:

- Label immature modules/states **beta** in the UI ([DESIGN](./DESIGN.md)).
- **Document the state-regulatory-register gap** — Open States is bills-only and the Federal Register is federal-only, so state agency rulemakings can be silently missed until the per-state register scraper ships ([DATA_SOURCES](./DATA_SOURCES.md#the-state-regulatory-register-gap-document-do-not-hide), [ROADMAP](./ROADMAP.md)).
- **Never imply coverage you haven't measured.**

## Eval-gated changes

Every prompt / rubric / classifier change re-runs `npm run eval`. A **recall regression fails CI and is not merged** — recall is sacred ([EVALS](./EVALS.md)). Version constants (`RUBRIC_VERSION`, `PROMPT_VERSION` in `src/lib/types.ts`) are bumped on each change so judgments stay attributable.

---

## Security (§15)

- **Open source.** MIT/Apache deps only; nothing that forces a proprietary core. The only non-OSS pieces (LLM + embeddings) are behind interfaces with a documented local (Ollama / transformers.js) fallback; the **defaults are hermetic** (`LLM_PROVIDER=local`, `EMBEDDER=hash`).
- **Secrets in `.env` only.** Commit `.env.example` (keys, no values). Never print, log, or commit a real key. Never enter credentials into any external form or site. All env access goes through the validated `env()` in `src/lib/env.ts`.
- **Server-only secrets.** Keys are read server-side; nothing secret crosses to the client bundle.
- **Multi-tenant isolation.** `org_id` scopes every business table; scoring/memos/audit never cross orgs. The profile switcher is a read-side re-scope only.
- **Copyright / clone-not-copy.** Paraphrase sources; quote < 15 words, one per source, attributed; never reproduce another product's copy, screenshots, or branding. RedLine uses its own name and copy.

## What we deliberately DON'T build (and why)

| Not built | Why |
|---|---|
| Fabricated impact dollar figures ("$142M at risk") | An LLM invents confident numbers on demand. We show qualitative impact + a labeled, editable estimate. |
| Outcome / whip-count predictions | We show factual events, not invented forecasts about named people. |
| A directory of named individuals' contact info | PII; out of scope. Action links to official portals. |
| Auto-send of anything | Memos are drafts until a human approves. |

## The non-negotiables, condensed

1. Open source (MIT/Apache); local fallback documented.
2. Secrets in `.env` only.
3. No fabrication (prompts **and** code).
4. No PII directories.
5. Citations verified by code (substring check).
6. Approval gate; no destructive action without a human.
7. Clone the idea, not the brand.
8. Coverage honesty; beta-label immature modules/states.
9. Eval-gated changes; recall regressions block merge.
