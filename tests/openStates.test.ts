/**
 * Hermetic tests for the Open States / Plural v3 SourceClient (spec §5).
 *
 * No network, no key: the pure `normalizeOpenStatesBill` is tested directly, and
 * the client is exercised with an injected `fetchImpl` that replays the recorded
 * CA fixture (OUR paraphrased copy). Asserts identifier normalization, type +
 * stage mapping, real-field dates (no fabrication), content_hash stability, and
 * that the client returns items + the max `updated_at` watermark cursor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  OpenStatesClient,
  normalizeIdentifier,
  normalizeOpenStatesBill,
  mapStage,
  parseStates,
  type OpenStatesBill,
} from "@/sources/openStates";
import { contentHashFor } from "@/lib/hash";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, "..", "src", "sources", "fixtures", "openStates-ca.sample.json");

interface Fixture {
  results: OpenStatesBill[];
}
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as Fixture & Record<string, unknown>;
const [bill1, bill2] = fixture.results;

/** A fetch stub that always returns the recorded fixture as JSON. */
function fixtureFetch(): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")),
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("normalizeIdentifier", () => {
  it("normalizes 'AB 123' → 'CA-AB-123' for us-ca", () => {
    expect(normalizeIdentifier("AB 123", "us-ca")).toBe("CA-AB-123");
  });
  it("strips dots and collapses whitespace ('S.B.  45' → 'CA-SB-45')", () => {
    expect(normalizeIdentifier("S.B.  45", "us-ca")).toBe("CA-SB-45");
  });
  it("respects a different jurisdiction code", () => {
    expect(normalizeIdentifier("HB 2089", "us-tx")).toBe("TX-HB-2089");
  });
  it("returns null when the source had no identifier (no fabrication)", () => {
    expect(normalizeIdentifier(null, "us-ca")).toBeNull();
    expect(normalizeIdentifier("", "us-ca")).toBeNull();
  });
});

