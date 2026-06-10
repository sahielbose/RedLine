# Regulation taxonomy

> Expands [`REDLINE_MASTER_SPEC.md` §9](./REDLINE_MASTER_SPEC.md#9-the-regulation-taxonomy).
> The canonical lists are the `as const` unions in `src/lib/types.ts` — `BASE_CATEGORIES`, `MODULE_CATEGORIES`, `CATEGORIES`, and `isCategory()`. Import them; do not re-spell the strings.
> Siblings: [PIPELINE](./PIPELINE.md) · [ONBOARDING](./ONBOARDING.md) · [PROMPTS](./PROMPTS.md) · [EVALS](./EVALS.md).

## The model: base layer + business-type modules

Every business has two layers of exposure:
- a **base layer** shared by all employers/operators, and
- **business-type modules** toggled on at onboarding.

A SaaS company = base + `software`; a food maker = base + `food`. Build ~8 base categories + 4 modules once; any real business is a combination. Relevance = **Stage 0 category intersection + Stage A embedding + Stage B judge** ([PIPELINE](./PIPELINE.md)).

## BASE categories (every business)

`BASE_CATEGORIES` in `src/lib/types.ts`:

| Category | Covers | Note |
|---|---|---|
| `wages_hours` | minimum wage, overtime thresholds, pay frequency | mostly **state** law |
| `leave_benefits` | paid sick/family leave, mandated benefits | mostly state |
| `classification_scheduling` | employee vs contractor, predictive scheduling | the 1099 / independent-contractor surface |
| `licensing_registration` | business registration, beneficial-ownership, permits | anchor A lives here |
| `taxes` | sales/use, payroll, nexus | overlaps `goods` for nexus |
| `data_privacy` | breach notice, consumer data, COPPA | overlaps `software` |
| `workplace_safety` | OSHA / state-plan safety | |
| `accessibility` | ADA / web accessibility | |

> Most base law is **state** — federal is the floor. This is why state expansion is an early roadmap priority and why the state-regulatory-register gap matters ([DATA_SOURCES](./DATA_SOURCES.md)).

## MODULE categories (the business-type toggles)

`MODULE_CATEGORIES` in `src/lib/types.ts` — these strings double as `BusinessType`:

**`software`** — consumer privacy/data security, children's privacy (COPPA), AI rules, subscription/auto-renewal (negative option), consumer-protection/UDAP.

**`goods`** — sales-tax nexus, import duties/customs (de minimis / tariffs), marketplace-seller rules, labeling, packaging/EPR.

**`food`** — food safety & traceability (FSMA), labeling, health permits, alcohol licensing. **Supply-chain role matters:** a maker/distributor is covered by far more than a dine-in-only restaurant (`food_supply_chain_role` in `ProfileAttributes`).

**`hardware`** — product safety (CPSC), device/equipment authorization (FCC), energy efficiency (DOE), e-waste/right-to-repair — **plus everything in `goods`** (hardware is physically shipped, imported, sold).

## Tagging rules (Stage 0)

Items get `categories[]`; profiles get `subscribed_categories[]` (= base + modules from onboarding). Stage 0 tags at ingest with **cheap agency/keyword signals first** (recall-first), upgrading to the LLM classifier ([PROMPTS](./PROMPTS.md#3-stage-0-classifier--prompt_version-v1)) for ambiguous items.

### Agency / keyword → category signals

| Signal (agency or keyword) | Tag |
|---|---|
| FDA, "food", "FSMA", "traceability" | `food` |
| CBP, "de minimis", "Section 321", "tariff", "import duty" | `goods`, `hardware` |
| DOL, "overtime", "minimum wage", "FLSA" | `wages_hours` |
| DOL / state, "independent contractor", "1099", "misclassification" | `classification_scheduling` |
| FTC, "negative option", "auto-renewal", "click-to-cancel", "ROSCA" | `software` |
| FTC, "COPPA", "children's privacy" | `software`, `data_privacy` |
| state AG / FTC, "data breach", "consumer data", "privacy" | `data_privacy` |
| FinCEN, "beneficial ownership", "CTA", "business registration" | `licensing_registration` |
| CPSC, "product safety", "recall" | `hardware` |
| FCC, "equipment authorization", "Covered List" | `hardware` |
| DOE, "energy efficiency" | `hardware` |
| FTC/state, "INFORM", "marketplace seller" | `goods` |
| Dept. of Revenue, "sales tax", "nexus" | `taxes`, `goods` |
| OSHA / state plan, "workplace safety" | `workplace_safety` |
| ADA, "accessibility", "WCAG" | `accessibility` |

**Recall-first rule:** when in doubt, **tag it**. A missing tag drops the item from a whole audience's funnel before any judge or human sees it (the silent-recall risk in [PIPELINE](./PIPELINE.md)). Over-tagging is corrected downstream by Stage B; under-tagging is invisible — so tagging is **audited against the eval set**, and a tagging change is eval-gated.

### Cross-module overlaps to remember
- `hardware` ⊇ `goods` — anything tagged `hardware`-relevant for import/sale should also carry `goods`.
- `software` ↔ `data_privacy` — privacy/COPPA items often carry both.
- `goods` ↔ `taxes` — sales-tax nexus straddles both.

## How this drives scoring

`isCategory(s)` guards any string before it is treated as a category. Stage 0 keeps only items where `items.categories && profile.subscribed_categories`. This is the gate that makes a food rule never reach a SaaS company's judge — and the reason anchor C (de minimis, tagged `goods`+`hardware`) flags for `ecom-goods`/`hardware-maker` and is filtered out for `saas-remote`/`food-cpg` ([EVALS](./EVALS.md)).
