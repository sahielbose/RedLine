/**
 * Hermetic tests for the Congress.gov v3 SourceClient (spec §5, DATA_SOURCES.md).
 *
 * (a) normalizeCongressBill(fixture) - the PURE map: identifier / type / dates /
 *     stage / content_hash, with no fabrication (summary + comment_close_date
 *     null because the list endpoint doesn't carry them).
 * (b) CongressClient with an injected fetchImpl that replays the recorded
 *     fixture - fetchSince(null) returns normalized items and a non-null cursor,
 *     never touching the live API.
 *
 * No network, no API key, no DB.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CongressClient,
  normalizeCongressBill,
  stageFromAction,
  type RawCongressBill,
} from "@/sources/congress";
import { contentHashFor } from "@/lib/hash";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  HERE,
  "..",
  "src",
  "sources",
  "fixtures",
  "congress.sample.json",
);

interface FixtureShape {
  bills: RawCongressBill[];
  pagination?: { count?: number; next?: string | null };
}

function loadFixture(): FixtureShape {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as FixtureShape;
}

/** A fetch stub that returns the fixture as a Response-like, ignoring the URL. */
function fixtureFetch(payload: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      async json() {
        return payload;
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("normalizeCongressBill - pure mapping", () => {
  const fixture = loadFixture();
  const hr = normalizeCongressBill(fixture.bills[0]);
  const sres = normalizeCongressBill(fixture.bills[1]);

  it("maps source, jurisdiction, external_id, and identifier", () => {
    expect(hr.source).toBe("congress");
    expect(hr.jurisdiction).toBe("us");
    expect(hr.external_id).toBe("119-HR-1234");
    expect(hr.identifier).toBe("HR-1234");
    expect(sres.external_id).toBe("119-SRES-88");
    expect(sres.identifier).toBe("SRES-88");
  });

  it("discriminates bill vs resolution by type suffix", () => {
    expect(hr.type).toBe("bill");
    expect(sres.type).toBe("resolution");
  });

  it("parses last_action_date to ISO from real actionDate (+actionTime)", () => {
    // HR-1234 had actionDate 2026-06-08 + actionTime 11:47:00.
    expect(hr.last_action_date).toBe("2026-06-08T11:47:00.000Z");
    expect(hr.last_action_text).toMatch(/passed the house/i);
    // SRES-88 had only actionDate (no time) → midnight UTC.
    expect(sres.last_action_date).toBe("2026-05-30T00:00:00.000Z");
    expect(sres.introduced_date).toBe("2026-05-30");
  });

  it("maps stage from the latest action text", () => {
    // "Passed the House ... presented to the Senate" → finalized.
    expect(hr.stage).toBe("finalized");
    // "Introduced ... referred to the Committee" → proposed.
    expect(sres.stage).toBe("proposed");
  });

  it("does not fabricate absent fields (summary, comment_close_date null)", () => {
    expect(hr.summary).toBeNull();
    expect(hr.comment_close_date).toBeNull();
    expect(sres.summary).toBeNull();
    expect(sres.comment_close_date).toBeNull();
  });

  it("carries sponsors, subjects (policyArea + legislative), and the PUBLIC congress.gov URL", () => {
    expect(hr.sponsors).toHaveLength(1);
    expect(hr.subjects).toContain("Labor and Employment");
    expect(hr.subjects).toContain("Worker classification");
    // Public, human-facing page - never the key-gated api.congress.gov endpoint.
    expect(hr.full_text_url).toBe("https://www.congress.gov/bill/119th-congress/house-bill/1234");
    expect(hr.full_text_url).not.toContain("api.congress.gov");
  });

  it("sets content_hash to contentHashFor(item) (recomputable, deterministic)", () => {
    expect(hr.content_hash).toBe(contentHashFor(hr));
    expect(hr.content_hash).toHaveLength(64); // sha-256 hex
    // Same input → same hash; re-normalizing is stable.
    expect(normalizeCongressBill(fixture.bills[0]).content_hash).toBe(hr.content_hash);
  });
});

describe("stageFromAction", () => {
  it("introduced/referred → proposed", () => {
    expect(stageFromAction("Introduced in the House.")).toBe("proposed");
    expect(stageFromAction("Referred to the Committee on the Judiciary.")).toBe("proposed");
  });
  it("passed/agreed/presented → finalized", () => {
    expect(stageFromAction("Passed the Senate without amendment.")).toBe("finalized");
    expect(stageFromAction("Resolution agreed to in House.")).toBe("finalized");
  });
  it("became public law / enacted → in_effect", () => {
    expect(stageFromAction("Became Public Law No: 119-10.")).toBe("in_effect");
  });
  it("vetoed/failed → contested_vacated", () => {
    expect(stageFromAction("Vetoed by President.")).toBe("contested_vacated");
  });
  it("null/empty → null", () => {
    expect(stageFromAction(null)).toBeNull();
    expect(stageFromAction("")).toBeNull();
  });
});

describe("CongressClient.fetchSince - hermetic (injected fetchImpl)", () => {
  it("returns normalized items and a non-null cursor from the fixture", async () => {
    const fixture = loadFixture();
    const client = new CongressClient({
      apiKey: "test-key-not-used-by-stub",
      fetchImpl: fixtureFetch(fixture),
      now: () => new Date("2026-06-11T00:00:00Z"),
    });

    const { items, cursor } = await client.fetchSince(null);

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.source === "congress")).toBe(true);
    expect(items.map((i) => i.identifier)).toEqual(["HR-1234", "SRES-88"]);

    // Cursor = max updateDate observed across the page (SRES-88: 2026-06-10).
    expect(cursor).not.toBeNull();
    expect(cursor).toBe("2026-06-10T09:05:00.000Z");
  });

  it("treats a cursor as the fromDateTime watermark and still advances the cursor", async () => {
    const fixture = loadFixture();
    const client = new CongressClient({
      fetchImpl: fixtureFetch(fixture),
      now: () => new Date("2026-06-11T00:00:00Z"),
    });

    const { items, cursor } = await client.fetchSince("2026-06-01T00:00:00.000Z");
    expect(items).toHaveLength(2);
    expect(cursor).toBe("2026-06-10T09:05:00.000Z");
  });

  it("on an empty poll, advances the cursor to the request's toDateTime", async () => {
    const client = new CongressClient({
      fetchImpl: fixtureFetch({ bills: [], pagination: { count: 0, next: null } }),
      now: () => new Date("2026-06-11T00:00:00Z"),
    });

    const { items, cursor } = await client.fetchSince("2026-06-01T00:00:00.000Z");
    expect(items).toHaveLength(0);
    // toDateTime watermark, with sub-second precision stripped (Congress.gov 400s on milliseconds).
    expect(cursor).toBe("2026-06-11T00:00:00Z");
  });
});
