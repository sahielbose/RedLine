/**
 * Onboarding → business profile (spec §10). Onboarding IS part of the engine:
 * structured answers → business_types + jurisdictions + subscribed_categories +
 * a generated concern_text (encoding positives AND negatives, so the judge
 * REJECTS off-target rules) + an embedding for Stage A.
 */
import type { Embedder } from "@/lib/interfaces";
import { businessTypesToSubscribedCategories } from "@/lib/taxonomy";
import type { BusinessProfile, BusinessType, Category, ProfileAttributes } from "@/lib/types";

export interface OnboardingAnswers {
  jurisdictions: string[]; // ['us','us-ca',...]
  business_types: BusinessType[]; // software | goods | food | hardware (toggles)
  attributes: ProfileAttributes;
  /** Free-text "what's proprietary about us" — policy positions, focus areas,
   *  what would help/hurt/blindside us. Folded into concern_text so it directly
   *  steers Stage A (embedding) + Stage B (judge). The user's own words. */
  context?: string;
}

/** Cap the free-text context so it can't blow the prompt; the user's own words. */
const MAX_CONTEXT = 600;

/** Human-readable list join: ["a","b","c"] → "a, b, and c". */
function list(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Generate the concern_text: a compact description encoding what the business
 * IS (positives → relevance) and IS NOT (negatives → rejections). Built only
 * from the structured answers — no fabrication.
 */
export function generateConcernText(answers: OnboardingAnswers): string {
  const a = answers.attributes;
  const types = answers.business_types;
  const where = answers.jurisdictions.includes("us") ? "the US" : answers.jurisdictions.join(", ");

  const kind = types.length ? `${list(types)} business` : "small business / employer";
  const positives: string[] = [];
  const negatives: string[] = [];

  if (typeof a.employees === "number") positives.push(`${a.employees} employees`);
  if (a.has_w2) positives.push("W-2 staff");
  if (a.has_1099_contractors) positives.push("1099 contractors");
  if (a.sells_subscription) positives.push("sells auto-renewing subscriptions");
  if (a.sells_physical_goods) positives.push("sells physical goods");
  if (a.imports_goods) positives.push("imports goods or inputs");
  if (a.sells_via_marketplace) positives.push("sells via third-party marketplaces");
  if (a.serves_food) {
    const role = a.food_supply_chain_role;
    positives.push(role ? `handles food (${role.replace(/_/g, " ")})` : "handles food");
  }
  if (a.collects_customer_data_online) positives.push("collects customer data online");
  if (a.data_from_children_under_13) positives.push("collects data from children under 13");

  if (a.sells_subscription === false) negatives.push("sell subscriptions");
  if (a.imports_goods === false) negatives.push("import");
  if (a.sells_physical_goods === false) negatives.push("sell physical goods");
  if (a.serves_food === false) negatives.push("handle food");
  if (a.data_from_children_under_13 === false) negatives.push("collect data from children");

  const head = `${capitalize(kind)} operating in ${where}`;
  const pos = positives.length ? `. It ${list(positives)}.` : ".";
  const exposure =
    " Affected by changes to wages/overtime, worker classification, leave/benefits, licensing, taxes, data privacy, workplace safety, and accessibility" +
    moduleExposure(types) +
    ".";
  const neg = negatives.length ? ` Does NOT ${list(negatives)}.` : "";

  const ctx = (answers.context ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT);
  const own = ctx ? ` In their own words: ${ctx}` : "";

  return `${head}${pos}${exposure}${neg}${own}`.replace(/\s+/g, " ").trim();
}

function moduleExposure(types: BusinessType[]): string {
  const bits: string[] = [];
  if (types.includes("software")) bits.push("subscription/auto-renewal and consumer-privacy rules");
  if (types.includes("goods")) bits.push("sales-tax nexus, import duties, and marketplace-seller rules");
  if (types.includes("food")) bits.push("food-safety/traceability, labeling, and health-permit rules");
  if (types.includes("hardware")) bits.push("product-safety, equipment-authorization, and e-waste rules");
  return bits.length ? `, plus ${list(bits)}` : "";
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Derive subscribed_categories = base ∪ modules from the toggled business types. */
export function deriveSubscribedCategories(types: BusinessType[]): Category[] {
  return businessTypesToSubscribedCategories(types);
}

export interface BuildProfileOpts {
  id?: string;
  org_id?: string;
  embedder?: Embedder;
}

/**
 * Build a BusinessProfile from onboarding answers. If an embedder is supplied,
 * the concern_text is embedded for Stage A; otherwise embedding is null (set
 * later). ids default to placeholders the caller can override.
 */
export async function buildProfile(
  answers: OnboardingAnswers,
  opts: BuildProfileOpts = {},
): Promise<BusinessProfile> {
  const concern_text = generateConcernText(answers);
  const subscribed_categories = deriveSubscribedCategories(answers.business_types);
  const embedding = opts.embedder ? (await opts.embedder.embed([concern_text]))[0] : null;

  return {
    id: opts.id ?? "profile-draft",
    org_id: opts.org_id ?? "org-draft",
    business_types: answers.business_types,
    jurisdictions: answers.jurisdictions,
    attributes: answers.attributes,
    subscribed_categories,
    concern_text,
    embedding,
    is_active: true,
  };
}
