/**
 * RedLine database schema — Drizzle (spec §6).
 *
 * This file mirrors the §6 SQL EXACTLY: same table/column names, types,
 * defaults, nullability, UNIQUE constraints and indexes. Every module codes
 * against the row types inferred here — it is the integration contract, so do
 * NOT drift from §6.
 *
 * pgvector: `CREATE EXTENSION IF NOT EXISTS vector` is run by db/migrate.ts
 * before the generated migrations; drizzle-kit only manages the tables below.
 *
 * EMBED_DIM: the spec hard-codes vector(1536) for the OpenAI default, but the
 * dimension MUST match whichever embedder is configured (OpenAI 3-small=1536 |
 * nomic-embed=768 | bge-small=384). We therefore read it from env().EMBED_DIM
 * (default 384, the OSS-clean bge-small default) so the column width and the
 * Embedder.dim never disagree. Both org_profiles.embedding and items.embedding
 * use this single source of truth.
 */
import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  date,
  vector,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";

/** Embedding dimension, sourced once from env so column width == embedder dim. */
const EMBED_DIM = env().EMBED_DIM;

// ── organizations ───────────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── org_profiles — the business profile, built from onboarding (§6, §10) ─────
export const orgProfiles = pgTable("org_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  // ['software','goods',...]
  businessTypes: text("business_types")
    .array()
    .notNull()
    .default(sql`'{}'`),
  // ['us','us-ca',...]
  jurisdictions: text("jurisdictions")
    .array()
    .notNull()
    .default(sql`'{}'`),
  // employees, has_1099, imports, serves_food, ...
  attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
  subscribedCategories: text("subscribed_categories")
    .array()
    .notNull()
    .default(sql`'{}'`),
  // generated; encodes positives AND negatives (§10)
  concernText: text("concern_text"),
  embedding: vector("embedding", { dimensions: EMBED_DIM }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── items — unified legislative/regulatory item (bills AND rules) (§6) ───────
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // congress | federal_register | regulations_gov | openstates
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    // 'us','us-ca',...
    jurisdiction: text("jurisdiction").notNull(),
    // bill | resolution | proposed_rule | final_rule | notice | docket
    type: text("type").notNull(),
    identifier: text("identifier"),
    title: text("title").notNull(),
    summary: text("summary"),
    fullTextUrl: text("full_text_url"),
    fullText: text("full_text"),
    status: text("status"),
    // normalized lifecycle bucket (see §2 Tracker)
    stage: text("stage"),
    introducedDate: date("introduced_date"),
    lastActionDate: timestamp("last_action_date", { withTimezone: true }),
    lastActionText: text("last_action_text"),
    commentCloseDate: date("comment_close_date"),
    sponsors: jsonb("sponsors").notNull().default(sql`'[]'::jsonb`),
    subjects: text("subjects")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // taxonomy tags (§9), set at ingest
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'`),
    raw: jsonb("raw").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // UNIQUE (source, external_id)
    unique("items_source_external_id_key").on(t.source, t.externalId),
    // CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops);
    index("items_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    // CREATE INDEX ON items USING gin (categories);
    index("items_categories_gin_idx").using("gin", t.categories),
    // CREATE INDEX ON items (jurisdiction, last_action_date DESC);
    index("items_jurisdiction_last_action_idx").on(t.jurisdiction, t.lastActionDate.desc()),
  ],
);

// ── item_status_history — append-only "no missed amendment" backbone (§6) ────
export const itemStatusHistory = pgTable("item_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id),
  status: text("status"),
  actionText: text("action_text"),
  actionDate: timestamp("action_date", { withTimezone: true }),
  raw: jsonb("raw"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── relevance_judgments — THE trust-tuning log: every decision, forever (§6) ─
export const relevanceJudgments = pgTable(
  "relevance_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    // category | prefilter | llm_judge
    stage: text("stage").notNull(),
    score: integer("score"),
    similarity: doublePrecision("similarity"),
    justification: text("justification"),
    matchedConcern: text("matched_concern"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    rubricVersion: text("rubric_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // CREATE INDEX ON relevance_judgments (org_id, created_at DESC);
    index("relevance_judgments_org_created_idx").on(t.orgId, t.createdAt.desc()),
  ],
);

// ── memos — cited memo; DRAFT until a human approves (approval gate) (§6, §8) ─
export const memos = pgTable("memos", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  judgmentId: uuid("judgment_id").references(() => relevanceJudgments.id),
  whatItDoes: text("what_it_does"),
  statusAndNextSteps: text("status_and_next_steps"),
  whoIsAffected: text("who_is_affected"),
  // comment | monitor | call_counsel | no_action
  recommendedAction: text("recommended_action"),
  recommendedActionNote: text("recommended_action_note"),
  // LABELED estimate + assumptions; NEVER a bare fabricated number (§15)
  impactEstimate: text("impact_estimate"),
  // [{claim,snippet,locator,verified}]
  citations: jsonb("citations").notNull().default(sql`'[]'::jsonb`),
  confidence: text("confidence"),
  model: text("model"),
  promptVersion: text("prompt_version"),
  // draft | approved | rejected | sent
  status: text("status").notNull().default("draft"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── tracked_items — followed items for the Tracker kanban (§6, §2) ───────────
export const trackedItems = pgTable(
  "tracked_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    note: text("note"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // UNIQUE (org_id, item_id)
    unique("tracked_items_org_item_key").on(t.orgId, t.itemId),
  ],
);

// ── relevance_feedback — 👍/👎 on flagged items → eval labels (§6, §8) ───────
export const relevanceFeedback = pgTable("relevance_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id),
  judgmentId: uuid("judgment_id").references(() => relevanceJudgments.id),
  userId: uuid("user_id").references(() => users.id),
  // relevant | not_relevant
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── audit_log — every state change, before/after (§6, §8 trust layer) ────────
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  // user uuid or 'system'
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── sync_state — per-source incremental cursor (§6, §7) ──────────────────────
export const syncState = pgTable("sync_state", {
  // PRIMARY KEY (source)
  source: text("source").primaryKey(),
  cursor: text("cursor"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

// ── Typed row helpers (inferSelect / inferInsert) ────────────────────────────
// Exported for every module that reads/writes these tables.
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type OrgProfile = typeof orgProfiles.$inferSelect;
export type NewOrgProfile = typeof orgProfiles.$inferInsert;

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

export type ItemStatusHistory = typeof itemStatusHistory.$inferSelect;
export type NewItemStatusHistory = typeof itemStatusHistory.$inferInsert;

export type RelevanceJudgment = typeof relevanceJudgments.$inferSelect;
export type NewRelevanceJudgment = typeof relevanceJudgments.$inferInsert;

export type Memo = typeof memos.$inferSelect;
export type NewMemo = typeof memos.$inferInsert;

export type TrackedItem = typeof trackedItems.$inferSelect;
export type NewTrackedItem = typeof trackedItems.$inferInsert;

export type RelevanceFeedback = typeof relevanceFeedback.$inferSelect;
export type NewRelevanceFeedback = typeof relevanceFeedback.$inferInsert;

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

/** All tables, for the migrate runner / introspection / tests. */
export const schema = {
  organizations,
  users,
  orgProfiles,
  items,
  itemStatusHistory,
  relevanceJudgments,
  memos,
  trackedItems,
  relevanceFeedback,
  auditLog,
  syncState,
} as const;
