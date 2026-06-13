# Onboarding → business profile

> Expands [`REDLINE_MASTER_SPEC.md` §10](./REDLINE_MASTER_SPEC.md#10-onboarding--business-profile).
> Produces a `BusinessProfile` with `ProfileAttributes` (`src/lib/types.ts`), persisted to `org_profiles` ([DATA_MODEL](./DATA_MODEL.md)).
> Siblings: [TAXONOMY](./TAXONOMY.md) · [PIPELINE](./PIPELINE.md) · [EVALS](./EVALS.md).

## Onboarding is part of the engine

The profile is the query the entire relevance funnel runs against. A weak profile produces weak scores no matter how good the judge is - so onboarding maps a handful of plain questions into the structured fields the pipeline needs, **including the negatives** that make the judge *reject* off-target rules.

## Question → field map

| Question | Writes to | Effect |
|---|---|---|
| Which states do you operate in? | `jurisdictions` (`['us','us-ca',…]`) | Stage A jurisdiction filter; always includes `us`. |
| What do you do? (software / goods / hardware / food) | `business_types` (`BusinessType[]`) | Toggles modules → adds module cats to `subscribed_categories`. |
| Employee count | `attributes.employees` | Thresholds on employment-law items. |
| Have W-2 employees? | `attributes.has_w2` | Base employment cats relevance. |
| Use 1099 contractors? | `attributes.has_1099_contractors` | `classification_scheduling` (anchor G). |
| Sell a subscription? | `attributes.sells_subscription` | `software` negative-option / auto-renewal (anchor B). |
| Sell physical goods? | `attributes.sells_physical_goods` | `goods` relevance. |
| Sell via third-party marketplaces? | `attributes.sells_via_marketplace` | INFORM Act / marketplace-seller (anchor F). |
| Import anything? | `attributes.imports_goods` | customs / de minimis (anchor C). |
| Collect customer data online? | `attributes.collects_customer_data_online` | `data_privacy`. |
| Data from children under 13? | `attributes.data_from_children_under_13` | COPPA (anchor E). |
| For food: make/pack/hold vs only serve? | `attributes.food_supply_chain_role` (`make_pack_hold`/`serve_only`/`distribute`/null) | FSMA 204 scope - `make_pack_hold`/`distribute` in scope, `serve_only` largely exempt (anchor D). |
| Serves food at all? | `attributes.serves_food` | gates `food` module. |

`ProfileAttributes` is typed for these known keys plus an index signature, so onboarding can add questions without breaking the contract.

## Profile generation (the derivation)

From the answers, derive:

1. **`business_types`** - the set of module toggles selected.
2. **`subscribed_categories`** - **all 8 base categories** (every business is an employer/operator) **+** one set of module cats per active `business_type`. (`hardware` implies `goods` per [TAXONOMY](./TAXONOMY.md).)
3. **`concern_text`** - a generated paragraph encoding **positives and negatives**, embedded for Stage A and handed to the Stage B judge. The negatives are what reject decoys - see the example.
4. **`embedding`** - `Embedder.embed([concern_text])` → `org_profiles.embedding`.

### Example profile (note the negatives)

```json
{
  "business_types": ["software"],
  "jurisdictions": ["us", "us-ca"],
  "attributes": {
    "employees": 12, "has_w2": true, "has_1099_contractors": true,
    "sells_subscription": true, "imports_goods": false, "sells_physical_goods": false,
    "serves_food": false, "collects_customer_data_online": true,
    "data_from_children_under_13": false
  },
  "subscribed_categories": ["wages_hours","leave_benefits","classification_scheduling",
    "licensing_registration","taxes","data_privacy","workplace_safety","accessibility","software"],
  "concern_text": "Fully-remote B2B SaaS in CA, 12 W-2 staff + 1099 contractors, sells auto-renewing subscriptions, collects customer data online. Hurt by changes to subscription/cancellation rules, data privacy/breach notice, worker classification, overtime thresholds, mandated benefits. Does NOT sell physical goods, import, or handle food."
}
```

The closing "Does NOT…" sentence is deliberate: it gives the judge the explicit negatives that turn an import-duty rule into a correct **reject** for this business.

## The four eval profiles

These live under `evals/profiles/` and pin the relevance matrix ([EVALS](./EVALS.md)). They are the canonical shapes onboarding must be able to produce:

| Profile | `business_types` | Key attributes | Designed to test |
|---|---|---|---|
| `saas-remote` | `["software"]` | remote, W-2 + 1099, sells subscription, online data, no goods/food/import | flags B (5); rejects C, D |
| `ecom-goods` | `["goods"]` | sells **and imports** goods, marketplace seller | flags C (5), F; rejects B, D |
| `food-cpg` | `["food"]` | **makes + distributes** food (`make_pack_hold`), may import ingredients | flags D (4–5); rejects B; C only if it imports |
| `hardware-maker` | `["hardware"]` | builds a device, imports parts, sells D2C | flags C (5), H; (inherits `goods`) |

All four should **flag anchor A** (beneficial-ownership / CTA) at 3–4 - the textbook universal base item - and **reject the all-profile decoys** (FMCSA hours-of-service, etc.).

The "Viewing as {business}" switcher re-runs scoring against whichever of these profiles is active; the same item gets a different severity stamp per profile, which is the signature interaction and the core acceptance test (spec §14).
