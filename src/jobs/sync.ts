/**
 * One-shot sync runner (the human-invoked entrypoint Phase 4 left as a TODO).
 *
 *   npm run ingest   — pull a recent window of real bills/rules from the live
 *                      APIs (Federal Register needs no key; Congress + Open
 *                      States use the api.data.gov / pluralpolicy keys in .env)
 *                      → normalize → upsert → status_history → classify → embed.
 *   npm run score    — score every active org profile against the ingested items
 *                      (Stage 0/A/B), log judgments, draft memos. Uses whatever
 *                      LLM_PROVIDER is set (anthropic = real Claude, cheapest model).
 *   npm run sync     — ingest, then score.
 *
 * Requires the DB up + migrated (npm run db:up && npm run db:migrate && npm run db:seed).
 * Real data only — no fabrication anywhere in the pipeline.
 */
import { defaultDeps, ingestSource, scoreActiveProfiles } from "@/jobs/handlers";
import { closeDb } from "@/lib/db";
import { sourceIsLiveReady } from "@/sources";
import type { Source } from "@/lib/types";

const SOURCES: Source[] = ["federal_register", "congress", "openstates"];

async function ingestAll() {
  const deps = defaultDeps();
  const totals = { fetched: 0, inserted: 0, updated: 0, unchanged: 0 };
  for (const key of SOURCES) {
    if (!sourceIsLiveReady(key)) {
      console.log(`[sync] skip ${key} — no API key set`);
      continue;
    }
    const started = Date.now();
    try {
      const stats = await ingestSource(deps, key);
      if (stats) {
        totals.fetched += stats.fetched;
        totals.inserted += stats.inserted;
        totals.updated += stats.updated;
        totals.unchanged += stats.unchanged;
        console.log(
          `[sync] ${key}: fetched ${stats.fetched}, +${stats.inserted} new, ~${stats.updated} updated, ${stats.unchanged} unchanged (${Date.now() - started}ms)`,
        );
      }
    } catch (err) {
      console.error(`[sync] ${key} FAILED:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[sync] ingest totals:`, totals);
}

async function scoreAll() {
  const deps = defaultDeps();
  console.log(`[sync] scoring active profiles via ${deps.llm.constructor.name}…`);
  const summary = await scoreActiveProfiles(deps);
  console.log(`[sync] score:`, summary);
}

async function main() {
  const mode = process.argv[2] ?? "sync";
  if (mode === "ingest" || mode === "sync") await ingestAll();
  if (mode === "score" || mode === "sync") await scoreAll();
  await closeDb();
  console.log("[sync] done.");
}

main().catch((err) => {
  console.error("[sync] fatal:", err);
  process.exit(1);
});
