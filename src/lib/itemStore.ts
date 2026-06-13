/**
 * ItemStore - the persistence boundary the ingest loop writes through (spec §6).
 *
 * Keeping ingestion behind this interface (the same philosophy as the LLM /
 * Embedder adapters) means the dedup / status-diff / cursor SEMANTICS are tested
 * hermetically against MemoryItemStore, while the production DrizzleItemStore is
 * a thin SQL mapping validated against a live Postgres. The loop logic is
 * identical for both.
 */
import type { NormalizedItem } from "./types";

/** The change-relevant snapshot of a stored item, for diffing on re-ingest. */
export interface StoredSignature {
  id: string;
  content_hash: string;
  status: string | null;
  last_action_date: string | null;
  last_action_text: string | null;
}

/** Derived fields the pipeline computes at ingest (spec §6 items.categories/embedding). */
export interface DerivedFields {
  categories: string[];
  embedding: number[];
}

/** A status-history entry (spec §6 item_status_history). */
export interface StatusEntry {
  status: string | null;
  action_text: string | null;
  action_date: string | null; // ISO
  raw: unknown;
}

export interface ItemStore {
  /** Stored change-signature for an item, or null if never seen. Lets the loop
   *  skip embedding/writes for unchanged items. */
  getSignature(source: string, externalId: string): Promise<StoredSignature | null>;
  /** Insert or update by (source, external_id). Returns the row id + whether new. */
  upsertItem(item: NormalizedItem, derived: DerivedFields): Promise<{ id: string; isNew: boolean }>;
  /** Append-only status history (the no-missed-amendment backbone). */
  appendStatusHistory(itemId: string, entry: StatusEntry): Promise<void>;
  getCursor(source: string): Promise<string | null>;
  setCursor(source: string, cursor: string | null, lastRunAt: Date): Promise<void>;
}

/**
 * In-memory ItemStore for tests and the hermetic ingest demo. Mirrors the exact
 * upsert/diff/cursor semantics of the production store.
 */
export class MemoryItemStore implements ItemStore {
  private items = new Map<string, NormalizedItem & DerivedFields & { id: string }>();
  private history: Array<{ itemId: string } & StatusEntry> = [];
  private cursors = new Map<string, { cursor: string | null; lastRunAt: Date }>();
  private seq = 0;

  private key(source: string, externalId: string): string {
    return `${source}::${externalId}`;
  }

  async getSignature(source: string, externalId: string): Promise<StoredSignature | null> {
    const row = this.items.get(this.key(source, externalId));
    if (!row) return null;
    return {
      id: row.id,
      content_hash: row.content_hash,
      status: row.status,
      last_action_date: row.last_action_date,
      last_action_text: row.last_action_text,
    };
  }

  async upsertItem(item: NormalizedItem, derived: DerivedFields): Promise<{ id: string; isNew: boolean }> {
    const k = this.key(item.source, item.external_id);
    const existing = this.items.get(k);
    const id = existing?.id ?? `mem-${++this.seq}`;
    this.items.set(k, { ...item, ...derived, id });
    return { id, isNew: !existing };
  }

  async appendStatusHistory(itemId: string, entry: StatusEntry): Promise<void> {
    this.history.push({ itemId, ...entry });
  }

  async getCursor(source: string): Promise<string | null> {
    return this.cursors.get(source)?.cursor ?? null;
  }

  async setCursor(source: string, cursor: string | null, lastRunAt: Date): Promise<void> {
    this.cursors.set(source, { cursor, lastRunAt });
  }

  // ── Test introspection ─────────────────────────────────────────────────────
  get size(): number {
    return this.items.size;
  }
  historyFor(itemId: string): StatusEntry[] {
    return this.history.filter((h) => h.itemId === itemId).map(({ itemId: _i, ...rest }) => rest);
  }
  get historyCount(): number {
    return this.history.length;
  }
  all(): Array<NormalizedItem & DerivedFields & { id: string }> {
    return [...this.items.values()];
  }
}
