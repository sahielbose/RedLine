/**
 * Typed, validated environment access. Everything has a safe default so the
 * pipeline + evals run green with zero secrets (local fallbacks). Server-only.
 */
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("postgres://redline:redline@localhost:5433/redline"),

  LLM_PROVIDER: z.enum(["local", "anthropic", "ollama"]).default("local"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),

  EMBEDDER: z.enum(["hash", "local", "ollama", "api"]).default("hash"),
  EMBED_DIM: z.coerce.number().int().positive().default(384),
  EMBED_API_URL: z.string().optional(),
  EMBED_API_KEY: z.string().optional(),
  EMBED_API_MODEL: z.string().default("text-embedding-3-small"),

  CONGRESS_API_KEY: z.string().optional(),
  REGULATIONS_API_KEY: z.string().optional(),
  OPENSTATES_API_KEY: z.string().optional(),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("redline@example.com"),

  AUTH_SECRET: z.string().optional(),

  MEMO_THRESHOLD: z.coerce.number().int().min(0).max(5).default(4),
  PREFILTER_LIMIT: z.coerce.number().int().positive().default(50),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}
