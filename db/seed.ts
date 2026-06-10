/**
 * Seed the four eval-anchor organizations + profiles (spec §10, §11).
 *
 * The four profiles — saas-remote, ecom-goods, food-cpg, hardware-maker — are
 * the horizontal-relevance matrix: the same rule is a five-alarm threat to one
 * and pure noise to another (spec §11). Their subscribed_categories are
 * BASE (all 8, every business shares them) + the business-type module(s):
 *   software → +software
 *   goods    → +goods
 *   food     → +food
 *   hardware → +hardware,+goods  (the hardware module includes everything in
 *              goods — customs/sales-tax/marketplace — per §9).
 *
 * Idempotent: upsert by organization name. Every write is wrapped in an
 * audit_log row (spec §8 trust layer). Embeddings are intentionally left null
 * here — the pipeline computes them from concern_text via the configured
 * Embedder (vector width = env().EMBED_DIM).
 *
 * Run via `npm run db:seed` (tsx db/seed.ts). This script connects (its job);
 * importing it does NOT connect — main() only runs when invoked directly.
 */
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@/lib/db";
import {
  organizations,
  orgProfiles,
  auditLog,
  type NewOrgProfile,
} from "@db/schema";
import { BASE_CATEGORIES, type Category, type BusinessType } from "@/lib/types";
import type { ProfileAttributes } from "@/lib/types";

const BASE: Category[] = [...BASE_CATEGORIES];

/** A seedable profile: an org name + its onboarding-derived profile fields. */
interface SeedProfile {
  /** Stable slug used as the organization name (the upsert key). */
  slug: string;
  displayName: string;
  businessTypes: BusinessType[];
  jurisdictions: string[];
  attributes: ProfileAttributes;
  subscribedCategories: Category[];
  concernText: string;
}

/** Dedupe + keep deterministic order: base first, then modules. */
function cats(...modules: Category[]): Category[] {
  return Array.from(new Set<Category>([...BASE, ...modules]));
}

export const SEED_PROFILES: SeedProfile[] = [
  {
    slug: "saas-remote",
    displayName: "Acme Remote SaaS",
    businessTypes: ["software"],
    jurisdictions: ["us", "us-ca"],
    attributes: {
      employees: 12,
      has_w2: true,
      has_1099_contractors: true,
      sells_subscription: true,
      imports_goods: false,
      sells_physical_goods: false,
      serves_food: false,
      collects_customer_data_online: true,
      data_from_children_under_13: false,
    },
    subscribedCategories: cats("software"),
    concernText:
      "Fully-remote B2B SaaS in CA, 12 W-2 staff + 1099 contractors, sells auto-renewing " +
      "subscriptions, collects customer data online. Hurt by changes to subscription/cancellation " +
      "rules, data privacy/breach notice, worker classification, overtime thresholds, mandated " +
      "benefits. Does NOT sell physical goods, import, or handle food.",
  },
  {
    slug: "ecom-goods",
    displayName: "Northwind E-Commerce",
    businessTypes: ["goods"],
    jurisdictions: ["us", "us-ny"],
    attributes: {
      employees: 25,
      has_w2: true,
      has_1099_contractors: true,
      sells_subscription: false,
      imports_goods: true,
      sells_physical_goods: true,
      sells_via_marketplace: true,
      serves_food: false,
      collects_customer_data_online: true,
      data_from_children_under_13: false,
    },
    subscribedCategories: cats("goods"),
    concernText:
      "E-commerce retailer in NY, 25 W-2 staff + 1099 contractors, sells physical goods online " +
      "and via third-party marketplaces, imports inventory from overseas. Hurt by changes to " +
      "import duties/customs (de minimis, tariffs), sales-tax nexus, marketplace-seller rules, " +
      "product labeling and packaging/EPR. Does NOT sell subscriptions, build regulated devices, " +
      "or handle food.",
  },
  {
    slug: "food-cpg",
    displayName: "Harvest Foods Co.",
    businessTypes: ["food"],
    jurisdictions: ["us", "us-tx"],
    attributes: {
      employees: 40,
      has_w2: true,
      has_1099_contractors: false,
      sells_subscription: false,
      imports_goods: false,
      sells_physical_goods: true,
      serves_food: true,
      // make/pack/hold = in FSMA 204 scope (NOT serve-only, which is exempt) §11 D
      food_supply_chain_role: "make_pack_hold",
      collects_customer_data_online: false,
      data_from_children_under_13: false,
    },
    subscribedCategories: cats("food"),
    concernText:
      "Food CPG maker in TX, 40 W-2 staff, manufactures, packs, holds and distributes packaged " +
      "food products to retailers. In FSMA 204 traceability scope. Hurt by changes to food safety " +
      "and traceability rules, food labeling, health permits. Does NOT sell subscriptions, build " +
      "devices, or import goods. A dine-in-only restaurant would be largely exempt — supply-chain " +
      "role (make/pack/hold) is what brings this business into scope.",
  },
  {
    slug: "hardware-maker",
    displayName: "Voltage Devices Inc.",
    businessTypes: ["hardware"],
    jurisdictions: ["us", "us-ca"],
    attributes: {
      employees: 18,
      has_w2: true,
      has_1099_contractors: true,
      sells_subscription: false,
      imports_goods: true,
      sells_physical_goods: true,
      sells_via_marketplace: false,
      serves_food: false,
      collects_customer_data_online: true,
      data_from_children_under_13: false,
    },
    // hardware module includes everything in goods (§9) → subscribe to both.
    subscribedCategories: cats("hardware", "goods"),
    concernText:
      "Hardware maker in CA, 18 W-2 staff + 1099 contractors, designs and builds an electronic " +
      "device, imports components and parts, sells direct-to-consumer. Hurt by changes to product " +
      "safety (CPSC), device/equipment authorization (FCC), energy efficiency (DOE), e-waste / " +
      "right-to-repair, import duties/customs (de minimis, tariffs), and sales-tax nexus. Does NOT " +
      "sell subscriptions or handle food.",
  },
];

