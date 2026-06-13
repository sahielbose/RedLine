/**
 * Maps the "Add your business" form (the onboarding modal) to the engine's
 * OnboardingAnswers (spec §10). Pure - used by /api/profiles and unit-tested
 * directly. The mapping is where the form's plain-English toggles become the
 * typed attributes the relevance gates key on. Every field here drives real
 * scoring: positives raise relevance, the explicit "no" answers become the
 * negatives that make the judge REJECT off-target rules.
 */
import { z } from "zod";
import type { OnboardingAnswers } from "@/pipeline/onboarding";
import type { BusinessType } from "@/lib/types";

export const AddBusinessSchema = z.object({
  name: z.string().trim().min(1).max(80),
  types: z.array(z.enum(["software", "goods", "food", "hardware"])).min(1).max(4),
  /** Postal codes, uppercase ("CA"), plus the literal "US" for nationwide. */
  states: z.array(z.string().regex(/^(US|[A-Z]{2})$/)).max(60).default(["US"]),
  /** Headcount (shapes the profile vector; the natural threshold input). */
  employees: z.coerce.number().int().min(0).max(2_000_000).optional(),
  /** FSMA precision lever (spec §11 D): only set when the business handles food. */
  foodRole: z.enum(["make_pack_hold", "distribute", "serve_only"]).nullable().default(null),
  /** Free-text "what's proprietary about us" — steers scoring (spec §10, Fed10
   *  "upload what's proprietary"). Folded into concern_text. */
  context: z.string().trim().max(600).optional(),
  attrs: z
    .object({
      has_w2: z.boolean().optional(),
      contractors: z.boolean().optional(), // has_1099_contractors
      sells_physical_goods: z.boolean().optional(),
      subscription: z.boolean().optional(), // sells_subscription
      marketplace: z.boolean().optional(), // sells_via_marketplace
      imports: z.boolean().optional(), // imports_goods
      serves_food: z.boolean().optional(),
      online_data: z.boolean().optional(), // collects_customer_data_online
      children_data: z.boolean().optional(), // data_from_children_under_13
    })
    .default({}),
});
export type AddBusinessForm = z.infer<typeof AddBusinessSchema>;

const TYPE_LABEL: Record<BusinessType, string> = {
  software: "Software",
  goods: "Goods",
  food: "Food",
  hardware: "Hardware",
};

/** Form → the engine's OnboardingAnswers. Federal ("us") is always included -
 *  federal rules apply wherever you operate. */
export function toOnboardingAnswers(form: AddBusinessForm): OnboardingAnswers {
  const types = form.types as BusinessType[];
  const stateCodes = form.states.filter((s) => s !== "US").map((s) => `us-${s.toLowerCase()}`);
  const a = form.attrs;
  // Physical goods: explicit toggle wins; else inferred from a goods-bearing type.
  const sellsPhysical =
    a.sells_physical_goods ?? (types.includes("goods") || types.includes("hardware") || types.includes("food"));
  const servesFood = Boolean(a.serves_food) || types.includes("food");

  return {
    jurisdictions: ["us", ...stateCodes],
    business_types: types,
    context: form.context,
    attributes: {
      employees: form.employees,
      has_w2: Boolean(a.has_w2),
      has_1099_contractors: Boolean(a.contractors),
      sells_physical_goods: sellsPhysical,
      sells_subscription: Boolean(a.subscription),
      sells_via_marketplace: Boolean(a.marketplace),
      imports_goods: Boolean(a.imports),
      serves_food: servesFood,
      // FSMA nuance (spec §11 D): make_pack_hold/distribute are in scope; serve_only
      // is largely exempt. Only meaningful when the business handles food.
      food_supply_chain_role: servesFood ? form.foodRole ?? null : null,
      // Software collects data by default; an explicit toggle lets any business set it.
      collects_customer_data_online: Boolean(a.online_data) || types.includes("software"),
      data_from_children_under_13: Boolean(a.children_data),
    },
  };
}

/** One-line descriptor for the switcher ("Goods · CA, TX · 25 staff"). */
export function formMeta(form: AddBusinessForm): string {
  const t = form.types.map((x) => TYPE_LABEL[x as BusinessType]).join(" · ");
  const st = form.states.filter((s) => s !== "US");
  const place = st.length ? (st.length > 3 ? `${st.slice(0, 3).join(", ")} +${st.length - 3}` : st.join(", ")) : "nationwide";
  const staff = typeof form.employees === "number" ? ` · ${form.employees} staff` : "";
  return `${t} · ${place}${staff}`;
}
