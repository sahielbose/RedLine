/**
 * Runtime settings resolver + store (spec §4, §15 secrets).
 *
 * The single place that answers "which LLM provider/key/model should we use right
 * now?". A persisted, UI-managed store (a server-side JSON file, mode 0600, never
 * committed, never sent to the browser) layers ON TOP of validated env, so a user
 * can paste their own Anthropic key in the dashboard and have it take effect
 * immediately - `getLLM()` resolves through here on every call, so the change is
 * transparent to every caller (pipeline, search, jobs) with no restart.
 *
 * Precedence: stored setting (UI)  >  env (.env)  >  built-in default.
 * The raw key NEVER leaves the server: API responses expose only a masked tail
 * and a `hasKey` flag (see getSafeSettings / maskKey).
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export type LLMProvider = "local" | "anthropic" | "ollama";

export type DigestCadence = "daily" | "weekly";

export interface StoredSettings {
  llmProvider?: LLMProvider;
  anthropicApiKey?: string;
  anthropicModel?: string;
  digestCadence?: DigestCadence;
  commentDeadlineAlerts?: boolean;
  digestRecipient?: string;
  updatedAt?: string;
}

export interface AlertConfig {
  cadence: DigestCadence;
  commentDeadlineAlerts: boolean;
  recipient: string;
}

export interface ResolvedLLMConfig {
  provider: LLMProvider;
  anthropicApiKey?: string;
  anthropicModel: string;
  /** True when a usable Anthropic key is present (from settings or env). */
  hasAnthropicKey: boolean;
}

/** Browser-safe projection of settings - no raw secrets, ever. */
export interface SafeSettings {
  provider: LLMProvider;
  model: string;
  hasAnthropicKey: boolean;
  /** e.g. "sk-ant-…a1b2" or null. */
  anthropicKeyTail: string | null;
  /** Where the active key comes from. */
  keySource: "settings" | "env" | "none";
  /** Read-only status of the other configured subsystems. */
  status: {
    congressKey: boolean;
    openStatesKey: boolean;
    database: boolean;
    smtp: boolean;
  };
  /** Delivery + alert preferences. */
  alerts: AlertConfig;
  updatedAt: string | null;
}

const SETTINGS_DIR = path.join(process.cwd(), ".data");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");

// Cached in memory; invalidated on every write so runtime changes apply at once.
let cache: StoredSettings | null = null;

function loadStored(): StoredSettings {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as StoredSettings;
  } catch {
    cache = {};
  }
  return cache;
}

/** Merge a patch into the store. Empty string clears a field (falls back to env). */
export function saveStored(patch: Partial<StoredSettings>): StoredSettings {
  const current = loadStored();
  const next: StoredSettings = { ...current };
  for (const [k, v] of Object.entries(patch) as [keyof StoredSettings, unknown][]) {
    if (v === "" || v === undefined || v === null) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  next.updatedAt = new Date().toISOString();
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  cache = next;
  return next;
}

/** Delivery + alert preferences (stored, with safe defaults). */
export function getAlertConfig(): AlertConfig {
  const s = loadStored();
  return {
    cadence: s.digestCadence ?? "daily",
    commentDeadlineAlerts: s.commentDeadlineAlerts ?? true,
    recipient: s.digestRecipient ?? "",
  };
}

export function resolveLLMConfig(): ResolvedLLMConfig {
  const e = env();
  const s = loadStored();
  const anthropicApiKey = s.anthropicApiKey || e.ANTHROPIC_API_KEY || undefined;
  return {
    provider: s.llmProvider ?? e.LLM_PROVIDER,
    anthropicApiKey,
    anthropicModel: s.anthropicModel || e.ANTHROPIC_MODEL,
    hasAnthropicKey: Boolean(anthropicApiKey),
  };
}

/** "sk-ant-…a1b2" - never reveals the full key. */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  const tail = key.slice(-4);
  const head = key.startsWith("sk-ant") ? "sk-ant-" : key.slice(0, 3);
  return `${head}…${tail}`;
}

export function getSafeSettings(): SafeSettings {
  const e = env();
  const s = loadStored();
  const cfg = resolveLLMConfig();
  const keySource: SafeSettings["keySource"] = s.anthropicApiKey
    ? "settings"
    : e.ANTHROPIC_API_KEY
      ? "env"
      : "none";
  return {
    provider: cfg.provider,
    model: cfg.anthropicModel,
    hasAnthropicKey: cfg.hasAnthropicKey,
    anthropicKeyTail: maskKey(cfg.anthropicApiKey),
    keySource,
    status: {
      congressKey: Boolean(e.CONGRESS_API_KEY),
      openStatesKey: Boolean(e.OPENSTATES_API_KEY),
      database: Boolean(e.DATABASE_URL),
      smtp: Boolean(e.SMTP_URL),
    },
    alerts: getAlertConfig(),
    updatedAt: s.updatedAt ?? null,
  };
}

/** The Claude models offered in the Settings picker (latest + cost tiers). */
export const ANTHROPIC_MODELS: { id: string; label: string; note: string }[] = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", note: "Most capable" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "Balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fastest / cheapest" },
];
