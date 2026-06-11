/**
 * The relevance engine - `heuristicJudge` (spec §7, §9, §11).
 *
 * A GENERAL, deterministic rubric scorer. It NEVER hardcodes by item id or
 * title - it scores from general signals: (a) which subscribed category the
 * item triggered, (b) the profile ATTRIBUTE that gates that category, and
 * (c) keyword signal strength. The same item therefore scores differently per
 * profile (the horizontal-relevance property the product is built on).
 *
 * This same scorer is what the hermetic local LLM adapter returns for
 * JudgeResult-shaped calls, so the eval harness runs with zero secrets.
 *
 * Rubric (spec §7):
 *   5 Direct material impact   4 Clearly relevant   3 Sector-adjacent (monitor)
 *   2 Weak/indirect            1 Background noise    0 Irrelevant
 */
import {
  JudgeResultSchema,
  type BusinessProfile,
  type Category,
  type JudgeResult,
  type ProfileAttributes,
} from "@/lib/types";
import { categoryIntersect, resolveCategories, type ClassifiableItem } from "@/pipeline/classify";

/** Item shape the judge needs: a classifiable item plus its text signals. */
export interface JudgeableItem extends ClassifiableItem {
  identifier?: string | null;
  jurisdiction?: string | null;
  type?: string | null;
  full_text?: string | null;
}

