import { describe, it, expect } from "vitest";
import { MemoryPrefilter, cosineSimilarity, type PrefilterableItem } from "@/pipeline/prefilter";
import { getEmbedder } from "@/lib/embedder";

const embedder = getEmbedder();

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("returns 0 for mismatched/empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe("MemoryPrefilter (Stage A)", () => {
  it("keeps only jurisdiction + category matches, ordered by similarity", async () => {
    const [eImports, eOvertime, eFood] = await embedder.embed([
      "import duties customs tariff de minimis",
      "overtime wage and hour rules",
      "food safety traceability FSMA",
    ]);
    const items: PrefilterableItem[] = [
      { id: "imports", jurisdiction: "us", categories: ["goods"], embedding: eImports },
      { id: "overtime", jurisdiction: "us", categories: ["wages_hours"], embedding: eOvertime },
      { id: "food", jurisdiction: "us", categories: ["food"], embedding: eFood },
      { id: "ca-only", jurisdiction: "us-ny", categories: ["goods"], embedding: eImports },
    ];
    const [profileEmb] = await embedder.embed(["importer of physical goods, customs duties"]);

    const out = await new MemoryPrefilter(items).prefilter({
      embedding: profileEmb,
      jurisdictions: ["us", "us-ca"],
      subscribed_categories: ["goods", "wages_hours"],
    });

    const ids = out.map((c) => c.id);
    expect(ids).toContain("imports");
    expect(ids).toContain("overtime");
    expect(ids).not.toContain("food"); // category not subscribed → Stage-0 reject
    expect(ids).not.toContain("ca-only"); // jurisdiction us-ny not in profile
    // The customs item is most similar to a customs-flavored profile.
    expect(ids[0]).toBe("imports");
  });

  it("respects the limit", async () => {
    const [e] = await embedder.embed(["x"]);
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `i${i}`,
      jurisdiction: "us",
      categories: ["goods"],
      embedding: e,
    }));
    const out = await new MemoryPrefilter(items).prefilter(
      { embedding: e, jurisdictions: ["us"], subscribed_categories: ["goods"] },
      { limit: 3 },
    );
    expect(out).toHaveLength(3);
  });
});
