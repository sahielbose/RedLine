/**
 * FallbackLLM — resilience wrapper (spec §4 "documented local fallback", §8 trust).
 *
 * Tries a primary LLM (Claude/Ollama) and, if the call fails for ANY reason
 * (out of credits, bad key, rate limit, timeout, malformed output), transparently
 * falls back to a local engine (the deterministic HeuristicLLM) so the product
 * never hard-breaks. It records which engine actually answered and why it fell
 * back, so the UI can say "Claude unavailable — add credits" honestly and the
 * audit log (`relevance_judgments.model`) reflects the engine that really ran.
 *
 * `local` provider must stay PURE heuristic (no wrapper) to keep `npm run eval`
 * hermetic and free — see getLLM().
 */
import type { LLM } from "@/lib/interfaces";
import { classifyLLMError, type LLMErrorReason } from "@/lib/llmError";
import { HEURISTIC_MODEL } from "@/lib/adapters/heuristicLLM";

export interface FallbackEvent {
  used: "primary" | "fallback";
  /** Why we fell back (only set when used === "fallback"). */
  reason?: LLMErrorReason;
  /** User-facing one-liner (only set when used === "fallback"). */
  hint?: string;
  /** The model tag that actually produced the answer. */
  model: string;
}

function modelTag(llm: LLM): string {
  const m = (llm as { model?: unknown }).model;
  return typeof m === "string" && m.length > 0 ? m : "unknown";
}

export class FallbackLLM implements LLM {
  /** Reflects the engine that answered the MOST RECENT call (for audit logging). */
  model: string;
  private readonly primaryModel: string;

  constructor(
    private readonly primary: LLM,
    private readonly fallback: LLM,
    private readonly onEvent?: (e: FallbackEvent) => void,
  ) {
    this.primaryModel = modelTag(primary);
    this.model = this.primaryModel;
  }

  async json<T>(a: { system: string; user: string; schema: import("zod").ZodSchema<T>; model?: string }): Promise<T> {
    try {
      const r = await this.primary.json(a);
      this.model = a.model ?? this.primaryModel;
      this.onEvent?.({ used: "primary", model: this.model });
      return r;
    } catch (err) {
      const info = classifyLLMError(err);
      const fbModel = modelTag(this.fallback) || HEURISTIC_MODEL;
      this.model = fbModel;
      // eslint-disable-next-line no-console
      console.warn(`[LLM] primary failed (${info.reason}: ${info.message}); using local fallback.`);
      this.onEvent?.({ used: "fallback", reason: info.reason, hint: info.userHint, model: fbModel });
      return this.fallback.json(a);
    }
  }
}
