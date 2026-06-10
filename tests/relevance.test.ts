/**
 * Unit tests for the relevance engine (spec §7, §11).
 *
 * Asserts heuristicJudge produces the expected severity bands for the four
 * ANCHOR items × four profiles — and crucially that the SAME item scores
 * differently per profile (the horizontal-relevance property). Profiles +
 * fixtures are loaded from the golden eval set so the tests and the eval matrix
 * stay in lockstep.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { heuristicJudge, type JudgeableItem } from "@/pipeline/relevance";
import { JudgeResultSchema, severityLabel, type BusinessProfile, type SeverityLabel } from "@/lib/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROFILES = path.join(ROOT, "evals", "profiles");
const FIXTURES = path.join(ROOT, "evals", "fixtures");

function loadProfile(key: string): BusinessProfile {
  return JSON.parse(fs.readFileSync(path.join(PROFILES, `${key}.json`), "utf8")) as BusinessProfile;
}
function loadFixture(id: string): JudgeableItem {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${id}.json`), "utf8")) as JudgeableItem;
}

const PROFILE_KEYS = ["saas-remote", "ecom-goods", "food-cpg", "hardware-maker"] as const;
const profiles = Object.fromEntries(PROFILE_KEYS.map((k) => [k, loadProfile(k)])) as Record<
  (typeof PROFILE_KEYS)[number],
  BusinessProfile
>;

/** flag = score >= 3 (evals/thresholds.json). */
function flagged(score: number): boolean {
  return score >= 3;
}

describe("heuristicJudge — anchor matrix (spec §11)", () => {
  // Each entry: [fixtureId, expected per-profile {flag, band-or-bands}]
  const cases: Array<{
    id: string;
    expect: Record<(typeof PROFILE_KEYS)[number], { flag: boolean; bands: SeverityLabel[] }>;
  }> = [
    {
      id: "A-beneficial-ownership",
      expect: {
        "saas-remote": { flag: true, bands: ["Monitor", "High"] },
        "ecom-goods": { flag: true, bands: ["Monitor", "High"] },
        "food-cpg": { flag: true, bands: ["Monitor", "High"] },
        "hardware-maker": { flag: true, bands: ["Monitor", "High"] },
      },
    },
    {
      id: "B-ftc-click-to-cancel",
      expect: {
        "saas-remote": { flag: true, bands: ["Critical"] },
        "ecom-goods": { flag: false, bands: ["Low"] },
        "food-cpg": { flag: false, bands: ["Low"] },
        "hardware-maker": { flag: false, bands: ["Low"] },
      },
    },
    {
      id: "C-import-de-minimis",
      expect: {
        "saas-remote": { flag: false, bands: ["Low"] },
        "ecom-goods": { flag: true, bands: ["Critical"] },
        "food-cpg": { flag: false, bands: ["Low"] },
        "hardware-maker": { flag: true, bands: ["Critical"] },
      },
    },
    {
      id: "D-fda-fsma-204",
      expect: {
        "saas-remote": { flag: false, bands: ["Low"] },
        "ecom-goods": { flag: false, bands: ["Low"] },
        "food-cpg": { flag: true, bands: ["Critical", "High"] },
        "hardware-maker": { flag: false, bands: ["Low"] },
      },
    },
  ];

  for (const c of cases) {
    const item = loadFixture(c.id);
    describe(c.id, () => {
      for (const pk of PROFILE_KEYS) {
        it(`scores ${pk} as expected`, () => {
          const result = heuristicJudge(profiles[pk], item);
          // Always schema-valid.
          expect(() => JudgeResultSchema.parse(result)).not.toThrow();
          const exp = c.expect[pk];
          expect(flagged(result.score), `score=${result.score} just="${result.justification}"`).toBe(exp.flag);
          expect(exp.bands).toContain(severityLabel(result.score));
        });
      }
    });
  }
});

describe("heuristicJudge — horizontal relevance (same item, different profiles)", () => {
  it("the import de minimis item flags goods + hardware and rejects saas + food", () => {
    const item = loadFixture("C-import-de-minimis");
    expect(heuristicJudge(profiles["ecom-goods"], item).score).toBeGreaterThanOrEqual(4);
    expect(heuristicJudge(profiles["hardware-maker"], item).score).toBeGreaterThanOrEqual(4);
    expect(heuristicJudge(profiles["saas-remote"], item).score).toBeLessThan(3);
    expect(heuristicJudge(profiles["food-cpg"], item).score).toBeLessThan(3);
  });

  it("returns score 0 + null matched_concern when no category overlaps (decoys)", () => {
    const decoy = loadFixture("I-fmcsa-hours-of-service");
    for (const pk of PROFILE_KEYS) {
      const r = heuristicJudge(profiles[pk], decoy);
      expect(r.score).toBe(0);
      expect(r.matched_concern).toBeNull();
    }
  });
});

describe("heuristicJudge — attribute gating (general, not item-id based)", () => {
  it("FSMA scope depends on supply-chain role, not just serving food (spec §11 D)", () => {
    const item = loadFixture("D-fda-fsma-204");
    const food = profiles["food-cpg"];
    expect(heuristicJudge(food, item).score).toBeGreaterThanOrEqual(4);

    // A serve-only food operation is largely exempt → not flagged.
    const serveOnly: BusinessProfile = {
      ...food,
      attributes: { ...food.attributes, food_supply_chain_role: "serve_only" },
    };
    expect(heuristicJudge(serveOnly, item).score).toBeLessThan(3);
  });

  it("independent-contractor rule flags only when has_1099_contractors is true", () => {
    const item = loadFixture("G-dol-independent-contractor");
    const saas = profiles["saas-remote"]; // has 1099 contractors
    expect(heuristicJudge(saas, item).score).toBeGreaterThanOrEqual(4);

    const noContractors: BusinessProfile = {
      ...saas,
      attributes: { ...saas.attributes, has_1099_contractors: false },
    };
    expect(heuristicJudge(noContractors, item).score).toBeLessThan(3);
  });

  it("negative-option rule flags only a subscription-selling software business", () => {
    const item = loadFixture("B-ftc-click-to-cancel");
    const saas = profiles["saas-remote"];
    expect(heuristicJudge(saas, item).score).toBe(5);

    const noSub: BusinessProfile = {
      ...saas,
      attributes: { ...saas.attributes, sells_subscription: false },
    };
    // Still software, but no subscription → not a direct hit.
    expect(heuristicJudge(noSub, item).score).toBeLessThan(3);
  });
});
