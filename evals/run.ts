/**
 * RedLine eval harness (spec §8, §11) - the highest-leverage trust artifact.
 *
 * Loads the four business profiles + golden cases + fixtures, runs Stage 0
 * (classifyItem) + Stage B (judge via getLLM(), local/hermetic by default) for
 * every (item, profile) pair, and:
 *   • compares predicted flag (score >= flag_score) and severity band to expected,
 *   • computes precision / recall / F1 over flags,
 *   • prints EVERY false negative LOUDLY (the dangerous misses),
 *   • asserts THE HEADLINE explicitly (C: goods + hardware flagged Critical/High,
 *     SaaS + food NOT flagged),
 *   • prints a per-profile × item score matrix,
 *   • exits(1) below any threshold or if the headline fails; else exits(0).
 *
 * Run: `npm run eval`  (tsx evals/run.ts). No DB, no network in the default path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLLM } from "@/lib/llm";
import { judge } from "@/pipeline/judge";
import { classifyItem, resolveCategories, categoryIntersect } from "@/pipeline/classify";
import type { JudgeableItem } from "@/pipeline/relevance";
import { severityLabel, type BusinessProfile, type SeverityLabel } from "@/lib/types";

// ── Paths ────────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(HERE, "profiles");
const FIXTURES_DIR = path.join(HERE, "fixtures");
const CASES_DIR = path.join(HERE, "cases");
const THRESHOLDS_PATH = path.join(HERE, "thresholds.json");

// ── Shapes ─────────────────────────────────────────────────────────────────
interface Fixture extends JudgeableItem {
  id: string;
}
interface Expectation {
  min: number;
  max: number;
  band: SeverityLabel;
  flag: boolean;
}
interface Case {
  item: string;
  anchor?: boolean;
  headline?: boolean;
  decoy?: boolean;
  note?: string;
  expectations: Record<string, Expectation>;
}
interface Thresholds {
  precision: number;
  recall: number;
  f1: number;
  flag_score: number;
}

// ── Loaders ──────────────────────────────────────────────────────────────────
function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
function loadDir<T>(dir: string): T[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson<T>(path.join(dir, f)));
}

const PROFILE_FILES: Record<string, string> = {
  "saas-remote": "saas-remote.json",
  "ecom-goods": "ecom-goods.json",
  "food-cpg": "food-cpg.json",
  "hardware-maker": "hardware-maker.json",
};

function loadProfiles(): Record<string, BusinessProfile> {
  const out: Record<string, BusinessProfile> = {};
  for (const [key, file] of Object.entries(PROFILE_FILES)) {
    out[key] = readJson<BusinessProfile>(path.join(PROFILES_DIR, file));
  }
  return out;
}

// ── Severity-band helpers ──────────────────────────────────────────────────
/** The set of severity bands spanned by an inclusive score range [min,max]. */
function bandsInRange(min: number, max: number): Set<SeverityLabel> {
  const set = new Set<SeverityLabel>();
  for (let s = min; s <= max; s++) set.add(severityLabel(s));
  return set;
}

