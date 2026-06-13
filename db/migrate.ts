/**
 * Migration runner (spec §6). Run via `npm run db:migrate` (tsx db/migrate.ts).
 *
 * Order matters:
 *   1. CREATE EXTENSION IF NOT EXISTS vector  - pgvector must exist before any
 *      generated migration tries to create a `vector(...)` column or hnsw index.
 *      drizzle-kit only manages tables, so this guard lives here.
 *   2. Apply the SQL drizzle-kit generated into db/migrations via the
 *      node-postgres migrator.
 *
 * This script connects (that's its job). It is NOT imported by app/test code,
 * so it never breaks the hermetic import path.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.join(__dirname, "migrations");

async function main(): Promise<void> {
  const { DATABASE_URL } = env();
  console.log("[migrate] connecting to database…");
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  try {
    console.log("[migrate] ensuring pgvector extension (CREATE EXTENSION IF NOT EXISTS vector)…");
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

    console.log(`[migrate] applying migrations from ${MIGRATIONS_FOLDER} …`);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    console.log("[migrate] ✅ migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] ❌ migration failed:", err);
  process.exitCode = 1;
});
