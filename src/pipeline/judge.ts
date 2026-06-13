/**
 * Stage B - LLM rubric judge orchestrator (spec §7).
 *
 * Builds the SYSTEM + USER rubric prompt, embeds the profile + item as a
 * <DATA>…</DATA> JSON block (so the hermetic HeuristicLLM can recover them and
 * real models get full structured context), calls `llm.json(...,
 * JudgeResultSchema)`, and returns a `Judgment` stamped with stage / model /
 * prompt_version / rubric_version for `relevance_judgments` logging (spec §6).
 *
 * No DB access here (that's Phase 2 wiring); an optional `onJudgment` callback
 * lets a caller persist or log the result.
 */
import type { LLM } from "@/lib/interfaces";
import { modelName } from "@/lib/llm";
import {
  JudgeResultSchema,
  PROMPT_VERSION,
  RUBRIC_VERSION,
  type BusinessProfile,
  type Judgment,
} from "@/lib/types";
import type { JudgeableItem } from "@/pipeline/relevance";

/** The Stage-B system prompt (spec §7; mirror of docs/PROMPTS.md, versioned). */
export const JUDGE_SYSTEM = `You score how much one legislative/regulatory item threatens or affects ONE business. Judge ONLY on what the item says. Don't assume provisions not present. If too vague to assess, score low and say so. Never invent section numbers. Output ONLY JSON.
Rubric 0-5:
 5 Direct material impact - new obligations/costs/restrictions on this org's core ops, action now.
 4 Clearly relevant - regulates this org's activities; would likely require a change or position.
 3 Sector-adjacent - touches the broader sector; monitor.
 2 Weak/indirect - affects industry only via suppliers/customers, not the org.
 1 Background noise - shares keywords, different context.
 0 Irrelevant.
Return JSON: {"score":int,"justification":"one concrete sentence naming the provision/reason","matched_concern":"which profile element, or null"}`;

/** Build the USER message: a human-readable framing + the machine-readable DATA. */
export function buildJudgeUser(profile: BusinessProfile, item: JudgeableItem): string {
  const profileView = {
    business_types: profile.business_types,
    jurisdictions: profile.jurisdictions,
    attributes: profile.attributes,
    subscribed_categories: profile.subscribed_categories,
    concern_text: profile.concern_text,
  };
  const itemView = {
    jurisdiction: item.jurisdiction ?? null,
    type: item.type ?? null,
    identifier: item.identifier ?? null,
    title: item.title,
    summary: item.summary ?? null,
    agency: item.agency ?? item.source ?? null,
    categories: item.categories ?? null,
    excerpt: (item.full_text ?? item.summary ?? "").slice(0, 1200) || null,
  };

  return [
    "Score this item for this business using the rubric.",
    "",
    "PROFILE:",
    JSON.stringify(profileView, null, 2),
    "",
    "ITEM:",
    JSON.stringify(itemView, null, 2),
    "",
    // Machine-readable block: the hermetic judge reads this; real models ignore it.
    `<DATA>${JSON.stringify({ profile, item })}</DATA>`,
  ].join("\n");
}

export interface JudgeArgs {
  profile: BusinessProfile;
  item: JudgeableItem;
  llm: LLM;
  /** Optional callback for logging/persisting the judgment (Phase 2). */
  onJudgment?: (j: Judgment) => void | Promise<void>;
}

/** Run Stage B for one (profile, item) pair and return a stamped Judgment. */
export async function judge(args: JudgeArgs): Promise<Judgment> {
  const { profile, item, llm, onJudgment } = args;
  const user = buildJudgeUser(profile, item);

  const result = await llm.json({
    system: JUDGE_SYSTEM,
    user,
    schema: JudgeResultSchema,
  });

  const judgment: Judgment = {
    ...result,
    stage: "llm_judge",
    model: modelName(llm),
    prompt_version: PROMPT_VERSION,
    rubric_version: RUBRIC_VERSION,
  };

  if (onJudgment) await onJudgment(judgment);
  return judgment;
}
