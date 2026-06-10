/**
 * RedLine shared domain types — the integration contract (spec §6, §9, §10).
 * Every module (sources, pipeline, evals, app) codes against these. Don't drift.
 */
import { z } from "zod";

// ── Sources & item shape (spec §5, §6) ──────────────────────────────────────
export const SOURCES = ["congress", "federal_register", "regulations_gov", "openstates"] as const;
export type Source = (typeof SOURCES)[number];

export const ITEM_TYPES = [
  "bill",
  "resolution",
  "proposed_rule",
  "final_rule",
  "notice",
  "docket",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Normalized legislative lifecycle bucket — drives the Tracker kanban (spec §2). */
export const STAGES = [
  "proposed",
  "comment_open",
  "finalized",
  "in_effect",
  "contested_vacated",
] as const;
export type Stage = (typeof STAGES)[number];

// ── Taxonomy (spec §9) ──────────────────────────────────────────────────────
export const BASE_CATEGORIES = [
  "wages_hours",
  "leave_benefits",
  "classification_scheduling",
  "licensing_registration",
  "taxes",
  "data_privacy",
  "workplace_safety",
  "accessibility",
] as const;
export type BaseCategory = (typeof BASE_CATEGORIES)[number];

/** Module categories double as the business-type toggles (spec §9, §10). */
export const MODULE_CATEGORIES = ["software", "goods", "food", "hardware"] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export const CATEGORIES = [...BASE_CATEGORIES, ...MODULE_CATEGORIES] as const;
export type Category = (typeof CATEGORIES)[number];

export type BusinessType = ModuleCategory;

export function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s);
}

// ── Business profile (spec §6 org_profiles, §10 onboarding) ─────────────────
/**
 * Structured onboarding answers. Negatives matter: they make the judge REJECT
 * off-target rules (spec §10). Known keys are typed; the index signature keeps
 * the profile extensible without breaking the contract.
 */
export interface ProfileAttributes {
  employees?: number;
  has_w2?: boolean;
  has_1099_contractors?: boolean;
  sells_subscription?: boolean;
  imports_goods?: boolean;
  sells_physical_goods?: boolean;
  sells_via_marketplace?: boolean;
  serves_food?: boolean;
  /** 'make_pack_hold' is in FSMA scope; 'serve_only' is largely exempt (spec §11 D). */
  food_supply_chain_role?: "make_pack_hold" | "serve_only" | "distribute" | null;
  collects_customer_data_online?: boolean;
  data_from_children_under_13?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

export interface BusinessProfile {
  id: string;
  org_id: string;
  business_types: BusinessType[];
  jurisdictions: string[]; // ['us','us-ca',...]
  attributes: ProfileAttributes;
  subscribed_categories: Category[];
  concern_text: string;
  embedding?: number[] | null;
  is_active?: boolean;
}

// ── Normalized item emitted by a SourceClient (pre-upsert) ──────────────────
// categories[] and embedding are derived at ingest by the pipeline, not the source.
export interface NormalizedItem {
  source: Source;
  external_id: string;
  jurisdiction: string;
  type: ItemType;
  identifier: string | null;
  title: string;
  summary: string | null;
  full_text_url: string | null;
  full_text?: string | null;
  status: string | null;
  stage: Stage | null;
  introduced_date: string | null; // ISO date
  last_action_date: string | null; // ISO datetime
  last_action_text: string | null;
  comment_close_date: string | null; // ISO date
  sponsors: unknown[];
  subjects: string[];
  raw: unknown;
  content_hash: string;
}

// ── Stage B judge result — validated by Zod, logged to relevance_judgments ──
export const RUBRIC_VERSION = "v1";
export const PROMPT_VERSION = "v1";

export const JudgeResultSchema = z.object({
  score: z.number().int().min(0).max(5),
  justification: z.string().min(1),
  matched_concern: z.string().nullable(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export type PipelineStage = "category" | "prefilter" | "llm_judge";

export interface Judgment extends JudgeResult {
  stage: PipelineStage;
  similarity?: number | null;
  model: string;
  prompt_version: string;
  rubric_version: string;
}

// ── Memo (spec §6 memos, §7 memo generator) ─────────────────────────────────
export const RECOMMENDED_ACTIONS = ["comment", "monitor", "call_counsel", "no_action"] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export interface Citation {
  claim: string;
  snippet: string;
  locator: string | null;
  /** Set by CODE (whitespace-normalized substring check), never trusted from the model. */
  verified: boolean;
}

export interface MemoContent {
  what_it_does: string;
  status_and_next_steps: string;
  who_is_affected: string;
  recommended_action: RecommendedAction;
  recommended_action_note: string | null;
  /** LABELED estimate + assumptions, or empty. NEVER a bare fabricated number (spec §15). */
  impact_estimate: string | null;
  citations: Citation[];
  confidence: "low" | "medium" | "high";
}

export type MemoStatus = "draft" | "approved" | "rejected" | "sent";

// ── Severity presentation (spec §2 Bills feed, §12) ─────────────────────────
export type SeverityLabel = "Critical" | "High" | "Monitor" | "Low";

export function severityLabel(score: number): SeverityLabel {
  if (score >= 5) return "Critical";
  if (score >= 4) return "High";
  if (score >= 3) return "Monitor";
  return "Low";
}
