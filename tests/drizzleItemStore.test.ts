/**
 * DrizzleItemStore - INTEGRATION test (spec §6, §7, §14).
 *
 * This test hits a REAL Postgres and is therefore gated behind an env flag so
 * the default green gate (`npm run test`) stays fully hermetic - with no flag
 * set the whole suite is skipped and no socket is opened. The dedup/diff/cursor
 * SEMANTICS are proven hermetically against MemoryItemStore in tests/ingest.test.ts;
 * here we verify the production SQL mapping behaves identically against pg.
 *
 * To run it (requires Docker + a migrated DB):
 *
 *     npm run db:up && npm run db:migrate
 *     RUN_DB_TESTS=1 npm run test
 *
 * It exercises: insert a brand-new item (isNew=true), re-upsert the same item
 * unchanged (isNew=false, no duplicate row), upsert a changed item (isNew=false,
 * fields updated, first_seen_at preserved), append status history, and a cursor
 * round-trip. The test cleans up the rows it creates and closes the pool.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { DrizzleItemStore } from "@/lib/adapters/drizzleItemStore";
import { closeDb, getDb } from "@/lib/db";
import { contentHashFor } from "@/lib/hash";
import { env } from "@/lib/env";
import type { DerivedFields } from "@/lib/itemStore";
import type { NormalizedItem } from "@/lib/types";
import { items, itemStatusHistory, syncState } from "@db/schema";

const RUN = Boolean(process.env.RUN_DB_TESTS);

// Use a clearly-scoped synthetic source/id so cleanup never touches real data.
const TEST_SOURCE = "federal_register" as const;
const TEST_EXTERNAL_ID = "REDLINE-TEST-DRIZZLE-ITEMSTORE-1";
const TEST_CURSOR_SOURCE = "redline_test_drizzle_cursor";

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  const base = {
    source: TEST_SOURCE,
    external_id: TEST_EXTERNAL_ID,
    jurisdiction: "us",
    type: "proposed_rule" as const,
    identifier: "RL-TEST-1",
    title: "A proposed rule under test",
    summary: "Our own paraphrased summary of a test rule.",
    full_text_url: null,
    full_text: null,
    status: "proposed",
    stage: "proposed" as const,
    introduced_date: "2026-01-01",
    last_action_date: "2026-01-02T00:00:00.000Z",
    last_action_text: "Filed for review",
    comment_close_date: null,
    sponsors: [] as unknown[],
    subjects: [] as string[],
    raw: { external_id: TEST_EXTERNAL_ID },
    ...overrides,
  };
  return { ...base, content_hash: contentHashFor(base) };
}

const derived: DerivedFields = {
  categories: ["data_privacy"],
  // Embedding width must match the configured dimension or pgvector rejects it.
  embedding: Array.from({ length: env().EMBED_DIM }, () => 0),
};

describe.skipIf(!RUN)("DrizzleItemStore (integration, RUN_DB_TESTS)", () => {
  const db = getDb();
  const store = new DrizzleItemStore();

  async function cleanup(): Promise<void> {
    const existing = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.source, TEST_SOURCE), eq(items.externalId, TEST_EXTERNAL_ID)));
    for (const row of existing) {
      await db.delete(itemStatusHistory).where(eq(itemStatusHistory.itemId, row.id));
    }
    await db.delete(items).where(and(eq(items.source, TEST_SOURCE), eq(items.externalId, TEST_EXTERNAL_ID)));
    await db.delete(syncState).where(eq(syncState.source, TEST_CURSOR_SOURCE));
  }

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  it("getSignature returns null for an unknown item", async () => {
    const sig = await store.getSignature(TEST_SOURCE, TEST_EXTERNAL_ID);
    expect(sig).toBeNull();
  });

  it("inserts a new item (isNew=true) and reads its signature back", async () => {
    const item = makeItem();
    const { id, isNew } = await store.upsertItem(item, derived);

    expect(isNew).toBe(true);
    expect(id).toMatch(/[0-9a-f-]{36}/);

    const sig = await store.getSignature(TEST_SOURCE, TEST_EXTERNAL_ID);
    expect(sig).not.toBeNull();
    expect(sig!.id).toBe(id);
    expect(sig!.content_hash).toBe(item.content_hash);
    expect(sig!.status).toBe("proposed");
    // timestamptz round-trips back to an ISO string.
    expect(sig!.last_action_date).toBe("2026-01-02T00:00:00.000Z");
    expect(sig!.last_action_text).toBe("Filed for review");
  });

  it("re-upserting the SAME item reports isNew=false and creates no duplicate", async () => {
    const item = makeItem();
    const first = await store.upsertItem(item, derived);
    const second = await store.upsertItem(item, derived);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.id).toBe(first.id); // stable id by (source, external_id)

    const count = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.source, TEST_SOURCE), eq(items.externalId, TEST_EXTERNAL_ID)));
    expect(count).toHaveLength(1); // no dupes
  });

  it("upserting a CHANGED item updates fields, reports isNew=false, preserves first_seen_at", async () => {
    const original = makeItem();
    const inserted = await store.upsertItem(original, derived);

    const firstRow = (
      await db.select().from(items).where(eq(items.id, inserted.id)).limit(1)
    )[0];
    expect(firstRow).toBeDefined();
    const originalFirstSeen = firstRow!.firstSeenAt;

    const moved = makeItem({
      status: "comment_open",
      last_action_date: "2026-02-01T00:00:00.000Z",
      last_action_text: "Comment period opened",
      summary: "An updated paraphrased summary.",
    });
    const updated = await store.upsertItem(moved, derived);

    expect(updated.isNew).toBe(false);
    expect(updated.id).toBe(inserted.id);

    const after = (await db.select().from(items).where(eq(items.id, inserted.id)).limit(1))[0];
    expect(after).toBeDefined();
    expect(after!.status).toBe("comment_open");
    expect(after!.lastActionText).toBe("Comment period opened");
    expect(after!.contentHash).toBe(moved.content_hash);
    expect(after!.contentHash).not.toBe(original.content_hash);
    // first_seen_at must be untouched on update; updated_at must advance.
    expect(after!.firstSeenAt.getTime()).toBe(originalFirstSeen.getTime());
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(originalFirstSeen.getTime());
  });

  it("appendStatusHistory writes an append-only history row", async () => {
    const item = makeItem();
    const { id } = await store.upsertItem(item, derived);

    await store.appendStatusHistory(id, {
      status: item.status,
      action_text: item.last_action_text,
      action_date: item.last_action_date,
      raw: item.raw,
    });

    const history = await db
      .select()
      .from(itemStatusHistory)
      .where(eq(itemStatusHistory.itemId, id));
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("proposed");
    expect(history[0].actionText).toBe("Filed for review");
    expect(history[0].actionDate?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("round-trips the per-source cursor (getCursor / setCursor upsert)", async () => {
    expect(await store.getCursor(TEST_CURSOR_SOURCE)).toBeNull();

    await store.setCursor(TEST_CURSOR_SOURCE, "cursor-1", new Date("2026-06-11T00:00:00.000Z"));
    expect(await store.getCursor(TEST_CURSOR_SOURCE)).toBe("cursor-1");

    // setCursor is an upsert on the PK (source) - second call updates, no dupe.
    await store.setCursor(TEST_CURSOR_SOURCE, "cursor-2", new Date("2026-06-12T00:00:00.000Z"));
    expect(await store.getCursor(TEST_CURSOR_SOURCE)).toBe("cursor-2");

    const rows = await db.select().from(syncState).where(eq(syncState.source, TEST_CURSOR_SOURCE));
    expect(rows).toHaveLength(1);
    expect(rows[0].cursor).toBe("cursor-2");

    // A null cursor is a valid stored value.
    await store.setCursor(TEST_CURSOR_SOURCE, null, new Date("2026-06-13T00:00:00.000Z"));
    expect(await store.getCursor(TEST_CURSOR_SOURCE)).toBeNull();
  });
});
