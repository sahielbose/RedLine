/**
 * End-to-end Stage 0→A→B(+memo) through the scoreBoard orchestrator, over the
 * real eval fixtures + profiles. Proves the §11 headline survives the FULL
 * pipeline (prefilter + judge + memo), not just the judge in isolation:
 * import de minimis surfaces Critical (with a draft memo) for ecom-goods and is
 * Stage-A FILTERED OUT for saas-remote. Hermetic (HeuristicLLM + hash embedder).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";

import { scoreBoard, type ScorableItem } from "@/pipeline/score";
import { getLLM } from "@/lib/llm";
import { getEmbedder } from "@/lib/embedder";
import type { BusinessProfile } from "@/lib/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVALS = path.resolve(HERE, "..", "evals");
const llm = getLLM();
const embedder = getEmbedder();

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function loadProfile(name: string): BusinessProfile {
  const p = readJson<BusinessProfile>(path.join(EVALS, "profiles", `${name}.json`));
  // Give the profile an embedding so Stage-A ordering is meaningful.
  return p;
}

interface Fixture {
  id: string;
  source?: string;
  jurisdiction?: string;
  type?: string;
  identifier?: string;
  title: string;
  summary?: string;
  full_text?: string;
  categories?: string[];
}

let items: ScorableItem[];
let profiles: Record<string, BusinessProfile>;

beforeAll(async () => {
  const fixtureDir = path.join(EVALS, "fixtures");
  const fixtures = fs
    .readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Fixture>(path.join(fixtureDir, f)));

  const embeddings = await embedder.embed(
    fixtures.map((f) => [f.title, f.summary, f.full_text].filter(Boolean).join("\n")),
  );

  items = fixtures.map((f, i) => ({
    id: f.id,
    jurisdiction: f.jurisdiction ?? "us",
    categories: f.categories ?? [],
    embedding: embeddings[i],
    title: f.title,
    summary: f.summary ?? null,
    full_text: f.full_text ?? null,
    identifier: f.identifier ?? f.id,
    type: f.type ?? null,
    source: f.source ?? null,
  }));

  profiles = {};
  for (const name of ["ecom-goods", "saas-remote", "food-cpg", "hardware-maker"]) {
    const p = loadProfile(name);
    const [emb] = await embedder.embed([p.concern_text]);
    profiles[name] = { ...p, embedding: emb };
  }
});

function findDeMinimis(): string {
  const f = items.find((i) => /de minimis|section 321/i.test(`${i.title} ${i.summary ?? ""}`));
  if (!f) throw new Error("de minimis fixture not found");
  return f.id;
}

describe("scoreBoard (full Stage 0→A→B pipeline)", () => {
  it("surfaces import de minimis as Critical + drafts a memo for ecom-goods", async () => {
    const board = await scoreBoard({ profile: profiles["ecom-goods"], items, llm });
    const deMin = board.surfaced.find((s) => s.id === findDeMinimis());
    expect(deMin).toBeDefined();
    expect(deMin!.score).toBe(5);
    expect(deMin!.severity).toBe("Critical");
    expect(deMin!.memo).toBeDefined();
    expect(deMin!.memo!.status).toBe("draft");
  });

  it("filters import de minimis OUT for saas-remote (Stage A category reject)", async () => {
    const board = await scoreBoard({ profile: profiles["saas-remote"], items, llm });
    const surfacedIds = board.surfaced.map((s) => s.id);
    expect(surfacedIds).not.toContain(findDeMinimis());
    expect(board.filteredOut).toBeGreaterThan(0);
  });

  it("logs a judgment for every surfaced candidate", async () => {
    const seen: string[] = [];
    const board = await scoreBoard({
      profile: profiles["hardware-maker"],
      items,
      llm,
      onJudgment: (_j, itemId) => {
        seen.push(itemId);
      },
    });
    expect(seen.length).toBe(board.surfaced.length);
    expect(seen.length).toBeGreaterThan(0);
  });
});
