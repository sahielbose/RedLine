/**
 * LLM factory (spec §4, §7). Selects an `LLM` adapter from the resolved runtime
 * config (a UI-supplied key/model/provider overrides env — see lib/settings):
 *   provider=local     → HeuristicLLM  (default; hermetic, zero secrets)
 *   provider=anthropic → AnthropicLLM wrapped in FallbackLLM (Claude → local)
 *   provider=ollama    → OllamaLLM wrapped in FallbackLLM (local model → heuristic)
 *
 * `local` stays a PURE heuristic with no wrapper so `npm run eval` is hermetic
 * and free. `anthropic`/`ollama` are wrapped so a credit/key/rate failure
 * degrades to the local engine instead of breaking the request.
 * `modelName(llm)` returns a stable model tag for `relevance_judgments` logging.
 */
import { resolveLLMConfig } from "@/lib/settings";
import type { LLM } from "@/lib/interfaces";
import { AnthropicLLM } from "@/lib/adapters/anthropicLLM";
import { HeuristicLLM, HEURISTIC_MODEL } from "@/lib/adapters/heuristicLLM";
import { OllamaLLM } from "@/lib/adapters/ollamaLLM";
import { FallbackLLM, type FallbackEvent } from "@/lib/adapters/fallbackLLM";

/** Optional sink so a caller (e.g. /api/search) can report which engine ran. */
export function getLLM(onEvent?: (e: FallbackEvent) => void): LLM {
  const cfg = resolveLLMConfig();
  switch (cfg.provider) {
    case "anthropic":
      return new FallbackLLM(
        new AnthropicLLM({ apiKey: cfg.anthropicApiKey, model: cfg.anthropicModel }),
        new HeuristicLLM(),
        onEvent,
      );
    case "ollama":
      return new FallbackLLM(new OllamaLLM(), new HeuristicLLM(), onEvent);
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
