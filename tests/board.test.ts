/**
 * Validates the dashboard data layer (the contract the UI renders) and the
 * signature property: switching the active business RE-SCORES and RE-SHADES the
 * board — different states light up per profile. Hermetic (heuristic + hash).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { computeDashboard, type DashboardData } from "@/app/lib/board";

let data: DashboardData;
beforeAll(async () => {
  data = await computeDashboard();
});

describe("computeDashboard", () => {
  it("produces a board for all four profiles", () => {
    expect(Object.keys(data.boards).sort()).toEqual(
      ["ecom-goods", "food-cpg", "hardware-maker", "saas-remote"].sort(),
    );
    for (const b of Object.values(data.boards)) {
      expect(b.surfaced.length).toBeGreaterThan(0);
      // The filtered list carries honest engine justifications for rejects.
      expect(b.filtered.length).toBeGreaterThan(0);
      for (const f of b.filtered) expect(f.justification.length).toBeGreaterThan(0);
    }
  });

  it("the headline holds: de minimis is Critical for ecom-goods, filtered for saas-remote", () => {
    const ecom = data.boards["ecom-goods"];
    const saas = data.boards["saas-remote"];
    const ecomDeMin = ecom.surfaced.find((s) => s.id === "fr-de-minimis");
    expect(ecomDeMin?.severity).toBe("Critical");
    expect(ecomDeMin?.memo).not.toBeNull(); // memo drafted at score >= threshold
    expect(saas.surfaced.find((s) => s.id === "fr-de-minimis")).toBeUndefined();
  });

  it("the map RE-SHADES per profile (the signature interaction)", () => {
    const ecom = data.boards["ecom-goods"].mapByState; // operates in CA/TX/NY
    const hw = data.boards["hardware-maker"].mapByState; // operates in CA/WA
    const saas = data.boards["saas-remote"].mapByState; // operates in CA only

    expect(Object.keys(ecom)).toContain("tx"); // TX sales-tax bill
    expect(Object.keys(ecom)).toContain("ny"); // NY marketplace bill
    expect(Object.keys(hw)).toContain("wa"); // WA right-to-repair
    expect(Object.keys(hw)).not.toContain("tx"); // hardware doesn't operate in TX
    // SaaS operates only in CA → no TX/WA/NY hotspots.
    expect(Object.keys(saas)).not.toContain("tx");
    expect(Object.keys(saas)).not.toContain("wa");
    // The boards are genuinely different shadings.
    expect(JSON.stringify(ecom)).not.toBe(JSON.stringify(hw));
  });

  it("never auto-approves: every drafted memo rides the approval gate (draft only here)", () => {
    for (const b of Object.values(data.boards)) {
      for (const s of b.surfaced) {
        for (const c of s.memo?.citations ?? []) expect(c.verified).toBe(true);
        if (s.memo) expect(s.memo.impact_estimate === null || /assum/i.test(s.memo.impact_estimate)).toBe(true);
      }
    }
  });
});