/**
 * Idempotent upsert of one seed org + its profile, wrapped in audit_log writes.
 * Returns the organization id.
 */
async function upsertOrg(p: SeedProfile): Promise<string> {
  const db = getDb();

  // 1. Organization — upsert by name (the stable key).
  const existingOrg = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, p.slug))
    .limit(1);

  let orgId: string;
  if (existingOrg.length > 0) {
    orgId = existingOrg[0].id;
  } else {
    const [created] = await db
      .insert(organizations)
      .values({ name: p.slug })
      .returning();
    orgId = created.id;
    await db.insert(auditLog).values({
      orgId,
      actor: "system",
      action: "seed.org.create",
      entityType: "organization",
      entityId: orgId,
      before: null,
      after: { name: p.slug },
    });
  }

  // 2. Profile — one active profile per org; upsert by org_id.
  const profileValues: Omit<NewOrgProfile, "id" | "createdAt" | "embedding"> = {
    orgId,
    businessTypes: p.businessTypes,
    jurisdictions: p.jurisdictions,
    attributes: p.attributes,
    subscribedCategories: p.subscribedCategories,
    concernText: p.concernText,
    isActive: true,
  };

  const existingProfile = await db
    .select()
    .from(orgProfiles)
    .where(eq(orgProfiles.orgId, orgId))
    .limit(1);

  if (existingProfile.length > 0) {
    const before = existingProfile[0];
    const [after] = await db
      .update(orgProfiles)
      .set(profileValues)
      .where(eq(orgProfiles.id, before.id))
      .returning();
    await db.insert(auditLog).values({
      orgId,
      actor: "system",
      action: "seed.profile.update",
      entityType: "org_profile",
      entityId: before.id,
      before,
      after,
    });
  } else {
    const [after] = await db.insert(orgProfiles).values(profileValues).returning();
    await db.insert(auditLog).values({
      orgId,
      actor: "system",
      action: "seed.profile.create",
      entityType: "org_profile",
      entityId: after.id,
      before: null,
      after,
    });
  }

  return orgId;
}

async function main(): Promise<void> {
  console.log(`[seed] seeding ${SEED_PROFILES.length} eval orgs + profiles…`);
  for (const p of SEED_PROFILES) {
    const orgId = await upsertOrg(p);
    console.log(
      `[seed]   ✓ ${p.slug} (org ${orgId}) — ${p.subscribedCategories.length} categories: ` +
        p.subscribedCategories.join(", "),
    );
  }
  console.log("[seed] ✅ done.");
}

// Only connect when invoked directly (tsx db/seed.ts). Importing stays hermetic.
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error("[seed] ❌ seed failed:", err);
      process.exitCode = 1;
      await closeDb();
    });
}
