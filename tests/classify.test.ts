/**
 * Unit tests for Stage 0 classification (spec §7, §9).
 *
 * Asserts classifyItem tags the anchor + expansion items with the right
 * categories from general agency/keyword rules, that decoys tag to NOTHING
 * (the silent-recall + precision audit), and that the category-intersection
 * helper and business-type → subscribed-category mapping behave per spec.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyItem, categoryIntersect, type ClassifiableItem } from "@/pipeline/classify";
import { businessTypesToSubscribedCategories, BASE_CATEGORIES } from "@/lib/taxonomy";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "..", "evals", "fixtures");

function loadFixtureUntagged(id: string): ClassifiableItem {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${id}.json`), "utf8"));
  // Strip the pre-tagged categories so we test the RULES, not the fixture label.
  const { categories: _drop, ...rest } = raw as Record<string, unknown>;
  return rest as unknown as ClassifiableItem;
}

describe("classifyItem — anchors tag to the right categories", () => {
  it("A beneficial-ownership → licensing_registration (FinCEN/CTA)", () => {
    expect(classifyItem(loadFixtureUntagged("A-beneficial-ownership"))).toContain("licensing_registration");
  });

  it("B click-to-cancel → software (FTC negative option)", () => {
    const cats = classifyItem(loadFixtureUntagged("B-ftc-click-to-cancel"));
    expect(cats).toContain("software");
  });

  it("C import de minimis → goods AND hardware (CBP / Section 321)", () => {
    const cats = classifyItem(loadFixtureUntagged("C-import-de-minimis"));
    expect(cats).toContain("goods");
    expect(cats).toContain("hardware");
  });

  it("D FSMA 204 → food (FDA)", () => {
    expect(classifyItem(loadFixtureUntagged("D-fda-fsma-204"))).toContain("food");
  });
});

describe("classifyItem — expansion items", () => {
  it("E COPPA → data_privacy AND software", () => {
    const cats = classifyItem(loadFixtureUntagged("E-ftc-coppa"));
    expect(cats).toContain("data_privacy");
    expect(cats).toContain("software");
  });
  it("F INFORM Act → goods", () => {
    expect(classifyItem(loadFixtureUntagged("F-inform-act"))).toContain("goods");
  });
  it("G DOL independent contractor → classification_scheduling", () => {
    expect(classifyItem(loadFixtureUntagged("G-dol-independent-contractor"))).toContain("classification_scheduling");
  });
  it("H FCC equipment authorization → hardware", () => {
    expect(classifyItem(loadFixtureUntagged("H-fcc-equipment-authorization"))).toContain("hardware");
  });
});

describe("classifyItem — decoys tag to nothing (precision audit)", () => {
  for (const id of ["I-fmcsa-hours-of-service", "J-medicare-reimbursement", "K-bank-capital"]) {
    it(`${id} → []`, () => {
      expect(classifyItem(loadFixtureUntagged(id))).toEqual([]);
    });
  }
});

describe("categoryIntersect", () => {
  it("returns only the shared, valid categories", () => {
    expect(categoryIntersect(["goods", "hardware"], ["food", "goods"]).sort()).toEqual(["goods"]);
  });
  it("returns empty when there is no overlap", () => {
    expect(categoryIntersect(["food"], ["software", "goods"])).toEqual([]);
  });
  it("ignores non-taxonomy strings", () => {
    expect(categoryIntersect(["not_a_category", "software"], ["software"])).toEqual(["software"]);
  });
});

describe("businessTypesToSubscribedCategories", () => {
  it("software profile = base + software", () => {
    const cats = businessTypesToSubscribedCategories(["software"]);
    for (const b of BASE_CATEGORIES) expect(cats).toContain(b);
    expect(cats).toContain("software");
    expect(cats).not.toContain("goods");
    expect(cats).not.toContain("food");
  });

  it("hardware implies goods (spec §9: hardware is a superset of goods)", () => {
    const cats = businessTypesToSubscribedCategories(["hardware"]);
    expect(cats).toContain("hardware");
    expect(cats).toContain("goods");
  });

  it("multi-type profile unions the modules", () => {
    const cats = businessTypesToSubscribedCategories(["software", "food"]);
    expect(cats).toContain("software");
    expect(cats).toContain("food");
    expect(new Set(cats).size).toBe(cats.length); // de-duplicated
  });
});
