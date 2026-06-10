/**
 * Memo generator (spec §7, §8, §15). For an item the judge scored >= threshold:
 * build the structured-memo prompt → LLM → VERIFY every citation is a real
 * substring of the source (CODE, not the model) → enforce no-fabrication →
 * return a DRAFT memo (approval gate: nothing sends without a human).
 *
 * Guardrails enforced in code, not just the prompt:
 *  - citations dropped unless they verify against the source text;
 *  - impact_estimate is nulled if it reads as a bare unlabeled figure.
 */
import type { LLM } from "@/lib/interfaces";
import { modelName } from "@/lib/llm";
import { verifyMemoCitations } from "@/lib/citations";
import {
  MemoContentSchema,
  PROMPT_VERSION,
  type BusinessProfile,
  type MemoContent,
  type MemoStatus,
} from "@/lib/types";
import type { JudgeableItem } from "@/pipeline/relevance";

export const MEMO_SYSTEM = `You write a short, plain-English regulatory memo for ONE small business about ONE legislative/regulatory item. Four parts: what_it_does, status_and_next_steps, who_is_affected, recommended_action.
Rules (hard):
- Judge ONLY on what the source says. Do not assume provisions not present.
- Cite claims with VERBATIM snippets copied from the provided source text. Never invent a snippet or a section number.
- NEVER fabricate a dollar figure, probability, or vote count. impact_estimate is either a clearly-labeled estimate WITH its assumptions, or null. Default to null.
- recommended_action is one of: comment, monitor, call_counsel, no_action.
- Output ONLY JSON matching the schema.`;

/** Build the memo USER message (framing + item text + machine-readable DATA). */
export function buildMemoUser(profile: BusinessProfile, item: JudgeableItem): string {
  const profileView = {
    business_types: profile.business_types,
    jurisdictions: profile.jurisdictions,
    attributes: profile.attributes,
    concern_text: profile.concern_text,
  };
  const sourceText = item.full_text ?? item.summary ?? item.title ?? "";
  const itemView = {
    jurisdiction: item.jurisdiction ?? null,
    type: item.type ?? null,
    identifier: item.identifier ?? null,
    title: item.title,
    agency: item.agency ?? item.source ?? null,
    source_text: sourceText.slice(0, 6000),
  };

  return [
    "Write the memo for this business about this item, citing only verbatim source snippets.",
    "",
    "PROFILE:",
    JSON.stringify(profileView, null, 2),
    "",
    "ITEM:",
    JSON.stringify(itemView, null, 2),
    "",
    `<DATA>${JSON.stringify({ profile, item })}</DATA>`,
  ].join("\n");
}

/** Source text a memo's citations are checked against. */
export function memoSourceText(item: JudgeableItem): string {
  return item.full_text ?? item.summary ?? item.title ?? "";
}

/**
 * Null out an impact_estimate that carries a numeric figure WITHOUT stating its
 * assumptions — i.e. a fabricated "hero number" (spec §15 / CLAUDE.md rule 7,
 * which require a labeled estimate WITH its assumptions, or empty).
 *
 * Strict by design: a figure survives ONLY if the text also states assumptions
 * (the "assum" stem — assumptions/assuming/assume). Merely sitting next to a soft
 * word like "if"/"range"/"~" is NOT enough (that bypass is why this was
 * tightened). "Figure" covers digits, currency, percent, and spelled-out
 * magnitudes (thousand/million/billion/…). Purely qualitative text is kept.
 */
export function sanitizeImpactEstimate(estimate: string | null): string | null {
  if (!estimate) return null;
  const hasFigure =
    /[$€£]/.test(estimate) ||
    /\d/.test(estimate) ||
    /\b(percent|hundred|thousand|million|billion|trillion)\b/i.test(estimate);
  if (!hasFigure) return estimate; // qualitative-only impact is fine
  const statesAssumptions = /\bassum/i.test(estimate); // assumptions / assuming / assume
  return statesAssumptions ? estimate : null;
}

export interface MemoDraft {
  content: MemoContent;
  status: MemoStatus; // always 'draft' from this generator (approval gate)
  model: string;
  prompt_version: string;
}

export interface GenerateMemoArgs {
  profile: BusinessProfile;
  item: JudgeableItem;
  llm: LLM;
}

/** Generate a DRAFT memo with code-verified citations and no fabricated figures. */
export async function generateMemo(args: GenerateMemoArgs): Promise<MemoDraft> {
  const { profile, item, llm } = args;
  const raw = await llm.json({
    system: MEMO_SYSTEM,
    user: buildMemoUser(profile, item),
    schema: MemoContentSchema,
  });

  // CODE verifies citations against the source (drops unverifiable ones).
  const verified = verifyMemoCitations(raw, memoSourceText(item));
  const content: MemoContent = {
    ...verified,
    impact_estimate: sanitizeImpactEstimate(verified.impact_estimate),
  };

  return {
    content,
    status: "draft", // approval gate — never auto-approved/sent
    model: modelName(llm),
    prompt_version: PROMPT_VERSION,
  };
}
