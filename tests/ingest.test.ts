/**
 * Hermetic proof of the Phase-1 ingest checkpoint (spec §14): re-running over
 * unchanged source data produces NO duplicate rows and NO spurious status
 * history, the cursor advances, and a real status change appends exactly one
 * history row. Runs against MemoryItemStore + the deterministic hash embedder -
 * no DB, no network, no keys. The production DrizzleItemStore shares this loop.
 */
import { describe, it, expect } from "vitest";
import { runIngest } from "@/pipeline/ingest";
import { MemoryItemStore } from "@/lib/itemStore";
import { getEmbedder } from "@/lib/embedder";
import { contentHashFor } from "@/lib/hash";
import type { SourceClient } from "@/lib/interfaces";
import type { NormalizedItem } from "@/lib/types";

function makeItem(overrides: Partial<NormalizedItem> & { external_id: string }): NormalizedItem {
  const base = {
    source: "federal_register" as const,
    jurisdiction: "us",
    type: "proposed_rule" as const,
    identifier: overrides.external_id,
    title: "A proposed rule",
    summary: "A summary of the rule.",
    full_text_url: null,
    status: "proposed",
    stage: "proposed" as const,
    introduced_date: "2026-01-01",
    last_action_date: "2026-01-02T00:00:00Z",
    last_action_text: "Filed",
    comment_close_date: null,
    sponsors: [],
    subjects: [],
    raw: { external_id: overrides.external_id },
    ...overrides,
  };
  return { ...base, content_hash: contentHashFor(base) };
}

/** A SourceClient that replays a fixed batch and a fixed next-cursor. */
function fakeClient(batch: NormalizedItem[], nextCursor: string): SourceClient {
  return {
    key: "federal_register",
    async fetchSince() {
      return { items: batch, cursor: nextCursor };
    },
  };
}

const embedder = getEmbedder();
const classify = () => ["data_privacy"]; // deterministic Stage-0 stub

describe("ingest loop", () => {
  it("inserts new items and records one history row each, advancing the cursor", async () => {
    const store = new MemoryItemStore();
    const batch = [makeItem({ external_id: "FR-1" }), makeItem({ external_id: "FR-2" })];

    const stats = await runIngest({ client: fakeClient(batch, "cursor-1"), store, embedder, classify });

    expect(stats.inserted).toBe(2);
    expect(stats.updated).toBe(0);
    expect(stats.historyAppended).toBe(2);
    expect(store.size).toBe(2);
    expect(stats.cursor).toBe("cursor-1");
    expect(await store.getCursor("federal_register")).toBe("cursor-1");
    // categories + embedding were derived and stored.
    expect(store.all()[0].categories).toEqual(["data_privacy"]);
    expect(store.all()[0].embedding.length).toBe(embedder.dim);
  });

  it("is idempotent: re-running unchanged data adds no dupes and no history", async () => {
    const store = new MemoryItemStore();
    const batch = [makeItem({ external_id: "FR-1" }), makeItem({ external_id: "FR-2" })];

    await runIngest({ client: fakeClient(batch, "cursor-1"), store, embedder, classify });
    const stats2 = await runIngest({ client: fakeClient(batch, "cursor-2"), store, embedder, classify });

    expect(stats2.unchanged).toBe(2);
    expect(stats2.inserted).toBe(0);
    expect(stats2.historyAppended).toBe(0);
    expect(store.size).toBe(2); // no duplicates
    expect(store.historyCount).toBe(2); // unchanged from first run
    expect(await store.getCursor("federal_register")).toBe("cursor-2"); // cursor still advanced
  });

  it("appends exactly one history row when an item's last action changes", async () => {
    const store = new MemoryItemStore();
    await runIngest({ client: fakeClient([makeItem({ external_id: "FR-1" })], "c1"), store, embedder, classify });

    const moved = makeItem({
      external_id: "FR-1",
      status: "comment_open",
      last_action_date: "2026-02-01T00:00:00Z",
      last_action_text: "Comment period opened",
    });
    const stats = await runIngest({ client: fakeClient([moved], "c2"), store, embedder, classify });

    expect(stats.updated).toBe(1);
    expect(stats.inserted).toBe(0);
    expect(stats.historyAppended).toBe(1);
    expect(store.size).toBe(1);
    const id = store.all()[0].id;
    expect(store.historyFor(id).length).toBe(2); // initial + the change
    expect(store.historyFor(id)[1].status).toBe("comment_open");
  });

  it("updates content but appends NO history when a non-status field changes", async () => {
    const store = new MemoryItemStore();
    await runIngest({ client: fakeClient([makeItem({ external_id: "FR-1" })], "c1"), store, embedder, classify });

    // Summary edited, but status/last_action unchanged → content_hash differs,
    // so it's an update, but the status timeline did not move.
    const reworded = makeItem({ external_id: "FR-1", summary: "A reworded summary." });
    const stats = await runIngest({ client: fakeClient([reworded], "c2"), store, embedder, classify });

    expect(stats.updated).toBe(1);
    expect(stats.historyAppended).toBe(0);
    expect(store.historyCount).toBe(1);
  });
});
