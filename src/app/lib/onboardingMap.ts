/**
 * Maps the "Add your business" form (the two-minute onboarding modal) to the
 * engine's OnboardingAnswers (spec §10). Pure - used by /api/profiles and
 * unit-tested directly. The mapping is where the form's plain-English toggles
 * become the typed attributes the relevance gates key on.
 */
import { z } from "zod";
import type { OnboardingAnswers } from "@/pipeline/onboarding";
import type { BusinessType } from "@/lib/types";

export const AddBusinessSchema = z.object({
  name: z.string().trim().min(1).max(80),
  types: z.array(z.enum(["software", "goods", "food", "hardware"])).min(1).max(4),
  /** Postal codes, uppercase ("CA"), plus the literal "US" for nationwide. */
  states: z.array(z.string().regex(/^(US|[A-Z]{2})$/)).max(12).default(["US"]),
  attrs: z
    .object({
      subscription: z.boolean().optional(),
      imports: z.boolean().optional(),
      foodMaker: z.boolean().optional(),
      contractors: z.boolean().optional(),
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
  const sellsPhysical = types.includes("goods") || types.includes("hardware") || types.includes("food");

  return {
    jurisdictions: ["us", ...stateCodes],
    business_types: types,
    attributes: {
      sells_subscription: Boolean(form.attrs.subscription),
      imports_goods: Boolean(form.attrs.imports),
      sells_physical_goods: sellsPhysical,
      has_1099_contractors: Boolean(form.attrs.contractors),
      serves_food: Boolean(form.attrs.foodMaker) || types.includes("food"),
      // The FSMA precision nuance (spec §11 D): only a maker/packer/holder is in
      // scope. The form's "makes, packs, or holds food" toggle decides; a food
      // business without it stays unset (engine falls through to monitor-level).
      food_supply_chain_role: form.attrs.foodMaker ? "make_pack_hold" : null,
      collects_customer_data_online: types.includes("software"),
    },
  };
}

/** One-line descriptor for the switcher ("Software · Goods · CA, TX"). */
export function formMeta(form: AddBusinessForm): string {
  const t = form.types.map((x) => TYPE_LABEL[x as BusinessType]).join(" · ");
  const st = form.states.filter((s) => s !== "US");
  return st.length ? `${t} · ${st.join(", ")}` : `${t} · nationwide`;
}
