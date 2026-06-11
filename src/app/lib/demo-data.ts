/**
 * Seeded demo dataset for the dashboard (spec §2, §12). Lets the whole app —
 * including the signature "Viewing as" re-scoring and the US threat map — run
 * with ZERO keys/DB via the local heuristic judge + hash embedder.
 *
 * All copy is ORIGINAL / paraphrased (clone the idea, not anyone's brand — spec
 * §15). Federal anchors mirror the verified eval items (§11); state items are
 * paraphrased, plausible illustrations spanning several states so the map shades
 * differently per business. Provenance strings are sourced framings, never
 * invented figures; no fabricated dollar amounts or vote predictions anywhere.
 */
import { BASE_CATEGORIES, type BusinessProfile } from "@/lib/types";

export interface DemoItem {
  id: string;
  source: "congress" | "federal_register" | "openstates";
  jurisdiction: string; // 'us' | 'us-ca' | 'us-tx' | ...
  type: "bill" | "resolution" | "proposed_rule" | "final_rule" | "notice";
  identifier: string;
  agency?: string | null;
  title: string;
  summary: string;
  full_text: string;
  categories: string[];
  status: string;
  stage: "proposed" | "comment_open" | "finalized" | "in_effect" | "contested_vacated";
  last_action_date: string;
  comment_close_date?: string | null;
  /** Sourced framing shown on the THREAT card — never an invented figure. */
  provenance?: string;
  /** Official public portal for the ACTION card (no PII; portals only). */
  action_url?: string;
  /** Marks items added in the last sync window (NEW badge). */
  is_new?: boolean;
}

// ── The four business profiles (mirror the eval profiles, spec §10) ──────────
const BASE = BASE_CATEGORIES; // the 8 base categories, as typed literals

