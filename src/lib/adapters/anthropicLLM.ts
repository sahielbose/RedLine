/**
 * AnthropicLLM — Claude-backed `LLM` adapter (spec §4, §7).
 *
 * Requests strict JSON, parses the first JSON object from the response, and
 * validates it against the caller's Zod schema. Retries ONCE on a parse/validate
 * failure with a corrective instruction. The API key is read lazily so the
 * hermetic path (local provider) never requires it; a missing key throws a clear
 * error only when this adapter is actually used.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ZodSchema } from "zod";

import { env } from "@/lib/env";
import type { LLM } from "@/lib/interfaces";

/** Pull the first balanced JSON object/array out of a model response. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.search(/[{[]/);
  if (start === -1) throw new Error("No JSON object found in model response");
  // Walk to the matching closing brace/bracket.
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("Unterminated JSON object in model response");
}

export class AnthropicLLM implements LLM {
  private client: Anthropic | null = null;
  readonly model: string;

  constructor(model?: string) {
    this.model = model ?? env().ANTHROPIC_MODEL;
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = env().ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AnthropicLLM requires ANTHROPIC_API_KEY. Set it in .env, or use LLM_PROVIDER=local for the hermetic fallback.",
      );
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async json<T>(a: { system: string; user: string; schema: ZodSchema<T>; model?: string }): Promise<T> {
    const client = this.getClient();
    const model = a.model ?? this.model;
    const system = `${a.system}\n\nOutput ONLY a single valid JSON object. No prose, no markdown fences.`;

    const call = async (extraUser?: string): Promise<T> => {
      const res = await client.messages.create({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: extraUser ? `${a.user}\n\n${extraUser}` : a.user }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = extractJson(text);
      return a.schema.parse(parsed);
    };

    try {
      return await call();
    } catch {
      // One corrective retry — common with strict schemas.
      return await call(
        "Your previous response did not parse as the required JSON schema. Respond again with ONLY the valid JSON object.",
      );
    }
  }
}
