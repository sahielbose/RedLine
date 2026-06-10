/**
 * DrizzleItemStore — the production persistence behind the ingest loop (spec §6, §7).
 *
 * A thin, faithful SQL mapping of the {@link ItemStore} interface over the §6
 * `items` / `item_status_history` / `sync_state` tables. The dedup / status-diff
 * / cursor SEMANTICS are proven hermetically against `MemoryItemStore` (see
 * tests/ingest.test.ts); this adapter is validated against a live Postgres by
 * the env-gated integration test (tests/drizzleItemStore.test.ts). The two
 * stores are interchangeable behind the loop.
 *
 * Notes on the mapping:
 *  - `items.last_action_date` is `timestamptz` (Drizzle infers `Date`), while the
 *    interface speaks ISO strings. We convert string → Date on write and Date →
 *    ISO string on read. `introduced_date` / `comment_close_date` are SQL `date`
 *    columns inferred by Drizzle as `string`, so they pass through unchanged.
 *  - `embedding` is a pgvector column; Drizzle accepts a `number[]`.
 *  - INSERT is upsert-by-(source, external_id). We detect insert-vs-update with
 *    the Postgres `xmax = 0` trick in RETURNING: a freshly inserted row has
 *    xmax 0; a row touched by ON CONFLICT DO UPDATE has a non-zero xmax.
 *  - `first_seen_at` is set ONLY on insert (the DO UPDATE set-list omits it);
 *    `last_synced_at` / `updated_at` are bumped to now() on every upsert.
 *  - No fabrication (spec §15): absent dates are stored as NULL, never invented.
 */
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import type {
  DerivedFields,
  ItemStore,
  StatusEntry,
  StoredSignature,
} from "@/lib/itemStore";
import type { NormalizedItem } from "@/lib/types";
import { items, itemStatusHistory, syncState } from "@db/schema";

/** Parse an ISO datetime string into a Date for a `timestamptz` column; null → null. */
function toTimestamp(iso: string | null): Date | null {
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Render a `timestamptz` Date back to an ISO string for the interface; null → null. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export class DrizzleItemStore implements ItemStore {
  private readonly db: ReturnType<typeof getDb>;

  /**
   * @param deps.db Optional Drizzle client (injected in tests / for an explicit
   *   transaction handle). Defaults to the lazy shared client from `@/lib/db`,
   *   so constructing this store opens no connection.
   */
  constructor(deps: { db?: ReturnType<typeof getDb> } = {}) {
    this.db = deps.db ?? getDb();
  }

  async getSignature(source: string, externalId: string): Promise<StoredSignature | null> {
    const rows = await this.db
      .select({
        id: items.id,
        content_hash: items.contentHash,
        status: items.status,
        last_action_date: items.lastActionDate,
        last_action_text: items.lastActionText,
      })
      .from(items)
      .where(and(eq(items.source, source), eq(items.externalId, externalId)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      content_hash: row.content_hash,
      status: row.status,
      last_action_date: toIso(row.last_action_date),
      last_action_text: row.last_action_text,
    };
  }

  async upsertItem(
    item: NormalizedItem,
    { categories, embedding }: DerivedFields,
  ): Promise<{ id: string; isNew: boolean }> {
    const lastActionDate = toTimestamp(item.last_action_date);

    const rows = await this.db
      .insert(items)
      .values({
        source: item.source,
        externalId: item.external_id,
        jurisdiction: item.jurisdiction,
        type: item.type,
        identifier: item.identifier,
        title: item.title,
        summary: item.summary,
        fullTextUrl: item.full_text_url,
        fullText: item.full_text ?? null,
        status: item.status,
        stage: item.stage,
        introducedDate: item.introduced_date,
        lastActionDate,
        lastActionText: item.last_action_text,
        commentCloseDate: item.comment_close_date,
        sponsors: item.sponsors,
        subjects: item.subjects,
        categories,
        raw: item.raw,
        contentHash: item.content_hash,
        embedding,
        // first_seen_at / last_synced_at / updated_at use schema defaults (now()).
      })
      .onConflictDoUpdate({
        target: [items.source, items.externalId],
        set: {
          title: item.title,
          summary: item.summary,
          status: item.status,
          stage: item.stage,
          lastActionDate,
          lastActionText: item.last_action_text,
          commentCloseDate: item.comment_close_date,
          fullTextUrl: item.full_text_url,
          sponsors: item.sponsors,
          subjects: item.subjects,
          categories,
          embedding,
          raw: item.raw,
          contentHash: item.content_hash,
          // first_seen_at is intentionally NOT touched on update.
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      // xmax = 0 ⇒ the row was inserted; a non-zero xmax ⇒ it was updated.
      .returning({ id: items.id, inserted: sql<boolean>`(xmax = 0)` });

    const row = rows[0];
    if (!row) {
      // RETURNING on an upsert always yields the affected row; defensive only.
      throw new Error("DrizzleItemStore.upsertItem: no row returned from upsert");
    }
    return { id: row.id, isNew: row.inserted };
  }

  async appendStatusHistory(itemId: string, entry: StatusEntry): Promise<void> {
    await this.db.insert(itemStatusHistory).values({
      itemId,
      status: entry.status,
      actionText: entry.action_text,
      actionDate: toTimestamp(entry.action_date),
      raw: entry.raw,
    });
  }

  async getCursor(source: string): Promise<string | null> {
    const rows = await this.db
      .select({ cursor: syncState.cursor })
      .from(syncState)
      .where(eq(syncState.source, source))
      .limit(1);

    const row = rows[0];
    return row ? row.cursor : null;
  }

  async setCursor(source: string, cursor: string | null, lastRunAt: Date): Promise<void> {
    await this.db
      .insert(syncState)
      .values({ source, cursor, lastRunAt })
      .onConflictDoUpdate({
        target: syncState.source,
        set: { cursor, lastRunAt },
      });
  }
}
