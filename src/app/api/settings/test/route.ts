/**
 * POST /api/settings/test → live connectivity check for Claude.
 *
 * Does ONE tiny structured call (a few tokens) against the supplied key/model, or
 * the currently-resolved config when none is supplied, and returns a precise
 * verdict: { ok } on success, or { ok:false, reason, hint } classified from the
 * error so the UI can show "out of credits", "key rejected", "rate-limited", etc.
 * Never persists anything and never returns the key.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { AnthropicLLM } from "@/lib/adapters/anthropicLLM";
import { resolveLLMConfig } from "@/lib/settings";
import { classifyLLMError } from "@/lib/llmError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  anthropicApiKey: z.string().trim().optional(),
  anthropicModel: z.string().trim().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine - test the resolved config */
  }
  const parsed = BodySchema.safeParse(body);
  const input = parsed.success ? parsed.data : {};

  const cfg = resolveLLMConfig();
  const apiKey = input.anthropicApiKey || cfg.anthropicApiKey;
  const model = input.anthropicModel || cfg.anthropicModel;

  if (!apiKey) {
    return Response.json({
      ok: false,
      reason: "auth",
      hint: "No Anthropic key set. Paste a key above (or set ANTHROPIC_API_KEY in .env).",
      model,
    });
  }

  try {
    const llm = new AnthropicLLM({ apiKey, model, maxTokens: 16 });
    await llm.json({
      system: "Connectivity probe. Reply with the required JSON only.",
      user: 'Return {"ok": true}.',
      schema: z.object({ ok: z.boolean() }),
    });
    return Response.json({ ok: true, model });
  } catch (err) {
    const info = classifyLLMError(err);
    return Response.json({ ok: false, reason: info.reason, hint: info.userHint, model });
  }
}
