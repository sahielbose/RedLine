/**
 * Hermetic tests for the Federal Register SourceClient (spec §5, §7).
 *
 * No network, no keys: the pure `normalizeFederalRegisterDoc` is tested
 * directly, and `FederalRegisterClient` is exercised with an injected
 * `fetchImpl` that replays the recorded fixture (documents.json shape).
 *
 * Coverage: type mapping (Rule/Proposed Rule/Notice), stage derivation
 * (comment_open vs proposed vs finalized/in_effect), comment_close_date
 * parsing (real `comments_close_on` only, else null), agency capture into
 * raw + subjects (the Stage-0 signal), content_hash, and the client's
 * items + publication-date cursor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FederalRegisterClient,
  normalizeFederalRegisterDoc,
  type FederalRegisterDoc,
} from "@/sources/federalRegister";
import { contentHashFor } from "@/lib/hash";
import { classifyItem } from "@/pipeline/classify";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  HERE,
  "..",
  "src",
  "sources",
  "fixtures",
  "federalRegister.sample.json",
);

interface SampleResponse {
  results: FederalRegisterDoc[];
}

function loadFixture(): SampleResponse {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as SampleResponse;
}

/** Fixed clock so future-dated comment windows are deterministic. */
const NOW = new Date("2026-06-11T00:00:00Z");

/** Build a fetchImpl that returns the fixture as the JSON body, ignoring args. */
function fixtureFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const docs = loadFixture().results;
const proposed = docs.find((d) => d.type === "Proposed Rule")!;
const finalRule = docs.find((d) => d.type === "Rule")!;
const notice = docs.find((d) => d.type === "Notice")!;

describe("normalizeFederalRegisterDoc — field + type mapping", () => {
  it("maps source, ids, jurisdiction, and full_text_url from real fields", () => {
    const item = normalizeFederalRegisterDoc(proposed, NOW);
    expect(item.source).toBe("federal_register");
    expect(item.external_id).toBe(proposed.document_number);
    expect(item.identifier).toBe(proposed.document_number);
    expect(item.jurisdiction).toBe("us");
    expect(item.title).toBe(proposed.title);
    expect(item.summary).toBe(proposed.abstract);
    expect(item.full_text_url).toBe(proposed.html_url);
    expect(item.last_action_date).toBe(proposed.publication_date);
    expect(item.last_action_text).toBe(proposed.action);
  });

  it("maps 'Proposed Rule' → proposed_rule, 'Rule' → final_rule, 'Notice' → notice", () => {
    expect(normalizeFederalRegisterDoc(proposed, NOW).type).toBe("proposed_rule");
    expect(normalizeFederalRegisterDoc(finalRule, NOW).type).toBe("final_rule");
    expect(normalizeFederalRegisterDoc(notice, NOW).type).toBe("notice");
  });

  it("treats a Presidential Document as a notice", () => {
    const eo: FederalRegisterDoc = {
      document_number: "2026-EO-1",
      title: "Executive Order on Trade",
      type: "Presidential Document",
      publication_date: "2026-06-01",
    };
    expect(normalizeFederalRegisterDoc(eo, NOW).type).toBe("notice");
  });
});

describe("normalizeFederalRegisterDoc — comment_close_date + stage", () => {
  it("a proposed rule with a FUTURE comments_close_on → comment_open, date parsed", () => {
    const item = normalizeFederalRegisterDoc(proposed, NOW);
    expect(item.comment_close_date).toBe(proposed.comments_close_on); // 2026-08-10 (future vs NOW)
    expect(item.stage).toBe("comment_open");
  });

  it("a proposed rule with a PAST comments_close_on → proposed", () => {
    const past: FederalRegisterDoc = { ...proposed, comments_close_on: "2026-01-01" };
    const item = normalizeFederalRegisterDoc(past, NOW);
    expect(item.comment_close_date).toBe("2026-01-01");
    expect(item.stage).toBe("proposed");
  });

  it("a proposed rule with NO comments_close_on → comment_close_date null, stage proposed", () => {
    const none: FederalRegisterDoc = { ...proposed, comments_close_on: null };
    const item = normalizeFederalRegisterDoc(none, NOW);
    expect(item.comment_close_date).toBeNull();
    expect(item.stage).toBe("proposed");
  });

  it("a final rule → finalized (no effective date), comment_close_date null", () => {
    const item = normalizeFederalRegisterDoc(finalRule, NOW);
    expect(item.type).toBe("final_rule");
    expect(item.comment_close_date).toBeNull();
    expect(item.stage).toBe("finalized");
  });

  it("a final rule with a past effective date → in_effect", () => {
    const effective: FederalRegisterDoc = { ...finalRule, effective_on: "2026-05-01" };
    expect(normalizeFederalRegisterDoc(effective, NOW).stage).toBe("in_effect");
  });

  it("a notice with no open comment window → stage null", () => {
    const item = normalizeFederalRegisterDoc(notice, NOW);
    expect(item.type).toBe("notice");
    expect(item.stage).toBeNull();
  });
});

