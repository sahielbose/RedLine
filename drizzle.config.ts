import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://redline:redline@localhost:5433/redline",
  },
  // pgvector extension is created in the first migration; drizzle-kit only manages tables.
  verbose: true,
  strict: true,
});