describe("normalizeOpenStatesBill — the bill (AB 123)", () => {
  const item = normalizeOpenStatesBill(bill1, "us-ca");

  it("maps source, external_id, jurisdiction", () => {
    expect(item.source).toBe("openstates");
    expect(item.external_id).toBe(bill1.id);
    expect(item.jurisdiction).toBe("us-ca");
  });

  it("normalizes the identifier and types it as a bill", () => {
    expect(item.identifier).toBe("CA-AB-123");
    expect(item.type).toBe("bill");
  });

  it("takes the first abstract as the summary", () => {
    expect(item.summary).toBe(bill1.abstracts?.[0]?.abstract?.trim());
    expect(item.summary).toMatch(/auto-renewing subscription/i);
  });

  it("derives status + last_action from the REAL latest-action fields only", () => {
    expect(item.last_action_text).toBe(bill1.latest_action_description);
    expect(item.last_action_date).toBe(bill1.latest_action_date); // '2026-06-03'
    expect(item.status).toBe(bill1.latest_action_description);
    expect(item.introduced_date).toBe(bill1.first_action_date); // '2026-01-08'
  });

  it("maps an in-progress bill to the 'proposed' stage", () => {
    // Latest action is a second reading → still working through the process.
    expect(item.stage).toBe("proposed");
  });

  it("uses openstates_url as full_text_url and never invents a comment_close_date", () => {
    expect(item.full_text_url).toBe(bill1.openstates_url);
    expect(item.comment_close_date).toBeNull(); // bills carry no comment period
    expect(item.full_text).toBeNull();
  });

  it("passes through sponsors (what the API returned) and subjects", () => {
    expect(item.sponsors).toHaveLength(2);
    expect((item.sponsors[0] as { name: string }).name).toBe("A. Rivera");
    expect((item.sponsors[0] as { primary: boolean }).primary).toBe(true);
    expect(item.subjects).toEqual(["Labor", "Consumer protection"]);
  });

  it("sets content_hash via the shared contentHashFor over change-relevant fields", () => {
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
});

describe("normalizeOpenStatesBill — the resolution (SCR 45)", () => {
  const item = normalizeOpenStatesBill(bill2, "us-ca");

  it("types a resolution from classification[]", () => {
    expect(item.type).toBe("resolution");
    expect(item.identifier).toBe("CA-SCR-45");
  });

  it("summary is null when there are no abstracts (no fabrication)", () => {
    expect(item.summary).toBeNull();
  });

  it("maps a chaptered/enacted item to the 'in_effect' stage", () => {
    expect(item.stage).toBe("in_effect");
  });

  it("keeps an empty subjects array rather than inventing tags", () => {
    expect(item.subjects).toEqual([]);
  });
});

describe("mapStage — real action tags only, no guessing", () => {
  it("returns null for a record with no actions and no latest action", () => {
    expect(mapStage({ id: "x" })).toBeNull();
  });
  it("flags vetoed/failed/withdrawn as contested_vacated", () => {
    expect(mapStage({ id: "x", actions: [{ classification: ["veto"] }] })).toBe("contested_vacated");
    expect(mapStage({ id: "x", latest_action_description: "Failed passage in committee." })).toBe(
      "contested_vacated",
    );
  });
  it("flags an enrolled/passed bill as finalized", () => {
    expect(mapStage({ id: "x", actions: [{ classification: ["passage"] }] })).toBe("finalized");
  });
});

describe("OpenStatesClient.fetchSince — hermetic, injected fetchImpl", () => {
  it("normalizes the fixture and returns the max updated_at as the next cursor", async () => {
    const client = new OpenStatesClient({
      jurisdiction: "California",
      jurisdictionCode: "us-ca",
      fetchImpl: fixtureFetch(),
    });

    const { items, cursor } = await client.fetchSince("2026-01-01T00:00:00Z");

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.source === "openstates" && i.jurisdiction === "us-ca")).toBe(true);
    expect(items.map((i) => i.identifier)).toEqual(["CA-AB-123", "CA-SCR-45"]);
    // Cursor = the latest updated_at across the batch (bill1 is the newest).
    expect(cursor).toBe(bill1.updated_at);
  });

  it("cold start (cursor=null) still returns the batch and a non-null cursor", async () => {
    const client = new OpenStatesClient({ fetchImpl: fixtureFetch() });
    const { items, cursor } = await client.fetchSince(null);
    expect(items).toHaveLength(2);
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeGreaterThan(0);
  });

  it("exposes the SourceClient key 'openstates'", () => {
    expect(new OpenStatesClient().key).toBe("openstates");
  });

  it("multi-state: tags items per state and returns a JSON cursor map", async () => {
    const fetchImpl = (async (url: string | URL) => {
      const j = new URL(String(url)).searchParams.get("jurisdiction") ?? "";
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: async () => ({
          results: [{ id: `${j}-1`, identifier: "HB 1", title: `${j} bill`, updated_at: "2026-02-01T00:00:00Z" }],
          pagination: { max_page: 1, page: 1 },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = new OpenStatesClient({
      states: [{ name: "Texas", code: "us-tx" }, { name: "New York", code: "us-ny" }],
      fetchImpl,
    });
    const { items, cursor } = await client.fetchSince(null);
    expect(items.map((i) => i.jurisdiction).sort()).toEqual(["us-ny", "us-tx"]);
    expect(items.map((i) => i.identifier).sort()).toEqual(["NY-HB-1", "TX-HB-1"]);
    // Cursor is a JSON map with a per-state watermark for each polled state.
    const map = JSON.parse(cursor) as Record<string, string>;
    expect(Object.keys(map).sort()).toEqual(["us-ny", "us-tx"]);
    expect(typeof map["us-tx"]).toBe("string");
  });
});

describe("parseStates", () => {
  it("parses codes, dedups, and falls back to CA", () => {
    expect(parseStates("TX, ny ,TX").map((s) => s.code)).toEqual(["us-tx", "us-ny"]);
    expect(parseStates(undefined).map((s) => s.code)).toEqual(["us-ca"]);
    expect(parseStates("ZZ").map((s) => s.code)).toEqual(["us-ca"]); // unknown code → fallback
  });
});
