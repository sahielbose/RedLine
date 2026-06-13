/**
 * Hermetic schema tests (spec §6, §10, §11).
 *
 * These assert STRUCTURAL facts only - table objects, key columns, the seed
 * profiles' category math - with NO Postgres connection. Importing @db/schema
 * and @db/seed must not open a socket (env() has safe defaults; seed's main()
 * only runs on direct invocation), so this stays green in CI with no DB.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
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
  schema,
} from "@db/schema";
import { SEED_PROFILES } from "@db/seed";
import { BASE_CATEGORIES, CATEGORIES, isCategory } from "@/lib/types";
import { env } from "@/lib/env";

/** column-name set for a Drizzle table (the SQL column names, not JS keys). */
function colNames(table: Parameters<typeof getTableColumns>[0]): Set<string> {
  return new Set(Object.values(getTableColumns(table)).map((c) => c.name));
}

describe("schema - all §6 tables exist", () => {
  it("exports every §6 table", () => {
    expect(organizations).toBeDefined();
    expect(users).toBeDefined();
    expect(orgProfiles).toBeDefined();
    expect(items).toBeDefined();
    expect(itemStatusHistory).toBeDefined();
    expect(relevanceJudgments).toBeDefined();
    expect(memos).toBeDefined();
    expect(trackedItems).toBeDefined();
    expect(relevanceFeedback).toBeDefined();
    expect(auditLog).toBeDefined();
    expect(syncState).toBeDefined();
  });

  it("the schema bundle has all 11 tables", () => {
    expect(Object.keys(schema)).toHaveLength(11);
  });
});

describe("schema - key columns match §6 SQL", () => {
  it("organizations has id, name, created_at", () => {
    const c = colNames(organizations);
    for (const col of ["id", "name", "created_at"]) expect(c.has(col)).toBe(true);
  });

  it("users has org_id, email, role", () => {
    const c = colNames(users);
    for (const col of ["id", "org_id", "email", "role", "created_at"]) {
      expect(c.has(col)).toBe(true);
    }
  });

  it("org_profiles has the onboarding-derived columns + embedding", () => {
    const c = colNames(orgProfiles);
    for (const col of [
      "id",
      "org_id",
      "business_types",
      "jurisdictions",
      "attributes",
      "subscribed_categories",
      "concern_text",
      "embedding",
      "is_active",
      "created_at",
    ]) {
      expect(c.has(col)).toBe(true);
    }
  });

  it("items has the unified bill/rule columns incl. categories + embedding", () => {
    const c = colNames(items);
    for (const col of [
      "id",
      "source",
      "external_id",
      "jurisdiction",
      "type",
      "identifier",
      "title",
      "summary",
      "full_text_url",
      "full_text",
      "status",
      "stage",
      "introduced_date",
      "last_action_date",
      "last_action_text",
      "comment_close_date",
      "sponsors",
      "subjects",
      "categories",
      "raw",
      "content_hash",
      "embedding",
      "first_seen_at",
      "last_synced_at",
      "updated_at",
    ]) {
      expect(c.has(col)).toBe(true);
    }
  });

  it("item_status_history is the append-only backbone", () => {
    const c = colNames(itemStatusHistory);
    for (const col of ["id", "item_id", "status", "action_text", "action_date", "raw", "recorded_at"]) {
      expect(c.has(col)).toBe(true);
    }
  });

  it("relevance_judgments logs stage/score/versions", () => {
    const c = colNames(relevanceJudgments);
    for (const col of [
      "id",
      "item_id",
      "org_id",
      "stage",
      "score",
      "similarity",
      "justification",
      "matched_concern",
      "model",
      "prompt_version",
      "rubric_version",
      "created_at",
    ]) {
      expect(c.has(col)).toBe(true);
    }
  });

  it("memos has the structured-memo + approval-gate columns", () => {
    const c = colNames(memos);
    for (const col of [
      "id",
      "item_id",
      "org_id",
      "judgment_id",
      "what_it_does",
      "status_and_next_steps",
      "who_is_affected",
      "recommended_action",
      "recommended_action_note",
      "impact_estimate",
      "citations",
      "confidence",
      "model",
      "prompt_version",
      "status",
      "approved_by",
      "approved_at",
      "created_at",
    ]) {
      expect(c.has(col)).toBe(true);
    }
  });

  it("tracked_items / relevance_feedback / audit_log / sync_state have their keys", () => {
    expect(colNames(trackedItems).has("note")).toBe(true);
    expect(colNames(relevanceFeedback).has("label")).toBe(true);
    const audit = colNames(auditLog);
    for (const col of ["actor", "action", "entity_type", "entity_id", "before", "after"]) {
      expect(audit.has(col)).toBe(true);
    }
    const sync = colNames(syncState);
    for (const col of ["source", "cursor", "last_run_at"]) expect(sync.has(col)).toBe(true);
  });
});