/** Normalized signal text used for keyword-strength tests. */
function signalText(item: JudgeableItem): string {
  return [item.title, item.summary, item.full_text, item.agency, item.source]
    .map((s) => (s ?? "").toLowerCase())
    .join(" ")
    .replace(/\s+/g, " ");
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

/** A scored gate decision. `score < 0` means "this gate did not apply". */
interface GateResult {
  score: number;
  justification: string;
  matched_concern: string | null;
}

const NOT_APPLICABLE: GateResult = { score: -1, justification: "", matched_concern: null };

/**
 * Per-category gates. Each gate inspects the profile attributes + business types
 * + keyword strength and returns a score for items that fall in that category.
 * A gate returns NOT_APPLICABLE when its specific signal isn't present, letting
 * the caller fall through to a generic in-category score.
 */

// ── goods/hardware: customs / import (de minimis / Section 321 / tariff) ─────
function gateCustomsImport(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isCustoms = hasAny(text, [
    "de minimis",
    "section 321",
    "tariff",
    "customs entry",
    "import duties",
    "import duty",
    "duty-free",
    "duty free",
  ]);
  if (!isCustoms) return NOT_APPLICABLE;

  const a = profile.attributes;
  const types = profile.business_types;
  const sellsGoods = types.includes("goods") || types.includes("hardware");
  // Direct exposure = a goods/hardware *business* that imports for resale. We do NOT
  // treat a bare sells_physical_goods flag as direct, so a food maker that imports
  // ingredients/packaging (and sells its packaged product) lands in the indirect
  // branch (score 2) per spec §11 C, not the direct branch.
  const directExposure = a.imports_goods === true && sellsGoods;

  // Direct: a goods/hardware seller that imports → new duties + customs entry on core ops.
  if (directExposure) {
    return {
      score: 5,
      justification:
        "Suspension of the de minimis / Section 321 duty-free treatment imposes duties and full customs entry on the imported goods this business sells.",
      matched_concern: "imports_goods + sells_physical_goods",
    };
  }
  // Indirect: imports inputs (e.g. a food maker importing ingredients/packaging) but
  // not a goods reseller → cost pressure via supply chain, not core product line.
  if (a.imports_goods === true) {
    return {
      score: 2,
      justification:
        "The business imports inputs (ingredients/packaging), so import-duty changes raise supplier costs indirectly rather than hitting its core product line.",
      matched_concern: "imports_goods (inputs only)",
    };
  }
  // No import exposure at all (e.g. SaaS) → shares keywords, different context.
  return {
    score: 1,
    justification: "Import-duty changes share customs keywords but the business neither imports nor sells physical goods.",
    matched_concern: null,
  };
}

// ── software: negative option / auto-renewal / click-to-cancel ───────────────
function gateNegativeOption(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isNegOption = hasAny(text, [
    "negative option",
    "auto-renewal",
    "automatic renewal",
    "click-to-cancel",
    "click to cancel",
    "rosca",
    "subscription cancellation",
    "recurring subscription",
  ]);
  if (!isNegOption) return NOT_APPLICABLE;

  const a = profile.attributes;
  const isSoftware = profile.business_types.includes("software");

  if (a.sells_subscription === true && isSoftware) {
    return {
      score: 5,
      justification:
        "Auto-renewal / click-to-cancel rules directly govern how this SaaS business enrolls and cancels its recurring subscriptions.",
      matched_concern: "sells_subscription + software",
    };
  }
  // A goods seller that does not sell subscriptions → weak/indirect (becomes
  // relevant only if it adds subscriptions; spec §11 B).
  if (profile.business_types.includes("goods") || profile.business_types.includes("hardware")) {
    return {
      score: 2,
      justification:
        "Subscription-cancellation rules would only bind this seller if it added a subscription offering; today it sells one-time goods.",
      matched_concern: null,
    };
  }
  // Unrelated business types (food / pure operator) → background noise.
  return {
    score: 1,
    justification: "Subscription-cancellation rules do not reach this business, which sells no subscriptions.",
    matched_concern: null,
  };
}

// ── licensing_registration: beneficial ownership / entity registration ───────
function gateBeneficialOwnership(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isBoi = hasAny(text, [
    "beneficial ownership",
    "corporate transparency act",
    "reporting company",
    "boi report",
  ]);
  if (!isBoi) return NOT_APPLICABLE;

  // Universal base item: every incorporated business is a potential reporting
  // company. Currently a monitor-level obligation (interim rule narrowed scope,
  // final rule pending; spec §11 A) → score 3.
  return {
    score: 3,
    justification:
      "Beneficial-ownership reporting under the Corporate Transparency Act applies to incorporated entities generally; scope is narrowed pending a final rule, so monitor.",
    matched_concern: "incorporated entity (licensing_registration)",
  };
}

// ── food: FSMA traceability ─────────────────────────────────────────────────
function gateFoodTraceability(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isFsma = hasAny(text, [
    "fsma",
    "food safety modernization",
    "food traceability",
    "traceability rule",
    "section 204",
    "food traceability list",
    "preventive controls",
  ]);
  if (!isFsma) return NOT_APPLICABLE;

  const a = profile.attributes;
  const servesFood = a.serves_food === true || profile.business_types.includes("food");
  const inScopeRole = a.food_supply_chain_role === "make_pack_hold" || a.food_supply_chain_role === "distribute";

  // In FSMA scope: manufacture/process/pack/hold or distribute listed foods.
  if (servesFood && inScopeRole) {
    return {
      score: 5,
      justification:
        "FSMA 204 traceability recordkeeping applies directly to businesses that make, pack, hold, or distribute listed foods.",
      matched_concern: "serves_food + food_supply_chain_role",
    };
  }
  // Serves food but only serves (dine-in) → largely exempt (spec §11 D nuance).
  if (servesFood && a.food_supply_chain_role === "serve_only") {
    return {
      score: 1,
      justification:
        "A serve-only food operation is largely exempt from FSMA 204 traceability recordkeeping; supply-chain role, not serving food, decides scope.",
      matched_concern: null,
    };
  }
  // A food business whose supply-chain role is unset, or a non-food business: this
  // gate can't decide. Return NOT_APPLICABLE so we fall through - an under-specified
  // food business still gets a generic in-category monitor score (no recall hole),
  // and a non-food business is scored by whatever other category it shares.
  return NOT_APPLICABLE;
}

// ── classification_scheduling: independent contractor ────────────────────────
function gateIndependentContractor(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isContractor = hasAny(text, [
    "independent contractor",
    "worker classification",
    "misclassification",
    "employee classification",
  ]);
  if (!isContractor) return NOT_APPLICABLE;

  if (profile.attributes.has_1099_contractors === true) {
    return {
      score: 4,
      justification:
        "A change to independent-contractor classification standards would likely require this business to reassess its 1099 contractor relationships.",
      matched_concern: "has_1099_contractors",
    };
  }
  return {
    score: 2,
    justification: "Worker-classification rules have limited reach for a business with no 1099 contractors.",
    matched_concern: null,
  };
}

// ── data_privacy: COPPA / children under 13 ──────────────────────────────────
function gateCoppa(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isCoppa = hasAny(text, ["coppa", "children's online privacy", "children under 13", "child's personal information"]);
  if (!isCoppa) return NOT_APPLICABLE;

  if (profile.attributes.data_from_children_under_13 === true) {
    return {
      score: 4,
      justification:
        "COPPA amendments govern collection of personal data from children under 13, which this business does online.",
      matched_concern: "data_from_children_under_13",
    };
  }
  return {
    score: 1,
    justification: "COPPA governs data from children under 13, which this business does not collect.",
    matched_concern: null,
  };
}

// ── goods: marketplace / INFORM Act ──────────────────────────────────────────
function gateMarketplace(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isInform = hasAny(text, ["inform consumers act", "marketplace seller", "online marketplace", "high-volume third-party seller"]);
  if (!isInform) return NOT_APPLICABLE;

  if (profile.attributes.sells_via_marketplace === true) {
    return {
      score: 4,
      justification:
        "INFORM Consumers Act verification duties apply to high-volume sellers on third-party marketplaces, which this business uses.",
      matched_concern: "sells_via_marketplace",
    };
  }
  return {
    score: 1,
    justification: "Marketplace-seller verification rules do not bind a business that does not sell via third-party marketplaces.",
    matched_concern: null,
  };
}

// ── hardware: FCC equipment authorization ────────────────────────────────────
function gateFccEquipment(item: JudgeableItem, profile: BusinessProfile, text: string): GateResult {
  const isFcc = hasAny(text, ["equipment authorization", "covered list", "rf device", "radiofrequency", "supply chain order"]);
  if (!isFcc) return NOT_APPLICABLE;

  if (profile.business_types.includes("hardware")) {
    return {
      score: 4,
      justification:
        "FCC equipment-authorization requirements apply to the radiofrequency devices this hardware business builds and sells.",
      matched_concern: "hardware",
    };
  }
  return {
    score: 1,
    justification: "FCC equipment-authorization rules do not reach a business that builds no RF hardware.",
    matched_concern: null,
  };
}

/**
 * Generic in-category fallback when no specific gate fires but the item still
 * shares a category with the profile. Scores by directness of category match:
 * a module category the business explicitly is (e.g. a goods rule for a goods
 * seller) is more relevant than a shared base category.
 */
function genericInCategoryScore(
  shared: Category[],
  profile: BusinessProfile,
): GateResult {
  const isModuleMatch = shared.some((c) => (profile.business_types as readonly string[]).includes(c));
  if (isModuleMatch) {
    return {
      score: 3,
      justification: `The item touches the business's ${shared.join(", ")} activity; monitor for obligations.`,
      matched_concern: shared[0] ?? null,
    };
  }
  // Shared base category (employer/operator layer) → sector-adjacent monitor.
  return {
    score: 2,
    justification: `The item touches a shared regulatory area (${shared.join(", ")}) but does not name an obligation on this business's core operations.`,
    matched_concern: null,
  };
}

/** Ordered gate list. First gate that applies (score >= 0) wins. */
const GATES: ReadonlyArray<(i: JudgeableItem, p: BusinessProfile, t: string) => GateResult> = [
  gateCustomsImport,
  gateNegativeOption,
  gateFoodTraceability,
  gateBeneficialOwnership,
  gateIndependentContractor,
  gateCoppa,
  gateMarketplace,
  gateFccEquipment,
];

/**
 * Score how much one item threatens/affects one business (spec §7 rubric).
 * Deterministic and general - no item-id/title special-casing.
 */
export function heuristicJudge(profile: BusinessProfile, item: JudgeableItem): JudgeResult {
  const itemCats = resolveCategories(item);
  const shared = categoryIntersect(itemCats, profile.subscribed_categories);

  // Stage-0 reject: no shared category ⇒ irrelevant (decoys land here for all
  // profiles - FMCSA hours-of-service, Medicare reimbursement, bank capital).
  if (shared.length === 0) {
    return validate({
      score: 0,
      justification: "No overlap between the item's regulatory categories and the business's subscribed categories.",
      matched_concern: null,
    });
  }

  const text = signalText(item);

  // Try specific per-category gates first.
  let best: GateResult | null = null;
  for (const gate of GATES) {
    const r = gate(item, profile, text);
    if (r.score >= 0) {
      if (best === null || r.score > best.score) best = r;
    }
  }

  if (best !== null) {
    return validate({ score: best.score, justification: best.justification, matched_concern: best.matched_concern });
  }

  // No specific gate fired but a category overlaps → generic in-category score.
  const generic = genericInCategoryScore(shared, profile);
  return validate({ score: generic.score, justification: generic.justification, matched_concern: generic.matched_concern });
}

/** Validate the result against the shared schema before returning. */
function validate(r: JudgeResult): JudgeResult {
  return JudgeResultSchema.parse(r);
}

/** Re-export the attribute type for adapters that reconstruct profiles. */
export type { ProfileAttributes };
