/**
 * Resilience layer (spec §4 "documented local fallback", §8 trust). Hermetic —
 * no network, no DB. Verifies that:
 *   - classifyLLMError maps real Anthropic/parse errors to stable reasons + hints,
 *   - FallbackLLM returns the primary result when Claude works,
 *   - FallbackLLM degrades to the local engine (and reports the reason) when the
 *     primary throws — the guarantee that an out-of-credits key never breaks the app.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { classifyLLMError } from "@/lib/llmError";
import { FallbackLLM, type FallbackEvent } from "@/lib/adapters/fallbackLLM";
import type { LLM } from "@/lib/interfaces";

const schema = z.object({ ok: z.boolean() });

/** A primary that always throws the given error. */
function failingLLM(err: unknown): LLM {
  return { model: "claude-test", json: async () => { throw err; } } as unknown as LLM;
}
/** A fallback that always returns a fixed value. */
function fixedLLM(value: unknown, model = "heuristic-local"): LLM {
  return { model, json: async () => value } as unknown as LLM;
}

describe("classifyLLMError", () => {
  it("flags an out-of-credits 400 as no_credits, not retryable", () => {
    const info = classifyLLMError(new Error('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}'));
    expect(info.reason).toBe("no_credits");
    expect(info.retryable).toBe(false);
    expect(info.userHint).toMatch(/credits/i);
  });

  it("flags a 401 as auth", () => {
    const e = Object.assign(new Error("authentication_error"), { status: 401 });
    expect(classifyLLMError(e).reason).toBe("auth");
  });

  it("flags a 429 as rate_limit", () => {
    const e = Object.assign(new Error("rate limit exceeded"), { status: 429 });
    expect(classifyLLMError(e).reason).toBe("rate_limit");
  });

  it("flags a Zod/parse failure as parse, and as the only retryable case", () => {
    const e = Object.assign(new Error("bad"), { name: "ZodError" });
    const info = classifyLLMError(e);
    expect(info.reason).toBe("parse");
    expect(info.retryable).toBe(true);
  });
});

describe("FallbackLLM", () => {
  it("returns the primary result and reports 'primary' when Claude works", async () => {
    const events: FallbackEvent[] = [];
    const llm = new FallbackLLM(fixedLLM({ ok: true }, "claude-test"), fixedLLM({ ok: false }), (e) => events.push(e));
    const out = await llm.json({ system: "s", user: "u", schema });
    expect(out).toEqual({ ok: true });
    expect(events).toHaveLength(1);
    expect(events[0].used).toBe("primary");
    expect(llm.model).toBe("claude-test");
  });

  it("degrades to the local engine and reports the reason when the primary throws", async () => {
    const events: FallbackEvent[] = [];
    const creditErr = new Error("400 Your credit balance is too low");
    const llm = new FallbackLLM(failingLLM(creditErr), fixedLLM({ ok: false }), (e) => events.push(e));
    const out = await llm.json({ system: "s", user: "u", schema });
    expect(out).toEqual({ ok: false }); // came from the fallback
    expect(events).toHaveLength(1);
    expect(events[0].used).toBe("fallback");
    expect(events[0].reason).toBe("no_credits");
    expect(llm.model).toBe("heuristic-local"); // audit log reflects the engine that ran
  });

  it("never throws when the primary fails but the fallback succeeds", async () => {
    const llm = new FallbackLLM(failingLLM(new Error("network down")), fixedLLM({ ok: true }));
    await expect(llm.json({ system: "s", user: "u", schema })).resolves.toEqual({ ok: true });
  });
});
