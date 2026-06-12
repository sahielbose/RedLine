/**
 * Runtime settings resolver (spec §4). The single place that answers "which LLM
 * provider/key/model should we use right now?".
 *
 * Today it resolves from validated env. In Phase B a persisted, UI-managed store
 * (a server-side file, never exposed to the browser) layers ON TOP of env so a
 * user can paste their own Anthropic key in the dashboard and have it take effect
 * without editing .env or restarting — `getLLM()` already calls through here, so
 * that change is transparent to every caller.
 */
import { env } from "@/lib/env";

export type LLMProvider = "local" | "anthropic" | "ollama";

export interface ResolvedLLMConfig {
  provider: LLMProvider;
  anthropicApiKey?: string;
  anthropicModel: string;
  /** True when a usable Anthropic key is present (from settings or env). */
  hasAnthropicKey: boolean;
}

export function resolveLLMConfig(): ResolvedLLMConfig {
  const e = env();
  const anthropicApiKey = e.ANTHROPIC_API_KEY || undefined;
  return {
    provider: e.LLM_PROVIDER,
    anthropicApiKey,
    anthropicModel: e.ANTHROPIC_MODEL,
    hasAnthropicKey: Boolean(anthropicApiKey),
  };
}
