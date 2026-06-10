/**
 * LLM factory (spec §4, §7). Selects an `LLM` adapter from env:
 *   LLM_PROVIDER=local     → HeuristicLLM  (default; hermetic, zero secrets)
 *   LLM_PROVIDER=anthropic → AnthropicLLM  (Claude via @anthropic-ai/sdk)
 *   LLM_PROVIDER=ollama    → OllamaLLM     (fully self-hosted local model)
 *
 * The default is `local` so the pipeline + eval harness run green with no keys.
 * `modelName(llm)` returns a stable model tag for `relevance_judgments` logging.
 */
import { env } from "@/lib/env";
import type { LLM } from "@/lib/interfaces";
import { AnthropicLLM } from "@/lib/adapters/anthropicLLM";
import { HeuristicLLM, HEURISTIC_MODEL } from "@/lib/adapters/heuristicLLM";
import { OllamaLLM } from "@/lib/adapters/ollamaLLM";

export function getLLM(): LLM {
  switch (env().LLM_PROVIDER) {
    case "anthropic":
      return new AnthropicLLM();
    case "ollama":
      return new OllamaLLM();
    case "local":
    default:
      return new HeuristicLLM();
  }
}

/** Best-effort stable model tag for audit logging (relevance_judgments.model). */
export function modelName(llm: LLM): string {
  const m = (llm as { model?: unknown }).model;
  if (typeof m === "string" && m.length > 0) return m;
  return HEURISTIC_MODEL;
}

export { HeuristicLLM, AnthropicLLM, OllamaLLM };
