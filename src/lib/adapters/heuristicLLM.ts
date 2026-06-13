/**
 * HeuristicLLM - the documented hermetic local fallback (spec §4, §15).
 *
 * Implements the `LLM` interface with ZERO external calls so the pipeline + eval
 * harness run green with no secrets and no model server. It is deterministic:
 *
 *   • For a JudgeResult-shaped schema, it recovers {profile,item} from a
 *     <DATA>…</DATA> JSON block embedded in the user message and returns
 *     `heuristicJudge(profile,item)` - the same general rubric scorer the real
 *     models are asked to emulate.
 *
 *   • For a memo-shaped schema, it builds a GROUNDED template memo from the
 *     <DATA> (no fabricated numbers; impact_estimate=null; citations built only
 *     from verbatim substrings of the provided text - CODE-verifiable later).
 *
 *   • Otherwise it best-effort produces a schema-valid object so callers never
 *     crash in the hermetic path.
 *
 * The model name surfaced for logging is `heuristic-local`.
 */
import type { ZodSchema } from "zod";
import { z } from "zod";

import type { LLM } from "@/lib/interfaces";
import {
  JudgeResultSchema,
  type BusinessProfile,
  type Citation,
  type MemoContent,
} from "@/lib/types";
import { heuristicJudge, type JudgeableItem } from "@/pipeline/relevance";

export const HEURISTIC_MODEL = "heuristic-local";

/** Extract and parse the first <DATA>…</DATA> JSON block from a prompt. */
function extractData(user: string): unknown | null {
  const m = user.match(/<DATA>([\s\S]*?)<\/DATA>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

/** Does this schema look like the JudgeResult contract? (cheap structural probe) */
function isJudgeSchema(schema: ZodSchema<unknown>): boolean {
  const probe = { score: 3, justification: "probe", matched_concern: null };
  // The judge schema accepts the probe; most others (e.g. memo) reject it.
  return schema.safeParse(probe).success && !schema.safeParse({}).success;
}

/** Pick the first verbatim sentence-ish snippet (<= ~20 words) from source text. */
function firstSnippet(text: string, maxWords = 18): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  const words = sentence.split(" ");
  return words.length <= maxWords ? sentence : words.slice(0, maxWords).join(" ");
}

/** Shape of the data block the judge prompt embeds. */
interface JudgeData {
  profile: BusinessProfile;
  item: JudgeableItem;
}

/**
 * Build a grounded, fabrication-free template memo. Every claim cites a verbatim
 * substring of the source text so `verifyMemoCitations` (CODE) can confirm it.
 */
function buildTemplateMemo(data: JudgeData): MemoContent {
  const { profile, item } = data;
  const sourceText = item.full_text ?? item.summary ?? item.title ?? "";
  const snippet = firstSnippet(sourceText);
  const citations: Citation[] = snippet
    ? [{ claim: "Summary of the item as stated by the source.", snippet, locator: item.identifier ?? null, verified: false }]
    : [];

  return {
    what_it_does: item.summary
      ? `Per the source: ${item.summary}`
      : `Regulatory item "${item.title}".`,
    status_and_next_steps:
      "See the item's status history for the latest action and any comment-period deadline; no dates are asserted here unless present in the source.",
    who_is_affected: `Businesses of type ${profile.business_types.join(", ") || "general operator"} sharing the item's regulatory categories.`,
    recommended_action: "monitor",
    recommended_action_note: "Monitor the item and consult counsel before changing operations.",
    // NEVER a fabricated figure (spec §15).
    impact_estimate: null,
    citations,
    confidence: "low",
  };
}

export class HeuristicLLM implements LLM {
  readonly model = HEURISTIC_MODEL;

  async json<T>(a: { system: string; user: string; schema: ZodSchema<T>; model?: string }): Promise<T> {
    const data = extractData(a.user);

    // ── Judge path ──────────────────────────────────────────────────────────
    if (isJudgeSchema(a.schema as ZodSchema<unknown>)) {
      if (data && typeof data === "object" && "profile" in data && "item" in data) {
        const jd = data as JudgeData;
        const result = heuristicJudge(jd.profile, jd.item);
        return a.schema.parse(result);
      }
      // No data → conservative low score (don't fabricate relevance).
      return a.schema.parse({
        score: 0,
        justification: "No structured profile/item data was provided to the local heuristic judge.",
        matched_concern: null,
      });
    }

    // ── Memo path (data present) ──────────────────────────────────────────────
    if (data && typeof data === "object" && "profile" in data && "item" in data) {
      const memo = buildTemplateMemo(data as JudgeData);
      const candidate = a.schema.safeParse(memo);
      if (candidate.success) return candidate.data;
    }

    // ── Generic fallback: emit a minimal schema-valid object ──────────────────
    const empty = a.schema.safeParse({});
    if (empty.success) return empty.data;
    // Last resort: surface a clear, deterministic error rather than fabricate.
    throw new Error(
      "HeuristicLLM: could not produce a schema-valid response for the requested call shape. " +
        "Embed a <DATA>{profile,item}</DATA> block for judge/memo schemas.",
    );
  }
}

/** Exported for adapters that want to reuse the judge-schema probe. */
export const __probe = { isJudgeSchema, JudgeResultSchema, z };
