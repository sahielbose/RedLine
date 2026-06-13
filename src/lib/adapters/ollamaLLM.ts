/**
 * OllamaLLM - local-model `LLM` adapter via Ollama's HTTP API (spec §4, §15).
 *
 * The fully-self-hostable path: POSTs to {OLLAMA_BASE_URL}/api/chat with
 * `format: "json"`, then validates the returned content against the caller's Zod
 * schema. No SDK dependency - plain `fetch` against a local server. Retries once
 * on a parse/validate failure. Errors are clear when the server is unreachable.
 */
import type { ZodSchema } from "zod";

import { env } from "@/lib/env";
import type { LLM } from "@/lib/interfaces";

interface OllamaChatResponse {
  message?: { role: string; content: string };
}

export class OllamaLLM implements LLM {
  readonly baseUrl: string;
  readonly model: string;

  constructor(model?: string) {
    this.baseUrl = env().OLLAMA_BASE_URL.replace(/\/+$/, "");
    // Ollama uses its own model tags (e.g. "llama3.1"); reuse ANTHROPIC_MODEL
    // only as a last-resort default - operators should pass an Ollama tag.
    this.model = model ?? "llama3.1";
  }

  async json<T>(a: { system: string; user: string; schema: ZodSchema<T>; model?: string }): Promise<T> {
    const model = a.model ?? this.model;

    const call = async (extraUser?: string): Promise<T> => {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format: "json",
            messages: [
              { role: "system", content: `${a.system}\n\nOutput ONLY a single valid JSON object.` },
              { role: "user", content: extraUser ? `${a.user}\n\n${extraUser}` : a.user },
            ],
          }),
        });
      } catch (e) {
        throw new Error(
          `OllamaLLM: could not reach Ollama at ${this.baseUrl}. Is it running? (${(e as Error).message})`,
        );
      }
      if (!res.ok) {
        throw new Error(`OllamaLLM: HTTP ${res.status} from ${this.baseUrl}/api/chat`);
      }
      const body = (await res.json()) as OllamaChatResponse;
      const content = body.message?.content ?? "";
      const parsed = JSON.parse(content) as unknown;
      return a.schema.parse(parsed);
    };

    try {
      return await call();
    } catch {
      return await call(
        "Your previous response did not parse as the required JSON schema. Respond again with ONLY the valid JSON object.",
      );
    }
  }
}