export const DEMO_PROFILES: Array<BusinessProfile & { label: string }> = [
  {
    id: "saas-remote",
    org_id: "org-saas",
    label: "Northwind SaaS",
    business_types: ["software"],
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
    subscribed_categories: [...BASE, "software"],
    concern_text:
      "Fully-remote B2B SaaS in CA, 12 W-2 staff + 1099 contractors, sells auto-renewing subscriptions, collects customer data online. Hurt by changes to subscription/cancellation rules, data privacy/breach notice, worker classification, overtime thresholds, mandated benefits. Does NOT sell physical goods, import, or handle food.",
    embedding: null,
  },
  {
    id: "ecom-goods",
    org_id: "org-ecom",
    label: "Harbor Goods Co.",
    business_types: ["goods"],
    jurisdictions: ["us", "us-ca", "us-tx", "us-ny"],
    attributes: {
      employees: 30,
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
    subscribed_categories: [...BASE, "goods"],
    concern_text:
      "E-commerce seller of physical goods, imports inventory, sells on third-party marketplaces, ships nationwide from TX. Hurt by import duties/customs, sales-tax nexus, marketplace-seller rules, product labeling, wages/overtime, worker classification. Does NOT sell subscriptions or handle food.",
    embedding: null,
  },
  {
    id: "food-cpg",
    org_id: "org-food",
    label: "Cedar Pantry Foods",
    business_types: ["food"],
    jurisdictions: ["us", "us-ca", "us-il"],
    attributes: {
      employees: 45,
      has_w2: true,
      has_1099_contractors: false,
      sells_subscription: false,
      imports_goods: true,
      sells_physical_goods: true,
      sells_via_marketplace: false,
      serves_food: true,
      food_supply_chain_role: "make_pack_hold",
      collects_customer_data_online: false,
      data_from_children_under_13: false,
    },
    subscribed_categories: [...BASE, "food"],
    concern_text:
      "Packaged-food maker that manufactures, packs, and holds listed foods, imports some ingredients, distributes to retailers from IL. Hurt by food-safety/traceability (FSMA), labeling, health permits, wages/overtime, workplace safety. Does NOT sell subscriptions or sell via marketplaces.",
    embedding: null,
  },
  {
    id: "hardware-maker",
    org_id: "org-hw",
    label: "Ironwood Devices",
    business_types: ["hardware", "goods"],
    jurisdictions: ["us", "us-ca", "us-wa"],
    attributes: {
      employees: 22,
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
    subscribed_categories: [...BASE, "hardware", "goods"],
    concern_text:
      "Builds a connected hardware device, imports electronic parts, sells direct-to-consumer from WA. Hurt by import duties/customs, FCC equipment authorization, product safety (CPSC), energy efficiency, e-waste/right-to-repair, wages/overtime, worker classification. Does NOT sell subscriptions or handle food.",
    embedding: null,
  },
];

// ── Items: 4 federal anchors + state-level illustrations across many states ──
export const DEMO_ITEMS: DemoItem[] = [
  // Federal anchors (mirror §11; affect every state as a national baseline).
  {
    id: "fr-de-minimis",
    source: "federal_register",
    jurisdiction: "us",
    type: "notice",
    identifier: "FR-2025-EO-321",
    agency: "Customs and Border Protection",
    title: "Suspension of de minimis duty-free treatment for imports",
    summary:
      "Duty-free de minimis (Section 321) treatment is suspended; affected imports owe duties and require full customs entry.",
    full_text:
      "This action suspends duty-free de minimis treatment for imported goods. Affected shipments now require full customs entry and owe applicable duties regardless of value.",
    categories: ["goods", "hardware"],
    status: "Executive action in effect",
    stage: "in_effect",
    last_action_date: "2025-08-29",
    provenance:
      "Began as a China/Hong Kong-specific suspension, then extended to all origins — a pattern other trade actions have followed.",
    action_url: "https://www.federalregister.gov/",
    is_new: true,
  },
  {
    id: "fr-click-to-cancel",
    source: "federal_register",
    jurisdiction: "us",
    type: "proposed_rule",
    identifier: "FR-2026-ANPRM-NEGOPT",
    agency: "Federal Trade Commission",
    title: "Negative option / click-to-cancel rulemaking (restarted)",
    summary:
      "The FTC restarted its negative-option rulemaking after the prior rule was vacated; it would standardize subscription enrollment and cancellation.",
    full_text:
      "This advance notice restarts a rulemaking on negative-option marketing. It would require clear disclosures, consent, and a simple cancellation mechanism for recurring subscriptions.",
    categories: ["software", "data_privacy"],
    status: "Comment period open",
    stage: "comment_open",
    last_action_date: "2026-01-30",
    comment_close_date: "2026-04-13",
    provenance: "The 2024 rule was vacated on procedural grounds; state auto-renewal laws still apply.",
    action_url: "https://www.regulations.gov/",
    is_new: true,
  },
  {
    id: "fr-fsma-204",
    source: "federal_register",
    jurisdiction: "us",
    type: "final_rule",
    identifier: "FR-2025-14967",
    agency: "Food and Drug Administration",
    title: "Food traceability recordkeeping (FSMA 204) — compliance date extended",
    summary:
      "Additional traceability recordkeeping for listed foods; the compliance date was extended. Applies to those who manufacture, process, pack, or hold listed foods.",
    full_text:
      "This rule establishes additional traceability recordkeeping for foods on the Food Traceability List. The compliance date is extended. It applies to persons who manufacture, process, pack, or hold listed foods; dine-in-only operations are largely outside its scope.",
    categories: ["food"],
    status: "Finalized; compliance date extended",
    stage: "finalized",
    last_action_date: "2026-01-20",
    action_url: "https://www.federalregister.gov/",
  },
  {
    id: "fr-boi",
    source: "federal_register",
    jurisdiction: "us",
    type: "final_rule",
    identifier: "FR-2025-BOI-IR",
    agency: "Financial Crimes Enforcement Network",
    title: "Beneficial ownership information reporting (interim rule)",
    summary:
      "Beneficial-ownership reporting under the Corporate Transparency Act; an interim rule narrowed who must report, with a final rule pending.",
    full_text:
      "This interim rule addresses beneficial ownership information reporting for entities. It narrows the set of reporting companies; a final rule is pending.",
    categories: ["licensing_registration"],
    status: "Interim rule; final pending",
    stage: "finalized",
    last_action_date: "2025-03-26",
    action_url: "https://www.federalregister.gov/",
  },
  // Federal DOL contractor rule (base; affects 1099 profiles).
  {
    id: "fr-ic-rule",
    source: "federal_register",
    jurisdiction: "us",
    type: "proposed_rule",
    identifier: "FR-2026-DOL-IC",
    agency: "Department of Labor",
    title: "Independent-contractor classification standard",
    summary:
      "Proposed changes to how workers are classified as employees vs. independent contractors under federal wage-and-hour law.",
    full_text:
      "This proposed rule revises the standard for determining whether a worker is an employee or an independent contractor for wage-and-hour purposes, weighing economic-reality factors.",
    categories: ["classification_scheduling"],
    status: "Comment period open",
    stage: "comment_open",
    last_action_date: "2026-02-18",
    comment_close_date: "2026-05-01",
    action_url: "https://www.regulations.gov/",
    is_new: true,
  },
  // ── State items (light up specific states differently per profile) ──────────
  {
    id: "ca-privacy-amend",
    source: "openstates",
    jurisdiction: "us-ca",
    type: "bill",
    identifier: "CA-AB-1043",
    title: "California consumer data privacy amendments",
    summary:
      "Amends California consumer-privacy obligations: expanded deletion rights and tighter breach-notice timelines for businesses collecting personal data online.",
    full_text:
      "This bill amends consumer data privacy law to expand deletion and opt-out rights and shorten the window for notifying consumers of a data breach. It applies to businesses that collect personal data online.",
    categories: ["data_privacy", "software"],
    status: "Referred to committee",
    stage: "proposed",
    last_action_date: "2026-03-04",
    provenance: "Tracks language seen in several other state privacy bills this session.",
    action_url: "https://www.legislature.ca.gov/",
    is_new: true,
  },
  {
    id: "ca-fast-food-wage",
    source: "openstates",
    jurisdiction: "us-ca",
    type: "bill",
    identifier: "CA-SB-702",
    title: "California minimum wage and scheduling update",
    summary:
      "Raises the state minimum wage schedule and adds predictive-scheduling notice requirements for certain employers.",
    full_text:
      "This bill increases the state minimum wage on a phased schedule and requires advance notice of work schedules for covered employers, with premium pay for last-minute changes.",
    categories: ["wages_hours", "classification_scheduling"],
    status: "Passed first chamber",
    stage: "finalized",
    last_action_date: "2026-02-20",
    action_url: "https://www.legislature.ca.gov/",
  },
  {
    id: "tx-sales-tax-nexus",
    source: "openstates",
    jurisdiction: "us-tx",
    type: "bill",
    identifier: "TX-HB-892",
    title: "Texas marketplace sales-tax collection",
    summary:
      "Clarifies sales-tax collection and remittance obligations for remote sellers and marketplace facilitators shipping into Texas.",
    full_text:
      "This bill clarifies the economic-nexus thresholds and remittance duties for remote sellers and marketplace facilitators making sales into the state.",
    categories: ["goods", "taxes"],
    status: "Committee hearing scheduled",
    stage: "proposed",
    last_action_date: "2026-03-01",
    provenance: "Mirrors a measure that became law in another state last year.",
    action_url: "https://capitol.texas.gov/",
    is_new: true,
  },
  {
    id: "wa-right-to-repair",
    source: "openstates",
    jurisdiction: "us-wa",
    type: "bill",
    identifier: "WA-HB-2089",
    title: "Washington electronics right-to-repair",
    summary:
      "Would require makers of consumer electronics to provide parts, tools, and documentation for independent repair.",
    full_text:
      "This bill requires manufacturers of consumer electronic devices to make available, on fair terms, the parts, tools, and documentation needed to diagnose and repair their products.",
    categories: ["hardware", "goods"],
    status: "Referred to committee",
    stage: "proposed",
    last_action_date: "2026-02-27",
    action_url: "https://leg.wa.gov/",
    is_new: true,
  },
  {
    id: "ny-marketplace-inform",
    source: "openstates",
    jurisdiction: "us-ny",
    type: "bill",
    identifier: "NY-SB-445",
    title: "New York high-volume marketplace seller disclosures",
    summary:
      "Adds verification and disclosure requirements for high-volume third-party sellers on online marketplaces.",
    full_text:
      "This bill requires online marketplaces to verify and disclose information about high-volume third-party sellers, complementing federal marketplace-seller requirements.",
    categories: ["goods"],
    status: "In committee",
    stage: "proposed",
    last_action_date: "2026-01-22",
    action_url: "https://www.nysenate.gov/",
  },
  {
    id: "il-food-labeling",
    source: "openstates",
    jurisdiction: "us-il",
    type: "bill",
    identifier: "IL-HB-1117",
    title: "Illinois packaged-food labeling and allergen rules",
    summary:
      "Adds state labeling and allergen-disclosure requirements for packaged foods manufactured or sold in the state.",
    full_text:
      "This bill establishes additional labeling and allergen-disclosure requirements for packaged foods that are manufactured, packed, or sold within the state.",
    categories: ["food"],
    status: "Referred to committee",
    stage: "proposed",
    last_action_date: "2026-02-11",
    action_url: "https://www.ilga.gov/",
    is_new: true,
  },
  {
    id: "co-privacy-kids",
    source: "openstates",
    jurisdiction: "us-co",
    type: "bill",
    identifier: "CO-SB-678",
    title: "Colorado age-appropriate design / children's data",
    summary:
      "Imposes additional duties on online services likely to be accessed by children, including data-minimization defaults.",
    full_text:
      "This bill requires online services likely to be accessed by minors to apply data-minimization and high-privacy defaults for younger users.",
    categories: ["data_privacy", "software"],
    status: "Introduced",
    stage: "proposed",
    last_action_date: "2026-01-15",
    action_url: "https://leg.colorado.gov/",
  },
  {
    id: "ga-overtime",
    source: "openstates",
    jurisdiction: "us-ga",
    type: "bill",
    identifier: "GA-SB-210",
    title: "Georgia overtime and meal-break standards",
    summary:
      "Sets state overtime and meal-break standards for hourly employees above the federal floor.",
    full_text:
      "This bill establishes state overtime eligibility and meal-and-rest-break standards for hourly employees, above the federal baseline.",
    categories: ["wages_hours"],
    status: "Introduced",
    stage: "proposed",
    last_action_date: "2026-02-02",
    action_url: "https://www.legis.ga.gov/",
  },
  // A pure decoy (no module match for anyone) — proves precision in the feed.
  {
    id: "fmcsa-hos",
    source: "federal_register",
    jurisdiction: "us",
    type: "proposed_rule",
    identifier: "FR-2026-FMCSA-HOS",
    agency: "Federal Motor Carrier Safety Administration",
    title: "Motor carrier hours-of-service adjustment",
    summary:
      "Adjusts hours-of-service limits for commercial motor-vehicle drivers at interstate trucking carriers.",
    full_text:
      "This proposed rule adjusts the maximum on-duty and driving hours for commercial motor-vehicle drivers operating for interstate motor carriers.",
    categories: [],
    status: "Comment period open",
    stage: "comment_open",
    last_action_date: "2026-02-25",
    comment_close_date: "2026-05-20",
    action_url: "https://www.regulations.gov/",
  },
];
