/**
 * The "Add your business" form → engine OnboardingAnswers mapping (the pure
 * core of POST /api/profiles). Verifies the form's plain-English toggles land
 * on the typed attributes the relevance gates key on — including the FSMA
 * make/pack/hold nuance — and that the resulting profile re-scores correctly
 * through the real pipeline.
 */
import { describe, it, expect } from "vitest";
import { AddBusinessSchema, formMeta, toOnboardingAnswers } from "@/app/lib/onboardingMap";
import { buildProfile } from "@/pipeline/onboarding";
import { getEmbedder } from "@/lib/embedder";
import { computeBoardForProfile } from "@/app/lib/board";

describe("toOnboardingAnswers", () => {
  it("maps types, states, and attribute toggles onto the engine fields", () => {
    const form = AddBusinessSchema.parse({
      name: "Driftwood Coffee Co.",
      types: ["food", "goods"],
      states: ["US", "CA", "TX"],
      employees: 25,
      foodRole: "make_pack_hold",
      attrs: { serves_food: true, imports: true },
    });
    const a = toOnboardingAnswers(form);
    expect(a.jurisdictions).toEqual(["us", "us-ca", "us-tx"]);
    expect(a.business_types).toEqual(["food", "goods"]);
    expect(a.attributes.serves_food).toBe(true);
    expect(a.attributes.food_supply_chain_role).toBe("make_pack_hold"); // FSMA in scope
    expect(a.attributes.imports_goods).toBe(true);
    expect(a.attributes.sells_physical_goods).toBe(true);
    expect(a.attributes.sells_subscription).toBe(false);
    expect(a.attributes.employees).toBe(25);
    expect(formMeta(form)).toBe("Food · Goods · CA, TX · 25 staff");
  });

  it("leaves the FSMA role unset for a food business that does not make/pack/hold", () => {
    const form = AddBusinessSchema.parse({ name: "Corner Diner", types: ["food"], states: ["US"], attrs: {} });
    const a = toOnboardingAnswers(form);
    expect(a.attributes.serves_food).toBe(true);
    expect(a.attributes.food_supply_chain_role).toBeNull();
  });

  it("a created importer profile re-scores the board through the REAL engine", async () => {
    const form = AddBusinessSchema.parse({
      name: "Test Imports LLC",
      types: ["goods"],
      states: ["US", "TX"],
      attrs: { imports: true },
    });
    const profile = await buildProfile(toOnboardingAnswers(form), {
      id: "custom-test",
      org_id: "org-custom-test",
      embedder: getEmbedder(),
    });
    const board = await computeBoardForProfile({ ...profile, label: form.name });

    // The headline property holds for a user-created importer: de minimis is Critical.
    const deMin = board.surfaced.find((s) => s.id === "fr-de-minimis");
    expect(deMin?.severity).toBe("Critical");
    expect(deMin?.memo).not.toBeNull();
    // And a subscription rule is NOT a top threat for a non-subscription importer.
    const ctc = board.surfaced.find((s) => s.id === "fr-click-to-cancel");
    expect((ctc?.score ?? 0) < 3).toBe(true);
  });
});
