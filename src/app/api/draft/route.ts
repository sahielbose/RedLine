/**
 * POST /api/draft — draft a public-comment / position letter (Fed10 "draft your
 * position paper", spec §2 ACTION, §8 approval gate).
 *
 * Returns a DRAFT letter the operator reviews and submits themselves through the
 * official portal — RedLine never auto-sends (CLAUDE.md rule 10). When the engine
 * is Claude, the letter is model-written, grounded ONLY in the supplied item text,
 * with bracketed placeholders where business-specific facts belong (no fabrication).
 * Otherwise it's a structured, honest template skeleton built locally. The local
 * path is also the automatic fallback when Claude is unavailable.
 *
 * Body: { profileId, itemId, identifier, title, summary, businessLabel }.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { resolveLLMConfig } from "@/lib/settings";
import { AnthropicLLM } from "@/lib/adapters/anthropicLLM";
import { classifyLLMError } from "@/lib/llmError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  profileId: z.string().min(1),
  itemId: z.string().min(1),
  identifier: z.string().default(""),
  title: z.string().min(1),
  summary: z.string().default(""),
  businessLabel: z.string().default("our business"),
});
type DraftInput = z.infer<typeof BodySchema>;

/** Best-effort profile context (concern_text) for a richer Claude draft. */
async function profileContext(profileId: string): Promise<string | null> {
  try {
    const { rows } = await getPool().query<{ concern_text: string | null }>(
      `SELECT concern_text FROM org_profiles WHERE id = $1 LIMIT 1`,
      [profileId],
    );
    return rows[0]?.concern_text ?? null;
  } catch {
    return null;
  }
}

/** Honest, grounded skeleton — no invented facts; bracketed prompts for the user. */
function templateLetter(i: DraftInput): string {
  const ref = i.identifier ? `${i.identifier} — ${i.title}` : i.title;
  const basis = i.summary
    ? `As described, the proposal would ${i.summary.replace(/\.$/, "")}.`
    : "We have reviewed the proposal as published.";
  return `Re: Public comment on ${ref}

To whom it may concern:

We submit this comment on behalf of ${i.businessLabel} regarding ${ref}.

${basis}

This measure directly affects our operations. [Describe the specific impact on your business — affected processes, estimated compliance cost and timeline, and any disproportionate burden on a business of your size.]

We respectfully request that the agency [state your ask: clarify a definition / provide a longer compliance runway / exempt small businesses below a threshold / reconsider a specific provision].

Thank you for the opportunity to comment.

Sincerely,
${i.businessLabel}

— DRAFT. Review and complete the bracketed sections, then submit through the official portal. RedLine does not send anything on your behalf.`;
}

export async function POST(req: Request): Promise<Response> {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const input = parsed.data;

  const cfg = resolveLLMConfig();
  // Local engine (or no key): return the honest template directly. The Heuristic
  // LLM can't write prose, so we don't route this through FallbackLLM.
  if (cfg.provider !== "anthropic" || !cfg.hasAnthropicKey) {
    return NextResponse.json({ letter: templateLetter(input), engine: "local", draft: true });
  }

  const concern = await profileContext(input.profileId);
  try {
    const llm = new AnthropicLLM({ apiKey: cfg.anthropicApiKey, model: cfg.anthropicModel, maxTokens: 1200 });
    const out = await llm.json({
      system:
        "You draft concise, professional U.S. regulatory public-comment letters for a small business. " +
        "Ground every factual claim ONLY in the provided item summary — do not invent provisions, numbers, dates, or effects. " +
        "Where a business-specific fact is needed (impact, cost, headcount), insert a [bracketed placeholder] for the user to fill. " +
        "Keep it under 250 words, formal, and clearly a draft. Output JSON {\"letter\": string}.",
      user: JSON.stringify({
        business: input.businessLabel,
        business_context: concern ?? undefined,
        item: { identifier: input.identifier, title: input.title, summary: input.summary },
      }),
      schema: z.object({ letter: z.string().min(1) }),
    });
    return NextResponse.json({ letter: out.letter, engine: "claude", draft: true });
  } catch (err) {
    // Claude unavailable (e.g. out of credits) → honest template + the reason.
    const info = classifyLLMError(err);
    return NextResponse.json({
      letter: templateLetter(input),
      engine: "local",
      draft: true,
      notice: info.userHint,
    });
  }
}
