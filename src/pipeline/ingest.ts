/**
 * The ingest loop (spec §3, §5, §7): poll a SourceClient "changed since cursor"
 * → normalize (done by the client) → upsert + diff → status_history → classify
 * (Stage 0) → embed → advance cursor.
 *
 * Idempotent by design: re-running with unchanged source data produces no
 * duplicate rows and no spurious status-history entries, and the cursor still
 * advances. Unchanged items are skipped before the (cost-bearing) embed call.
 */
import type { Embedder, SourceClient } from "@/lib/interfaces";
import type { ItemStore, StatusEntry } from "@/lib/itemStore";
import type { NormalizedItem } from "@/lib/types";
import { classifyItem } from "@/pipeline/classify";

export interface IngestStats {
  source: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  historyAppended: number;
  cursor: string | null;
}

export interface IngestDeps {
  client: SourceClient;
  store: ItemStore;
  embedder: Embedder;
  /** Stage 0 tagger (injectable for tests); defaults to classifyItem. */
  classify?: (item: NormalizedItem) => string[];
  /** Clock (injectable for determinism in tests). */
  now?: () => Date;
}

/** Text fed to the embedder for an item (title + summary). */
export function embedText(item: NormalizedItem): string {
  return [item.title, item.summary].filter(Boolean).join("\n");
}

function statusEntry(item: NormalizedItem): StatusEntry {
  return {
    status: item.status,
    action_text: item.last_action_text,
    action_date: item.last_action_date,
    raw: item.raw,
  };
}

/** Did the status-relevant fields move since the stored snapshot? */
function statusChanged(
  prev: { status: string | null; last_action_date: string | null; last_action_text: string | null },
  item: NormalizedItem,
): boolean {
  return (
    prev.status !== item.status ||
    prev.last_action_date !== item.last_action_date ||
    prev.last_action_text !== item.last_action_text
  );
}

export async function runIngest(deps: IngestDeps): Promise<IngestStats> {
  const { client, store, embedder } = deps;
  const classify = deps.classify ?? ((i: NormalizedItem) => classifyItem(i));
  const now = deps.now ?? (() => new Date());

  const cursor = await store.getCursor(client.key);
  const { items, cursor: nextCursor } = await client.fetchSince(cursor);

  const stats: IngestStats = {
    source: client.key,
    fetched: items.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    historyAppended: 0,
    cursor: nextCursor,
  };

  for (const item of items) {
    const sig = await store.getSignature(item.source, item.external_id);

    // Unchanged ⇒ skip the embed + write entirely (idempotent re-runs are cheap).
    if (sig && sig.content_hash === item.content_hash) {
      stats.unchanged++;
      continue;
    }

    const categories = classify(item);
    const [embedding] = await embedder.embed([embedText(item)]);
    const { id, isNew } = await store.upsertItem(item, { categories, embedding });

    if (isNew) {
      stats.inserted++;
      await store.appendStatusHistory(id, statusEntry(item));
      stats.historyAppended++;
    } else {
      stats.updated++;
      // Append history only when the status-relevant fields actually moved.
      if (!sig || statusChanged(sig, item)) {
        await store.appendStatusHistory(id, statusEntry(item));
        stats.historyAppended++;
      }
    }
  }

  await store.setCursor(client.key, nextCursor, now());
  return stats;
}
