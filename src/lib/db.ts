/**
 * Singleton Drizzle client over a node-postgres Pool (spec §6).
 *
 * Lazy + hermetic: importing this module must NOT open a connection. The Pool
 * is created on first access (node-postgres pools connect lazily on first
 * query, not at construction), and we cache it across hot reloads via a global
 * so dev/serverless don't leak pools. typecheck/tests stay green with no DB.
 */
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import { schema } from "@db/schema";

type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

/**
 * A query executor: the top-level Database OR a transaction handle. Functions
 * that must run a mutation and its audit row atomically accept this, so callers
 * can pass `tx` inside `db.transaction(async (tx) => …)`.
 */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Globals survive Next.js / tsx hot reloads so we reuse one pool. */
const globalForDb = globalThis as unknown as {
  __redlinePool?: Pool;
  __redlineDb?: Database;
};

/**
 * The shared connection Pool. Created on first call - constructing a pg.Pool
 * does NOT connect; the first query does. Safe to call at import time.
 */
export function getPool(): Pool {
  if (!globalForDb.__redlinePool) {
    globalForDb.__redlinePool = new Pool({ connectionString: env().DATABASE_URL });
  }
  return globalForDb.__redlinePool;
}

/** The shared Drizzle client. Lazily bound to the pool on first access. */
export function getDb(): Database {
  if (!globalForDb.__redlineDb) {
    globalForDb.__redlineDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__redlineDb;
}

/**
 * Convenience proxies so callers can `import { db, pool } from '@/lib/db'` and
 * use them like values. Access is deferred to first use via the Proxy traps,
 * which keeps module import side-effect-free (no connection at import time).
 */
export const db: Database = new Proxy({} as Database, {
  get(_t, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
}) as Database;

export const pool: Pool = new Proxy({} as Pool, {
  get(_t, prop, receiver) {
    return Reflect.get(getPool() as object, prop, receiver);
  },
}) as Pool;

/** Close the pool (tests / graceful shutdown). No-op if never opened. */
export async function closeDb(): Promise<void> {
  if (globalForDb.__redlinePool) {
    await globalForDb.__redlinePool.end();
    globalForDb.__redlinePool = undefined;
    globalForDb.__redlineDb = undefined;
  }
}
