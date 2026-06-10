import { describe, it, expect } from "vitest";
import { buildProfile, generateConcernText, deriveSubscribedCategories } from "@/pipeline/onboarding";
import { getEmbedder } from "@/lib/embedder";
import { BASE_CATEGORIES } from "@/lib/types";

describe("onboarding → profile (spec §10)", () => {
  it("derives subscribed_categories = base ∪ modules", () => {
    const cats = deriveSubscribedCategories(["software"]);
    for (const base of BASE_CATEGORIES) expect(cats).toContain(base);
    expect(cats).toContain("software");
    expect(cats).not.toContain("food");
  });

  it("encodes positives AND negatives in concern_text (so the judge can reject)", () => {
    const text = generateConcernText({
      jurisdictions: ["us", "us-ca"],
      business_types: ["software"],
      attributes: {
        employees: 12,
        has_w2: true,
        has_1099_contractors: true,
        sells_subscription: true,
        imports_goods: false,
        sells_physical_goods: false,
        serves_food: false,
        collects_customer_data_online: true,
        data_from_children_under_13: false,
      },
    });
    expect(text.toLowerCase()).toContain("subscription");
    expect(text).toMatch(/does not/i);
    expect(text.toLowerCase()).toContain("import"); // appears in the NOT clause
    expect(text.toLowerCase()).toContain("food");
  });

  it("builds a full profile with an embedding when an embedder is supplied", async () => {
    const embedder = getEmbedder();
    const profile = await buildProfile(
      {
        jurisdictions: ["us", "us-ca"],
        business_types: ["goods"],
        attributes: { imports_goods: true, sells_physical_goods: true, sells_via_marketplace: true },
      },
      { embedder, id: "p1", org_id: "o1" },
    );
    expect(profile.business_types).toEqual(["goods"]);
    expect(profile.subscribed_categories).toContain("goods");
    expect(profile.embedding).toHaveLength(embedder.dim);
    expect(profile.concern_text.length).toBeGreaterThan(20);
  });
});
