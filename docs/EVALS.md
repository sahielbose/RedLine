# Evals - the highest-leverage thing

> Expands [`REDLINE_MASTER_SPEC.md` §11](./REDLINE_MASTER_SPEC.md#11-the-eval-matrix) and the trust requirements in §8.
> Codes against `src/lib/types.ts` (profiles, `JudgeResult`, `severityLabel`) and lives in `evals/`.
> Siblings: [PIPELINE](./PIPELINE.md) · [ONBOARDING](./ONBOARDING.md) · [PROMPTS](./PROMPTS.md) · [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md).

## Why this is the product, not a test suite

You cannot prove "no missed bills." **The eval set is the evidence** - and only for the categories and states you have labeled. The harness ships in the first hour and gates every prompt/rubric/classifier change. The promise it buys: you can change the triage prompt and *immediately* see if recall broke, instead of finding out when a customer's rule slips through.

## Layout

```
evals/
├─ cases/          # golden labeled cases (per item × profile), *.json
├─ fixtures/       # the item payloads under test (so cases are offline + reproducible)
├─ profiles/       # the four eval profiles (saas-remote, ecom-goods, food-cpg, hardware-maker)
├─ run.ts          # the runner: `npm run eval` (tsx)
└─ thresholds.json # precision/recall/F1 floors; CI fails below them
```

## Relevance is a matrix

Each rule is labeled **per profile**, because the same rule is signal for one business and noise for another. A case pins an `(item, profile) → expected` cell. The runner executes **Stage B** (the rubric judge) against the fixture + profile and compares to the label.

- **Catch every flag.** A labeled-relevant item the judge scores below threshold is a **false negative** - the worst failure mode. The runner prints every false negative **loudly**.
- **Reject every decoy.** A labeled-not-relevant item scored at/above threshold is a false positive (precision).
- The relevant/not-relevant cut maps through `severityLabel` (`src/lib/types.ts`): score ≥ `MEMO_THRESHOLD` (default 4) is the "act/draft" band; the eval labels say which side each cell belongs on.

## The anchor matrix (verified mid-2026 - re-verify expansion items before trusting)

| # | Item · category · source | saas-remote | ecom-goods | food-cpg | hardware-maker |
|---|---|---|---|---|---|
| **A** | Beneficial-ownership / Corporate Transparency Act · `licensing_registration` · FinCEN/FR. *Interim rule eff. Mar 26 2025 exempts all domestic entities; only foreign reporting companies file; 11th Cir. upheld constitutionality Dec 2025 but did not reinstate domestic reporting; final rule pending.* | flag 3–4 | flag 3–4 | flag 3–4 | flag 3–4 |
| **B** | FTC "click-to-cancel" / Negative Option · `software` · FTC/FR. *2024 rule vacated by 8th Cir. Jul 8 2025; FTC restarted rulemaking (ANPRM to OIRA Jan 30 2026; comments ~Apr 13 2026); ROSCA + state auto-renewal still apply.* | **5** | 2 (decoy unless it adds subscriptions) | 1 | 1 |
| **C** | Import de minimis suspended (Section 321) · `goods`,`hardware` · CBP/Executive Order. *Duty-free <$800 suspended China/HK May 2 2025, then globally Aug 29 2025; all imports owe duties + full entry. EO → Federal Register, not Congress.gov.* | 1 | **5** | 2 (only if imports ingredients/packaging) | **5** |
| **D** | FDA FSMA 204 Food Traceability · `food` · FDA/FR. *Compliance date extended Jan 20 2026 → Jul 20 2028 (FR 2025-14967; Nov 2025 appropriations barred earlier enforcement). Applies to make/process/pack/hold listed foods.* | 0–1 | 0–1 | **4–5** | 0–1 |

**C is the best demo of horizontal relevance** - same rule, two flags, two correct rejects. **D is the precision test** - a dine-in-only restaurant is largely *exempt*, so `serves_food` alone isn't enough; `food_supply_chain_role` decides.

### Expansion items (verify before trusting)
- **E. FTC COPPA amendments** `software`,`data_privacy` - flag for `saas-remote` only if `data_from_children_under_13`.
- **F. INFORM Consumers Act** `goods` - flag for `ecom-goods` if it sells via third-party marketplaces.
- **G. DOL independent-contractor rule** `classification_scheduling` (BASE) - flag for any profile with `has_1099_contractors`.
- **H. FCC equipment authorization / Covered List** `hardware` - flag for `hardware-maker` only.

### Decoys (reject for ALL four)
- **I. FMCSA hours-of-service** (no module - none is a trucking carrier).
- **J. Medicare hospital reimbursement** (CMS IPPS - reaches hospitals/health systems).
- **K. Bank capital requirements** (Federal Reserve - reaches large banking organizations).
- **P. Medicare Physician Fee Schedule** (CMS - reaches clinicians/practices that bill Medicare).
- **Q. Basel III endgame bank capital standards** (OCC/banking agencies - large banking organizations).
- **R. SEC issuer disclosure / periodic reporting** (public-company issuers with registered securities).
- **S. FAA transport-category aircraft certification** (aircraft makers + certificated air carriers).

**Decoys matter as much as positives** - they prove precision and keep the feed honest. Every decoy above carries `categories: []` and is phrased to avoid any subscribed-category keyword, so Stage 0 produces no overlap and the item is rejected (score 0) for all four profiles. The Stage-0 tagging audit in `run.ts` independently asserts no decoy leaks a subscribed category.

> **Dropped candidate (noted for honesty):** an **OSHA heat-illness** rule was considered as an all-profile decoy but rejected. `workplace_safety` is a BASE category every profile subscribes to, so an OSHA item keyword-classifies into a subscribed category and the Stage-0 decoy audit (correctly) flags it as a leak. A real OSHA heat rule is a *low-relevance positive* for office/remote profiles, not a clean decoy - labeling it as a decoy would have weakened the audit, so it was dropped rather than forced.

### Per-module positives (sibling cases that exercise the same general gates)
These were added to grow recall coverage without item-id special-casing - each is caught (or rejected) by the *existing* general gates, not new logic:
- **L. Additional tariffs + loss of duty-free customs entry** `goods`,`hardware` (CBP) - sibling of headline **C**. Flags Critical for `ecom-goods` + `hardware-maker` (direct import exposure), filtered for `saas-remote`/`food-cpg`.
- **M. State automatic-renewal / recurring-subscription cancellation** `software` (state AG) - sibling of **B**. Flags Critical for `saas-remote`, filtered elsewhere (only SaaS subscribes to `software`).
- **N. FSMA preventive-controls recordkeeping (make/pack/hold human food)** `food` (FDA) - sibling of **D**. Flags Critical for `food-cpg`, filtered elsewhere.
- **O. CPSC consumer-product-safety standard for connected devices** `hardware` (CPSC) - sibling of **H**. Flags Monitor for `hardware-maker` (generic in-category gate; no FCC-specific gate fires), filtered elsewhere.

## How to build a case

1. Capture the real item payload into `evals/fixtures/` (so the case is offline and reproducible - no live API in CI).
2. Reference one of `evals/profiles/`.
3. Write the expected cell into `evals/cases/*.json`: the profile, the fixture, and the label (relevant / not_relevant, optionally an expected score band).
4. Re-verify the regulatory status of any non-anchor item before trusting its label - statuses move (see the dated notes above).

Real history is the best source: the 👍/👎 feedback in `relevance_feedback` ([DATA_MODEL](./DATA_MODEL.md)) becomes new labeled cases.

## How to run

```bash
npm run eval        # tsx evals/run.ts
```

The runner executes Stage B per case, reports **precision / recall / F1**, prints every **false negative** loudly, and **exits non-zero** if any metric is below `evals/thresholds.json` - so CI fails. Run it after **every** prompt/rubric/classifier change. Because the defaults are hermetic (`LLM_PROVIDER=local`, `EMBEDDER=hash` in `src/lib/env.ts`), the eval runs green with zero secrets.

## Thresholds & "recall is sacred"

`evals/thresholds.json` sets the floors. The asymmetry is deliberate:

- **Recall is sacred.** A recall regression means a real rule would slip past a business that needed it - the exact failure RedLine exists to prevent. A recall drop is a **blocker**, never merged. Tagging changes (Stage 0) are audited here too, because a missed tag is an invisible recall loss.
- **Precision is gated but tunable.** False positives cost trust and reviewer time; the "N filtered out as low relevance" expander keeps precision visible. Precision floors can be tightened as a module matures.

## Current counts

The set is **19 cases over 19 fixtures × 4 profiles = 76 labeled (item, profile) cells** (was 11 × 4 = 44), of which **16 are flagged-positive cells** (TP) and 60 are correct rejects (TN). Item breakdown:

- **11 positive items** (at least one flagged cell): anchors **A** (flags for all four), **B**/**M** (`software`), **C**/**L** (`goods`+`hardware`), **D**/**N** (`food`), plus expansions **F** (`goods`/marketplace), **G** (BASE/1099), **H** (`hardware`/FCC), **O** (`hardware`/CPSC).
- **7 decoy items** (reject for all four): **I, J, K, P, Q, R, S**.
- **1 all-Low expansion**: **E** (COPPA - none of the four profiles sets `data_from_children_under_13`, so all four are correctly below threshold).

The current run reports **precision 1.000 · recall 1.000 · F1 1.000** (TP=16, FP=0, FN=0, TN=60), the headline holds, there are no false negatives, and the Stage-0 tagging audit is clean (no recall holes, no decoy leaks).

## Per-module maturity (as of this expansion)

Target before "mature": **~15–20 positives + a generous decoy pile per module.** None has reached that bar yet, so every module ships **labeled beta** in the UI. Relative standing today:

| Module | Positives now | Decoy coverage | Status |
|---|---|---|---|
| `goods` / `hardware` (customs/import) | **2** (C, L) + module siblings F (marketplace), H (FCC), O (CPSC) | strong (I, P, Q, R, S all reject) | **beta - best-covered**; the headline horizontal-relevance pair is double-anchored (C + L), gate exercised at all three branches (direct / indirect / no-import) |
| `software` (auto-renewal/subscription) | **2** (B, M) | strong | **beta**; both the SaaS-Critical and the goods/food/hardware-reject paths are pinned twice |
| `food` (FSMA make/pack/hold) | **2** (D, N) | strong | **beta**; the make_pack_hold scope test is doubled; the serve-only exemption nuance still rides on the gate (no serve-only fixture yet) |
| BASE (`licensing_registration`, `classification_scheduling`, `data_privacy`) | A (all-profile), G (1099), E (COPPA negative) | strong | **beta - thin**; each base gate has only a single positive; grow before trusting |

**Where to grow next (recall gaps to close, not weaken):** a `food` *serve-only* fixture (to pin the exemption branch explicitly), a `data_privacy` positive that actually trips COPPA (`data_from_children_under_13: true` on a fixture profile), and more BASE-layer positives (paid-leave, sales-tax nexus, accessibility) - each must be caught by an existing gate or the gate must be extended *with* the label, never relax recall to fit a label in.

## Growing the set / module maturity

Grow to **~15–20 positives + a generous decoy pile per module** before marking a module mature. Until then the module ships **labeled beta** in the UI ([TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#coverage-honesty)) - we never imply coverage we have not measured. The done-signal for v1 of the eval set: changing the triage prompt immediately shows whether recall broke.

**Recall is sacred (restated).** Every positive added here is one the *existing* general gates already catch - no item-id special-casing, no engine change. If a candidate positive would not be flagged by the current gates, it is **dropped and noted**, never forced through by loosening a threshold or hand-coding the item. A recall regression (a labeled-relevant cell scoring below the flag threshold) is a blocker, never merged; a missed Stage-0 tag is the same failure made invisible, which is why the tagging audit gates alongside precision/recall/F1.