describe("schema - nullability / NOT NULL invariants from §6", () => {
  function col(table: Parameters<typeof getTableColumns>[0], name: string) {
    const found = Object.values(getTableColumns(table)).find((c) => c.name === name);
    expect(found, `column ${name} should exist`).toBeDefined();
    return found!;
  }

  it("memos.status is NOT NULL and defaults to draft (approval gate §8)", () => {
    const status = col(memos, "status");
    expect(status.notNull).toBe(true);
    expect(status.hasDefault).toBe(true);
  });

  it("items.title and items.content_hash are NOT NULL", () => {
    expect(col(items, "title").notNull).toBe(true);
    expect(col(items, "content_hash").notNull).toBe(true);
  });

  it("items.summary is nullable", () => {
    expect(col(items, "summary").notNull).toBe(false);
  });

  it("audit_log.org_id is nullable (system events have no org)", () => {
    expect(col(auditLog, "org_id").notNull).toBe(false);
  });
});

describe("schema - embedding width tracks env().EMBED_DIM", () => {
  it("items.embedding and org_profiles.embedding use the configured dimension", () => {
    const dim = env().EMBED_DIM;
    // The vector column carries its dimension in column.size / .dimensions.
    const itemEmbedding = Object.values(getTableColumns(items)).find((c) => c.name === "embedding");
    const profileEmbedding = Object.values(getTableColumns(orgProfiles)).find(
      (c) => c.name === "embedding",
    );
    expect(itemEmbedding).toBeDefined();
    expect(profileEmbedding).toBeDefined();
    // Drizzle exposes the vector dimension as `dimensions` on the column.
    const itemDim = (itemEmbedding as unknown as { dimensions?: number }).dimensions;
    const profileDim = (profileEmbedding as unknown as { dimensions?: number }).dimensions;
    expect(itemDim).toBe(dim);
    expect(profileDim).toBe(dim);
  });
});

describe("seed profiles - the four §10/§11 eval profiles", () => {
  it("seeds exactly the four expected slugs", () => {
    const slugs = SEED_PROFILES.map((p) => p.slug).sort();
    expect(slugs).toEqual(["ecom-goods", "food-cpg", "hardware-maker", "saas-remote"]);
  });

  it("every profile subscribes to ALL 8 base categories (every business shares them)", () => {
    for (const p of SEED_PROFILES) {
      for (const base of BASE_CATEGORIES) {
        expect(p.subscribedCategories, `${p.slug} missing base cat ${base}`).toContain(base);
      }
    }
  });

  it("every subscribed category is a valid taxonomy category", () => {
    for (const p of SEED_PROFILES) {
      for (const c of p.subscribedCategories) {
        expect(isCategory(c), `${p.slug} has invalid category ${c}`).toBe(true);
      }
    }
  });

  it("each profile's business_types toggle on the right module category", () => {
    const bySlug = Object.fromEntries(SEED_PROFILES.map((p) => [p.slug, p]));

    // saas-remote = base + software (the §10 example)
    expect(bySlug["saas-remote"].businessTypes).toEqual(["software"]);
    expect(bySlug["saas-remote"].subscribedCategories).toContain("software");
    expect(bySlug["saas-remote"].subscribedCategories).not.toContain("goods");
    expect(bySlug["saas-remote"].subscribedCategories).not.toContain("food");

    // ecom-goods = base + goods
    expect(bySlug["ecom-goods"].businessTypes).toEqual(["goods"]);
    expect(bySlug["ecom-goods"].subscribedCategories).toContain("goods");
    expect(bySlug["ecom-goods"].subscribedCategories).not.toContain("software");

    // food-cpg = base + food, in FSMA make/pack/hold scope (§11 D)
    expect(bySlug["food-cpg"].businessTypes).toEqual(["food"]);
    expect(bySlug["food-cpg"].subscribedCategories).toContain("food");
    expect(bySlug["food-cpg"].attributes.food_supply_chain_role).toBe("make_pack_hold");

    // hardware-maker = base + hardware + goods (hardware module includes goods, §9)
    expect(bySlug["hardware-maker"].businessTypes).toEqual(["hardware"]);
    expect(bySlug["hardware-maker"].subscribedCategories).toContain("hardware");
    expect(bySlug["hardware-maker"].subscribedCategories).toContain("goods");
  });

  it("the horizontal-relevance matrix is asserted by category subscription (§11 C)", () => {
    // Import de minimis (C) is `goods`,`hardware`: ecom-goods + hardware-maker
    // subscribe to goods; saas-remote does NOT - so Stage 0 filters it out for
    // SaaS. This is the headline acceptance fact, encoded at the data layer.
    const bySlug = Object.fromEntries(SEED_PROFILES.map((p) => [p.slug, p]));
    expect(bySlug["ecom-goods"].subscribedCategories).toContain("goods");
    expect(bySlug["hardware-maker"].subscribedCategories).toContain("goods");
    expect(bySlug["saas-remote"].subscribedCategories).not.toContain("goods");
    expect(bySlug["food-cpg"].subscribedCategories).not.toContain("goods");
  });

  it("no profile invents a category outside the taxonomy", () => {
    const valid = new Set<string>(CATEGORIES);
    for (const p of SEED_PROFILES) {
      for (const c of p.subscribedCategories) expect(valid.has(c)).toBe(true);
    }
  });
});
