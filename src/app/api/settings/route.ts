/**
 * GET  /api/settings  → browser-safe settings view (no raw secrets; masked tail only).
 * POST /api/settings  → persist provider / Anthropic key / model to the server-side
 *                       store. The key is written to disk (mode 0600) and never
 *                       echoed back; the response is the same safe view as GET.
 *
 * Self-hosted, single-tenant: there is no auth layer in v1 (AUTH_SECRET stubbed),
 * so these routes assume a trusted operator - same trust boundary as editing .env.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSafeSettings, saveStored } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(getSafeSettings());
}

const BodySchema = z.object({
  anthropicApiKey: z.string().trim().optional(),
  anthropicModel: z.string().trim().optional(),
  llmProvider: z.enum(["local", "anthropic", "ollama"]).optional(),
  digestCadence: z.enum(["daily", "weekly"]).optional(),
  commentDeadlineAlerts: z.boolean().optional(),
  digestRecipient: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid settings", details: parsed.error.flatten() }, { status: 400 });
  }
  saveStored(parsed.data);
  return Response.json(getSafeSettings());
}
