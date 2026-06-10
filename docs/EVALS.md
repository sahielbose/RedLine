# Evals — the highest-leverage thing

> Expands [`REDLINE_MASTER_SPEC.md` §11](./REDLINE_MASTER_SPEC.md#11-the-eval-matrix) and the trust requirements in §8.
> Codes against `src/lib/types.ts` (profiles, `JudgeResult`, `severityLabel`) and lives in `evals/`.
> Siblings: [PIPELINE](./PIPELINE.md) · [ONBOARDING](./ONBOARDING.md) · [PROMPTS](./PROMPTS.md) · [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md).

## Why this is the product, not a test suite

You cannot prove "no missed bills." **The eval set is the evidence** — and only for the categories and states you have labeled. The harness ships in the first hour and gates every prompt/rubric/classifier change. The promise it buys: you can change the triage prompt and *immediately* see if recall broke, instead of finding out when a customer's rule slips through.

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

- **Catch every flag.** A labeled-relevant item the judge scores below threshold is a **false negative** — the worst failure mode. The runner prints every false negative **loudly**.
- **Reject every decoy.** A labeled-not-relevant item scored at/above threshold is a false positive (precision).
- The relevant/not-relevant cut maps through `severityLabel` (`src/lib/types.ts`): score ≥ `MEMO_THRESHOLD` (default 4) is the "act/draft" band; the eval labels say which side each cell belongs on.

## The anchor matrix (verified mid-2026 — re-verify expansion items before trusting)

| # | Item · category · source | saas-remote | ecom-goods | food-cpg | hardware-maker |
|---|---|---|---|---|---|
| **A** | Beneficial-ownership / Corporate Transparency Act · `licensing_registration` · FinCEN/FR. *Interim rule eff. Mar 26 2025 exempts all domestic entities; only foreign reporting companies file; 11th Cir. upheld constitutionality Dec 2025 but did not reinstate domestic reporting; final rule pending.* | flag 3–4 | flag 3–4 | flag 3–4 | flag 3–4 |
| **B** | FTC "click-to-cancel" / Negative Option · `software` · FTC/FR. *2024 rule vacated by 8th Cir. Jul 8 2025; FTC restarted rulemaking (ANPRM to OIRA Jan 30 2026; comments ~Apr 13 2026); ROSCA + state auto-renewal still apply.* | **5** | 2 (decoy unless it adds subscriptions) | 1 | 1 |
| **C** | Import de minimis suspended (Section 321) · `goods`,`hardware` · CBP/Executive Order. *Duty-free <$800 suspended China/HK May 2 2025, then globally Aug 29 2025; all imports owe duties + full entry. EO → Federal Register, not Congress.gov.* | 1 | **5** | 2 (only if imports ingredients/packaging) | **5** |
| **D** | FDA FSMA 204 Food Traceability · `food` · FDA/FR. *Compliance date extended Jan 20 2026 → Jul 20 2028 (FR 2025-14967; Nov 2025 appropriations barred earlier enforcement). Applies to make/process/pack/hold listed foods.* | 0–1 | 0–1 | **4–5** | 0–1 |

**C is the best demo of horizontal relevance** — same rule, two flags, two correct rejects. **D is the precision test** — a dine-in-only restaurant is largely *exempt*, so `serves_food` alone isn't enough; `food_supply_chain_role` decides.

### Expansion items (verify before trusting)
- **E. FTC COPPA amendments** `software`,`data_privacy` — flag for `saas-remote` only if `data_from_children_under_13`.
- **F. INFORM Consumers Act** `goods` — flag for `ecom-goods` if it sells via third-party marketplaces.
- **G. DOL independent-contractor rule** `classification_scheduling` (BASE) — flag for any profile with `has_1099_contractors`.
- **H. FCC equipment authorization / Covered List** `hardware` — flag for `hardware-maker` only.

### Decoys (reject for ALL four)
- **I. FMCSA hours-of-service** (no module — none is a trucking carrier).
- Add 2–3 more all-profile decoys: Medicare hospital reimbursement, bank capital rules. **Decoys matter as much as positives** — they prove precision and keep the feed honest.

## How to build a case

1. Capture the real item payload into `evals/fixtures/` (so the case is offline and reproducible — no live API in CI).
2. Reference one of `evals/profiles/`.
3. Write the expected cell into `evals/cases/*.json`: the profile, the fixture, and the label (relevant / not_relevant, optionally an expected score band).
4. Re-verify the regulatory status of any non-anchor item before trusting its label — statuses move (see the dated notes above).

Real history is the best source: the 👍/👎 feedback in `relevance_feedback` ([DATA_MODEL](./DATA_MODEL.md)) becomes new labeled cases.

## How to run

```bash
npm run eval        # tsx evals/run.ts
```

The runner executes Stage B per case, reports **precision / recall / F1**, prints every **false negative** loudly, and **exits non-zero** if any metric is below `evals/thresholds.json` — so CI fails. Run it after **every** prompt/rubric/classifier change. Because the defaults are hermetic (`LLM_PROVIDER=local`, `EMBEDDER=hash` in `src/lib/env.ts`), the eval runs green with zero secrets.

## Thresholds & "recall is sacred"

`evals/thresholds.json` sets the floors. The asymmetry is deliberate:

- **Recall is sacred.** A recall regression means a real rule would slip past a business that needed it — the exact failure RedLine exists to prevent. A recall drop is a **blocker**, never merged. Tagging changes (Stage 0) are audited here too, because a missed tag is an invisible recall loss.
- **Precision is gated but tunable.** False positives cost trust and reviewer time; the "N filtered out as low relevance" expander keeps precision visible. Precision floors can be tightened as a module matures.

## Growing the set / module maturity

Grow to **~15–20 positives + a generous decoy pile per module** before marking a module mature. Until then the module ships **labeled beta** in the UI ([TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#coverage-honesty)) — we never imply coverage we have not measured. The done-signal for v1 of the eval set: changing the triage prompt immediately shows whether recall broke.
