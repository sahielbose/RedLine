/**
 * POST /api/digest — "Send test digest" (spec §8 delivery, approval-gated).
 *
 * Renders the APPROVED items the client sends through the real digest builder
 * (buildDigestHtml — severity-ordered, escaped, no fabricated figures) and
 * delivers via the configured Mailer: console LogMailer when no SMTP_URL is
 * set, real SMTP when it is. The client only ever sends items the human
 * approved in the review queue — and this endpoint renders only what it's
 * given; it cannot promote a draft.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildDigestHtml, type DigestItem } from "@/pipeline/digest";
import { getMailer } from "@/lib/mailer";
import { env } from "@/lib/env";
import { getAlertConfig } from "@/lib/settings";

const Body = z.object({
  orgLabel: z.string().trim().min(1).max(120),
  to: z.string().email().optional(),
  items: z
    .array(
      z.object({
        identifier: z.string().nullable(),
        title: z.string().min(1),
        severity: z.enum(["Critical", "High", "Monitor", "Low"]).nullable().optional(),
        score: z.number().int().min(0).max(5).nullable().optional(),
        jurisdiction: z.string().nullable().optional(),
        whatItDoes: z.string().nullable().optional(),
        recommendedAction: z.string().nullable().optional(),
        actionUrl: z.string().url().nullable().optional(),
        commentCloseDate: z.string().nullable().optional(),
      }),
    )
    .min(1, "Approve at least one memo first — the digest sends approved items only.")
    .max(100),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { orgLabel, to, items } = parsed.data;

  const periodLabel = `Test digest · ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const html = buildDigestHtml({ orgLabel, periodLabel, items: items as DigestItem[] });

  const transport = env().SMTP_URL ? "smtp" : "console";
  // Recipient precedence: explicit `to` > the configured digest recipient > a
  // clearly-placeholder fallback (so a real SMTP run never silently emails a stub).
  const recipient = to || getAlertConfig().recipient || "owner@example.com";
  await getMailer().send({
    to: recipient,
    subject: `RedLine — ${periodLabel} (${orgLabel})`,
    html,
  });

  return NextResponse.json({ ok: true, transport, itemCount: items.length, bytes: html.length, to: recipient });
}
