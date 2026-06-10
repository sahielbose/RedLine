/**
 * RedLine regulation taxonomy + tagging rules (spec §9).
 *
 * The category SETS themselves live in the shared contract (`@/lib/types`) — we
 * import them here, never redefine them. This module adds:
 *   1. TAGGING_RULES — a declarative map of agency/keyword signals → categories,
 *      used by Stage 0 classification (recall-first; tag generously).
 *   2. businessTypesToSubscribedCategories — base ∪ module categories a profile
 *      subscribes to, derived from its business_types (spec §9, §10).
 *
 * Why declarative rules and not a model: Stage 0 must be cheap, deterministic,
 * and auditable against the eval set (spec §7, §15). A small LLM classifier can
 * be layered on later behind the same `classifyItem` surface.
 */
import {
  BASE_CATEGORIES,
  MODULE_CATEGORIES,
  type BaseCategory,
  type BusinessType,
  type Category,
  type ModuleCategory,
} from "@/lib/types";

// Re-export the canonical sets so downstream code can pull taxonomy from one place.
export { BASE_CATEGORIES, MODULE_CATEGORIES };
export type { BaseCategory, ModuleCategory, Category };

/**
 * A single tagging rule. A rule fires when ANY of its `keywords` appears in the
 * normalized (lowercased) signal text (title + summary + agency/source), OR when
 * the item's source/agency matches one of `agencies`. When it fires it attaches
 * every category in `categories`.
 *
 * Rules are intentionally OR-ed and additive — we tag generously and let the
 * Stage-B judge (and the per-category gates in `relevance.ts`) do the precision
 * work. A missed tag is a silent recall loss (spec §7 warning), so err toward
 * over-tagging here.
 */
export interface TaggingRule {
  /** Stable id for debugging / eval auditing. */
  id: string;
  /** Human note: what real-world signal this encodes. */
  note: string;
  /** Lowercased substrings to look for in the signal text. */
  keywords: string[];
  /** Agency / source tokens (lowercased) that also trigger this rule. */
  agencies?: string[];
  /** Categories attached when the rule fires. */
  categories: Category[];
}

/**
 * The tagging rule set (spec §9). Keyword lists are lowercased; matching is a
 * normalized substring test. Ordering does not matter — all firing rules union.
 */