// ── Pretty-print helpers ─────────────────────────────────────────────────────
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function main(): Promise<void> {
  const profiles = loadProfiles();
  const profileKeys = Object.keys(PROFILE_FILES);
  const fixtures = loadDir<Fixture>(FIXTURES_DIR);
  const fixturesById = new Map(fixtures.map((f) => [f.id, f]));
  const cases = loadDir<Case>(CASES_DIR);
  const thresholds = readJson<Thresholds>(THRESHOLDS_PATH);
  const FLAG = thresholds.flag_score;

  const llm = getLLM();

  const decoyItemIds = new Set(cases.filter((c) => c.decoy).map((c) => c.item));
  const allSubscribed = [...new Set(Object.values(profiles).flatMap((p) => p.subscribed_categories))];

  console.log(BOLD("\n🟥 RedLine eval - relevance matrix\n"));
  console.log(`LLM provider: ${process.env.LLM_PROVIDER ?? "local"}  ·  flag threshold: score >= ${FLAG}\n`);

  // ── Case-integrity: the declared `band` must be consistent with [min,max] ──
  // Catches authoring typos (e.g. band:"Low" on a 5-score range) that would
  // otherwise give false assurance, since the field is documentation the harness
  // now actively cross-checks.
  const bandDeclMismatches: string[] = [];
  for (const c of cases) {
    for (const [pk, e] of Object.entries(c.expectations)) {
      if (!bandsInRange(e.min, e.max).has(e.band)) {
        bandDeclMismatches.push(
          `${c.item} × ${pk}: declared band "${e.band}" is not within range [${e.min}..${e.max}] (= {${[...bandsInRange(e.min, e.max)].join(", ")}})`,
        );
      }
    }
  }

  // ── Stage-0 tagging audit (spec §7/§15: silent-recall risk) ────────────────
  // The judge resolves categories via resolveCategories, which prefers a
  // fixture's explicit `categories`. That would let a broken keyword tagger pass
  // unnoticed. So independently run classifyItem (keyword/agency only) and assert:
  //   • non-decoy fixtures: the tagger recovers >=1 of the declared categories
  //     (else Stage 0 would drop the item before any judge sees it - a recall hole);
  //   • decoy fixtures: the tagger produces no category any profile subscribes to
  //     (else a decoy would leak into a judge).
  const taggingRecallMisses: string[] = [];
  const taggingDecoyLeaks: string[] = [];
  for (const fixture of fixtures) {
    const taggerCats = classifyItem(fixture);
    const declared = (fixture.categories ?? []).filter(Boolean);
    if (decoyItemIds.has(fixture.id)) {
      const leak = categoryIntersect(taggerCats, allSubscribed);
      if (leak.length > 0) {
        taggingDecoyLeaks.push(`${fixture.id}: keyword tagger emitted subscribed categories {${leak.join(", ")}} for a decoy`);
      }
    } else if (declared.length > 0 && categoryIntersect(taggerCats, declared).length === 0) {
      taggingRecallMisses.push(
        `${fixture.id}: keyword tagger produced {${taggerCats.join(", ") || "∅"}}, recovering none of the declared {${declared.join(", ")}} - Stage 0 would drop this item`,
      );
    }
  }

  // Confusion counts over flags (across all cases × profiles).
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  const falseNegatives: string[] = [];
  const falsePositives: string[] = [];
  const bandMismatches: string[] = [];
  const rangeMisses: string[] = [];

  // Predicted score matrix: matrix[itemId][profileKey] = score
  const matrix: Record<string, Record<string, number>> = {};

  for (const c of cases) {
    const fixture = fixturesById.get(c.item);
    if (!fixture) {
      console.error(RED(`Case references missing fixture: ${c.item}`));
      process.exit(1);
      return;
    }
    matrix[c.item] = {};

    for (const pk of profileKeys) {
      const profile = profiles[pk];
      const expect = c.expectations[pk];
      if (!expect) {
        console.error(RED(`Case ${c.item} missing expectation for profile ${pk}`));
        process.exit(1);
        return;
      }

      // Stage 0 (classify if untagged) is exercised here for audit; the judge
      // resolves categories itself, but we surface the tagging too.
      const itemForJudge: JudgeableItem = { ...fixture, categories: resolveCategories(fixture) };

      const j = await judge({ profile, item: itemForJudge, llm });
      const score = j.score;
      matrix[c.item][pk] = score;

      const predFlag = score >= FLAG;
      const expFlag = expect.flag;

      // Confusion over flags.
      if (predFlag && expFlag) tp++;
      else if (predFlag && !expFlag) {
        fp++;
        falsePositives.push(`${c.item} × ${pk}: predicted ${score} (flagged) but expected NOT flagged - "${j.justification}"`);
      } else if (!predFlag && expFlag) {
        fn++;
        falseNegatives.push(`${c.item} × ${pk}: predicted ${score} (NOT flagged) but expected FLAGGED - "${j.justification}"`);
      } else tn++;

      // Score-range check.
      if (score < expect.min || score > expect.max) {
        rangeMisses.push(
          `${c.item} × ${pk}: score ${score} outside expected [${expect.min}..${expect.max}] - "${j.justification}"`,
        );
      }

      // Band check: predicted band must be one of the bands spanned by [min,max].
      const allowedBands = bandsInRange(expect.min, expect.max);
      if (!allowedBands.has(severityLabel(score))) {
        bandMismatches.push(
          `${c.item} × ${pk}: band ${severityLabel(score)} not in expected {${[...allowedBands].join(", ")}}`,
        );
      }
    }
  }

  // ── Metrics ──────────────────────────────────────────────────────────────
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // ── Score matrix ───────────────────────────────────────────────────────────
  console.log(BOLD("Score matrix (rows = items, cols = profiles):\n"));
  const colW = 15;
  const header = "item".padEnd(30) + profileKeys.map((k) => k.padStart(colW)).join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const c of cases) {
    const tag = c.headline ? "★" : c.anchor ? "•" : c.decoy ? "✗" : " ";
    let row = `${tag} ${c.item}`.padEnd(30);
    for (const pk of profileKeys) {
      const score = matrix[c.item][pk];
      const cell = `${score} ${severityLabel(score)}`;
      const expFlag = c.expectations[pk].flag;
      const predFlag = score >= FLAG;
      const colored = expFlag === predFlag ? GREEN(cell) : RED(cell);
      // pad on the visible length, not the colored length
      const pad = colW - cell.length;
      row += " ".repeat(Math.max(0, pad)) + colored;
    }
    console.log(row);
  }
  console.log("\n  ★ headline   • anchor   ✗ decoy\n");

  // ── False negatives (LOUD) ─────────────────────────────────────────────────
  if (falseNegatives.length > 0) {
    console.log(RED(BOLD("\n⚠️  FALSE NEGATIVES - dangerous misses (a customer's rule would slip through):")));
    for (const m of falseNegatives) console.log(RED("   ✗ " + m));
  } else {
    console.log(GREEN("No false negatives - every expected flag was caught."));
  }

  if (falsePositives.length > 0) {
    console.log(YELLOW(BOLD("\n⚠️  False positives (noise that would erode trust):")));
    for (const m of falsePositives) console.log(YELLOW("   • " + m));
  }
  if (rangeMisses.length > 0) {
    console.log(YELLOW(BOLD("\nScore-range misses (flag direction may still be correct):")));
    for (const m of rangeMisses) console.log(YELLOW("   • " + m));
  }
  if (bandMismatches.length > 0) {
    console.log(YELLOW(BOLD("\nSeverity-band mismatches:")));
    for (const m of bandMismatches) console.log(YELLOW("   • " + m));
  }

  // ── Stage-0 tagging audit + case integrity ─────────────────────────────────
  console.log(BOLD("\nStage-0 tagging audit (keyword tagger vs declared categories):"));
  if (taggingRecallMisses.length === 0 && taggingDecoyLeaks.length === 0) {
    console.log(GREEN("  ✓ tagger recovers every positive's categories; no decoy leaks into a subscribed category."));
  } else {
    for (const m of taggingRecallMisses) console.log(RED(BOLD("  ✗ RECALL HOLE: ")) + RED(m));
    for (const m of taggingDecoyLeaks) console.log(YELLOW("  • decoy leak: " + m));
  }
  if (bandDeclMismatches.length > 0) {
    console.log(YELLOW(BOLD("\nCase-integrity (declared band vs range) mismatches:")));
    for (const m of bandDeclMismatches) console.log(YELLOW("   • " + m));
  }

  // ── Metrics summary ──────────────────────────────────────────────────────
  console.log(BOLD("\nMetrics over flags:"));
  console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}`);
  const fmt = (v: number) => v.toFixed(3);
  const line = (label: string, v: number, thr: number) =>
    `  ${label.padEnd(10)} ${fmt(v)}  (threshold ${fmt(thr)})  ${v >= thr ? GREEN("PASS") : RED("FAIL")}`;
  console.log(line("precision", precision, thresholds.precision));
  console.log(line("recall", recall, thresholds.recall));
  console.log(line("f1", f1, thresholds.f1));

  // ── THE HEADLINE assertion (spec §11 C / CLAUDE.md DoD) ────────────────────
  console.log(BOLD("\nHeadline assertion (import de minimis re-scores by profile):"));
  const headlineCase = cases.find((c) => c.headline);
  let headlineOk = true;
  if (!headlineCase) {
    console.log(RED("  No headline case found (expected C-import-de-minimis with headline:true)."));
    headlineOk = false;
  } else {
    const m = matrix[headlineCase.item];
    const checks: Array<[string, boolean, string]> = [
      ["ecom-goods flagged High+", m["ecom-goods"] >= 4, `score ${m["ecom-goods"]}`],
      ["hardware-maker flagged High+", m["hardware-maker"] >= 4, `score ${m["hardware-maker"]}`],
      ["saas-remote NOT flagged", m["saas-remote"] < FLAG, `score ${m["saas-remote"]}`],
      ["food-cpg NOT flagged", m["food-cpg"] < FLAG, `score ${m["food-cpg"]}`],
    ];
    for (const [label, ok, detail] of checks) {
      console.log(`  ${ok ? GREEN("✓") : RED("✗")} ${label} (${detail})`);
      if (!ok) headlineOk = false;
    }
  }

  // ── Exit ───────────────────────────────────────────────────────────────────
  const metricsOk =
    precision >= thresholds.precision && recall >= thresholds.recall && f1 >= thresholds.f1;
  const noFalseNegatives = fn === 0;
  const rangeOk = rangeMisses.length === 0;
  const bandOk = bandMismatches.length === 0;
  const taggingOk = taggingRecallMisses.length === 0 && taggingDecoyLeaks.length === 0;
  const caseIntegrityOk = bandDeclMismatches.length === 0;
  const pass = metricsOk && noFalseNegatives && headlineOk && rangeOk && bandOk && taggingOk && caseIntegrityOk;

  if (pass) {
    console.log(GREEN(BOLD("\n✅ EVAL GREEN - thresholds met, headline holds, no false negatives.\n")));
    process.exit(0);
  } else {
    console.log(RED(BOLD("\n❌ EVAL FAILED - see issues above.")));
    if (!metricsOk) console.log(RED("   • A metric fell below threshold."));
    if (!noFalseNegatives) console.log(RED("   • There are false negatives (recall regression)."));
    if (!headlineOk) console.log(RED("   • The headline horizontal-relevance assertion failed."));
    if (!rangeOk) console.log(RED("   • Some scores fell outside their expected ranges."));
    if (!bandOk) console.log(RED("   • Some severity bands did not match."));
    if (!taggingOk) console.log(RED("   • Stage-0 tagging audit failed (recall hole or decoy leak)."));
    if (!caseIntegrityOk) console.log(RED("   • A case's declared band is inconsistent with its score range."));
    console.log("");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(RED("Eval crashed:"), err);
  process.exit(1);
});
