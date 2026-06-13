/**
 * The shared interfaces (spec §7). These are the integration points every
 * module codes against - kept verbatim from the spec. Adapters live in
 * src/lib/adapters/ behind these; each has a documented local fallback.
 */
import type { ZodSchema } from "zod";
import type { NormalizedItem, Source } from "./types";

export interface SourceClient {
  key: Source;
  /** Poll "changed since cursor" → normalize. Returns the next cursor. */
  fetchSince(cursor: string | null): Promise<{ items: NormalizedItem[]; cursor: string }>;
  /** Lazily fetch the full source text for one item (memo generation). */
  fetchFullText?(item: NormalizedItem): Promise<string | null>;
}

export interface Embedder {
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface LLM {
  /** Structured JSON call; output is validated against `schema` by the adapter. */
  json<T>(a: { system: string; user: string; schema: ZodSchema<T>; model?: string }): Promise<T>;
}

export interface Mailer {
  send(a: { to: string; subject: string; html: string }): Promise<void>;
}
