import { describe, it, expect } from "vitest";
import { generateMemo, sanitizeImpactEstimate } from "@/pipeline/memo";
import { getLLM } from "@/lib/llm";
import type { BusinessProfile } from "@/lib/types";
import type { JudgeableItem } from "@/pipeline/relevance";

const llm = getLLM(); // local HeuristicLLM (hermetic)

const profile: BusinessProfile = {
  id: "p1",
  org_id: "o1",
  business_types: ["goods"],
  jurisdictions: ["us"],
  attributes: { imports_goods: true, sells_physical_goods: true },
  subscribed_categories: ["goods", "taxes"],
  concern_text: "An importer of physical goods exposed to customs and import-duty changes.",
  embedding: null,
};

const item: JudgeableItem = {
  identifier: "FR-2026-001",
  jurisdiction: "us",
  type: "notice",
  source: "federal_register",
  agency: "Customs and Border Protection",
  categories: ["goods", "hardware"],
  title: "Suspension of de minimis treatment",
  summary: "Duty-free de minimis treatment is suspended for imported goods.",
  full_text:
    "This notice suspends duty-free de minimis treatment for imported goods. All shipments now require full customs entry and owe applicable duties.",
};

describe("generateMemo", () => {
  it("returns a DRAFT memo with code-verified citations and no fabricated figure", async () => {
    const memo = await generateMemo({ profile, item, llm });

    expect(memo.status).toBe("draft"); // approval gate
    expect(["comment", "monitor", "call_counsel", "no_action"]).toContain(
      memo.content.recommended_action,
    );
    // Every surviving citation must verify (substring of the source) — by CODE.
    const src = item.full_text!.replace(/\s+/g, " ").toLowerCase();
    for (const c of memo.content.citations) {
      expect(c.verified).toBe(true);
      expect(src).toContain(c.snippet.replace(/\s+/g, " ").toLowerCase());
    }
    // No bare fabricated number.
    expect(memo.content.impact_estimate).toBeNull();
  });
});

describe("sanitizeImpactEstimate (code guard, spec §15)", () => {
  it("nulls a bare unlabeled figure", () => {
    expect(sanitizeImpactEstimate("$142M at risk")).toBeNull();
    expect(sanitizeImpactEstimate("12,000")).toBeNull();
  });
  it("nulls a figure next to a soft word but with no stated assumptions (no bypass)", () => {
    expect(sanitizeImpactEstimate("Adds $500 per filing if you import")).toBeNull();
    expect(sanitizeImpactEstimate("Penalty up to $50,000 range")).toBeNull();
    expect(sanitizeImpactEstimate("three million dollars")).toBeNull(); // spelled-out magnitude
  });
  it("keeps a figure only when it states its assumptions", () => {
    expect(
      sanitizeImpactEstimate("Estimated ~$10k/yr assuming current import volume holds"),
    ).not.toBeNull();
  });
  it("passes through null and pure-qualitative text", () => {
    expect(sanitizeImpactEstimate(null)).toBeNull();
    expect(sanitizeImpactEstimate("Higher landed costs on every shipment.")).toBe(
      "Higher landed costs on every shipment.",
    );
  });
});