export const TAGGING_RULES: readonly TaggingRule[] = [
  // ── BASE: classification / scheduling ────────────────────────────────────
  {
    id: "dol-classification",
    note: "DOL worker classification / independent contractor / overtime → wages + classification",
    agencies: ["dol", "department of labor", "wage and hour"],
    keywords: [
      "independent contractor",
      "worker classification",
      "misclassification",
      "1099",
      "gig worker",
      "employee classification",
    ],
    categories: ["classification_scheduling", "wages_hours"],
  },
  {
    id: "wages-overtime",
    note: "Overtime / minimum wage / scheduling → wages_hours",
    agencies: ["dol", "department of labor"],
    keywords: [
      "overtime",
      "minimum wage",
      "predictive scheduling",
      "fair workweek",
      "exempt salary threshold",
      "tipped wage",
    ],
    categories: ["wages_hours"],
  },
  // ── BASE: leave / benefits ───────────────────────────────────────────────
  {
    id: "leave-benefits",
    note: "Paid leave / sick leave / mandated benefits → leave_benefits",
    keywords: [
      "paid leave",
      "paid sick",
      "family leave",
      "medical leave",
      "mandated benefit",
      "retirement mandate",
    ],
    categories: ["leave_benefits"],
  },
  // ── BASE: licensing / registration (the universal base item) ─────────────
  {
    id: "fincen-bonership",
    note: "FinCEN beneficial-ownership / Corporate Transparency Act → licensing_registration (every incorporated business)",
    agencies: ["fincen", "financial crimes enforcement network", "treasury"],
    keywords: [
      "beneficial ownership",
      "corporate transparency act",
      "reporting company",
      "boi report",
      "entity registration",
    ],
    categories: ["licensing_registration"],
  },
  {
    id: "licensing-general",
    note: "Business license / permit / registration → licensing_registration",
    keywords: ["business license", "registration requirement", "permit requirement", "annual report filing"],
    categories: ["licensing_registration"],
  },
  // ── BASE: taxes ──────────────────────────────────────────────────────────
  {
    id: "taxes",
    note: "Sales-tax / nexus / corporate tax → taxes (and goods nexus)",
    agencies: ["irs", "department of revenue"],
    keywords: ["sales tax", "tax nexus", "economic nexus", "corporate tax", "franchise tax", "use tax"],
    categories: ["taxes"],
  },
  // ── BASE: data privacy (+ COPPA crosses into software) ───────────────────
  {
    id: "data-privacy",
    note: "Consumer privacy / data breach notice → data_privacy",
    keywords: [
      "data privacy",
      "consumer privacy",
      "data breach",
      "breach notification",
      "personal information",
      "biometric",
    ],
    categories: ["data_privacy"],
  },
  {
    id: "coppa-children",
    note: "Children's online privacy (COPPA) → data_privacy + software. Keyword-gated: the FTC owns many subtopics, so the agency token alone can't disambiguate.",
    keywords: ["coppa", "children's online privacy", "children under 13", "child's personal information"],
    categories: ["data_privacy", "software"],
  },
  // ── BASE: workplace safety ───────────────────────────────────────────────
  {
    id: "workplace-safety",
    note: "OSHA / workplace safety → workplace_safety",
    agencies: ["osha", "occupational safety"],
    keywords: ["workplace safety", "occupational safety", "heat illness", "hazard communication"],
    categories: ["workplace_safety"],
  },
  // ── BASE: accessibility ──────────────────────────────────────────────────
  {
    id: "accessibility",
    note: "ADA / web accessibility → accessibility",
    keywords: ["accessibility", "ada compliance", "wcag", "web content accessibility"],
    categories: ["accessibility"],
  },
  // ── MODULE software: subscriptions / auto-renewal / AI / UDAP ────────────
  {
    id: "ftc-negative-option",
    note: "FTC click-to-cancel / negative option / auto-renewal → software. Keyword-gated (the FTC also owns COPPA, INFORM, UDAP).",
    keywords: [
      "negative option",
      "auto-renewal",
      "automatic renewal",
      "click-to-cancel",
      "click to cancel",
      "rosca",
      "subscription cancellation",
      "recurring subscription",
    ],
    categories: ["software"],
  },
  {
    id: "software-ai-udap",
    note: "Consumer-protection / AI / UDAP for software products → software",
    keywords: ["unfair or deceptive", "udap", "dark pattern", "automated decision", "algorithmic"],
    categories: ["software"],
  },
  // ── MODULE goods/hardware: customs / import / tariff (THE HEADLINE) ───────
  {
    id: "cbp-import-deminimis",
    note: "CBP de minimis / Section 321 / tariff / customs entry → goods + hardware",
    agencies: ["cbp", "customs and border protection", "u.s. customs"],
    keywords: [
      "de minimis",
      "section 321",
      "tariff",
      "customs entry",
      "import duties",
      "import duty",
      "duty-free",
      "duty free",
    ],
    categories: ["goods", "hardware"],
  },
  // ── MODULE goods: marketplace seller rules / INFORM Act ───────────────────
  {
    id: "inform-marketplace",
    note: "INFORM Consumers Act / marketplace seller verification → goods. Keyword-gated (FTC is multi-purpose).",
    keywords: ["inform consumers act", "marketplace seller", "online marketplace", "high-volume third-party seller"],
    categories: ["goods"],
  },
  {
    id: "goods-labeling-epr",
    note: "Product labeling / packaging / EPR → goods",
    keywords: ["product labeling", "packaging", "extended producer responsibility", "epr", "recyclability"],
    categories: ["goods"],
  },
  // ── MODULE food: FSMA / traceability / labeling / permits ─────────────────
  {
    id: "fda-fsma-traceability",
    note: "FDA FSMA / food traceability / recordkeeping → food",
    agencies: ["fda", "food and drug administration"],
    keywords: [
      "fsma",
      "food safety modernization",
      "food traceability",
      "traceability rule",
      "section 204",
      "food traceability list",
      "preventive controls",
    ],
    categories: ["food"],
  },
  {
    id: "food-labeling-permits",
    note: "Food labeling / health permits / alcohol licensing → food",
    keywords: ["food labeling", "nutrition labeling", "health permit", "alcohol license", "cottage food"],
    categories: ["food"],
  },
  // ── MODULE hardware: CPSC / FCC / DOE / e-waste ───────────────────────────
  {
    id: "fcc-equipment-auth",
    note: "FCC equipment authorization / Covered List → hardware",
    agencies: ["fcc", "federal communications commission"],
    keywords: ["equipment authorization", "covered list", "radiofrequency", "rf device", "supply chain order"],
    categories: ["hardware"],
  },
  {
    id: "cpsc-product-safety",
    note: "CPSC product safety / recalls → hardware",
    agencies: ["cpsc", "consumer product safety commission"],
    keywords: ["product safety", "consumer product safety", "recall", "lithium battery safety"],
    categories: ["hardware"],
  },
  {
    id: "doe-energy-ewaste",
    note: "DOE energy efficiency / e-waste / right-to-repair → hardware",
    agencies: ["doe", "department of energy"],
    keywords: ["energy efficiency", "energy conservation standard", "e-waste", "right to repair", "right-to-repair"],
    categories: ["hardware"],
  },
] as const;

/**
 * Map a profile's business_types to the full set of subscribed categories
 * (spec §9: subscribed = BASE ∪ selected MODULES). Every business carries the
 * full base layer as an employer/operator; modules toggle on extra categories.
 *
 * Hardware implies goods (spec §9: "plus everything in `goods`").
 */
export function businessTypesToSubscribedCategories(types: readonly BusinessType[]): Category[] {
  const set = new Set<Category>(BASE_CATEGORIES);
  for (const t of types) {
    set.add(t);
    // hardware is a superset of goods (spec §9).
    if (t === "hardware") set.add("goods");
  }
  return [...set];
}