describe("normalizeFederalRegisterDoc — agency signal + content_hash + no fabrication", () => {
  it("captures the issuing agency into raw.agency and prepends it to subjects", () => {
    const item = normalizeFederalRegisterDoc(proposed, NOW);
    expect((item.raw as { agency: string | null }).agency).toBe("Federal Trade Commission");
    expect(item.subjects[0]).toBe("Federal Trade Commission");
    // topics follow the agency in subjects.
    expect(item.subjects).toContain("Consumer protection");
  });

  it("content_hash matches contentHashFor over the change-relevant fields", () => {
    const item = normalizeFederalRegisterDoc(proposed, NOW);
    const expected = contentHashFor({
      title: item.title,
      summary: item.summary,
      status: item.status,
      stage: item.stage,
      last_action_date: item.last_action_date,
      last_action_text: item.last_action_text,
      full_text_url: item.full_text_url,
      comment_close_date: item.comment_close_date,
    });
    expect(item.content_hash).toBe(expected);
  });

  it("invents nothing: absent agencies/topics yield null agency and empty subjects", () => {
    const bare: FederalRegisterDoc = {
      document_number: "2026-BARE-1",
      title: "A bare notice",
      type: "Notice",
      publication_date: "2026-06-01",
    };
    const item = normalizeFederalRegisterDoc(bare, NOW);
    expect((item.raw as { agency: string | null }).agency).toBeNull();
    expect(item.subjects).toEqual([]);
    expect(item.summary).toBeNull();
    expect(item.introduced_date).toBeNull();
    expect(item.sponsors).toEqual([]);
  });
});

describe("FederalRegisterClient.fetchSince — hermetic via injected fetchImpl", () => {
  it("normalizes the fixture batch and returns it with the max publication_date cursor", async () => {
    const client = new FederalRegisterClient({
      fetchImpl: fixtureFetch(loadFixture()),
      now: () => NOW,
    });

    const { items, cursor } = await client.fetchSince(null);

    expect(items).toHaveLength(3);
    expect(items.every((i) => i.source === "federal_register")).toBe(true);
    expect(items.map((i) => i.type).sort()).toEqual(["final_rule", "notice", "proposed_rule"]);
    // cursor = newest publication_date across the batch.
    expect(cursor).toBe("2026-06-09");
  });

  it("passes the cursor through as the publication-date floor and returns it when empty", async () => {
    // total_pages defaults to 1, empty results ⇒ no pagination, cursor falls back to the floor.
    const client = new FederalRegisterClient({
      fetchImpl: fixtureFetch({ count: 0, total_pages: 1, results: [] }),
      now: () => NOW,
    });

    const { items, cursor } = await client.fetchSince("2026-06-04");
    expect(items).toHaveLength(0);
    expect(cursor).toBe("2026-06-04");
  });

  it("exposes key 'federal_register'", () => {
    expect(new FederalRegisterClient().key).toBe("federal_register");
  });

  // Regression for the agency→Stage-0 wiring fix: an item whose ONLY relevance
  // signal is the issuing agency (no category keywords in title/abstract) must
  // still classify via item.agency, not silently lose its category.
  it("classifies via the agency alone when title/summary carry no keywords", () => {
    const doc: FederalRegisterDoc = {
      document_number: "2026-99999",
      title: "Agency procedural update",
      abstract: "A routine administrative notice with no topical keywords.",
      type: "Notice",
      publication_date: "2026-06-10",
      html_url: "https://www.federalregister.gov/d/2026-99999",
      agencies: [{ name: "Food and Drug Administration" }],
    };
    const item = normalizeFederalRegisterDoc(doc, NOW);
    expect(item.agency).toBe("Food and Drug Administration");
    // classifyItem reads item.agency; the FDA token maps to `food`.
    expect(classifyItem(item)).toContain("food");
  });
});
