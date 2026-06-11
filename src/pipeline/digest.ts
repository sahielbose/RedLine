/**
 * Digest delivery (spec §3 Delivery, §7, §8, §14 Phase 4).
 *
 * The digest is the ONLY sender in RedLine, and it sends APPROVED-ONLY:
 *
 *   - `buildDigestHtml(...)` is PURE - it renders a self-contained HTML email
 *     from already-decided rows. No I/O, no clock, no DB. It echoes the RedLine
 *     warm/navy palette inline (email clients ignore <style>/external CSS), is
 *     severity-ordered, HTML-escapes every interpolated field (these strings
 *     originate from external bills/rules), shows ONLY provided fields, invents
 *     nothing (no fabricated figures/probabilities/vote counts - spec §15), and
 *     carries a footer stating it contains only human-APPROVED items.
 *
 *   - `sendDigest(db, mailer, …)` is the DB path. It loads the org's APPROVED
 *     memos joined to their items, builds the html via `buildDigestHtml`, sends
 *     once via the injected `Mailer`, then transitions each sent memo
 *     approved → "sent" through `markSent` (the review-queue state machine,
 *     which throws from any non-approved state). If there are no approved memos
 *     it does NOT send - it returns a skipped result. There is no path here that
 *     touches a draft: the SQL filter is `status = "approved"`, and `markSent`
 *     itself only legalizes approved → sent (spec §8, CLAUDE.md rule 10).
 *
 * Why approved-only is enforced twice (SQL filter + markSent guard): defense in
 * depth for the approval gate. Even if a caller hand-built a memo list, markSent
 * would reject anything not already approved, so a draft can never be delivered.
 */
import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import type { Mailer } from "@/lib/interfaces";
import { markSent } from "@/pipeline/review";
import { severityLabel, type SeverityLabel } from "@/lib/types";
import { items, memos } from "@db/schema";

/** The shared Drizzle client type (matches `@/lib/db`'s `getDb()` / `db`). */
type Db = Database;

/**
 * One row rendered in the digest. Every field is OPTIONAL except identity/title:
 * we render only what we are given and never invent a missing value (spec §15).
 * `severity`/`score` drive ordering and the severity stamp; absent → "Monitor".
 */
export interface DigestItem {
  identifier: string | null;
  title: string;
  severity?: SeverityLabel | null;
  score?: number | null;
  jurisdiction?: string | null;
  whatItDoes?: string | null;
  recommendedAction?: string | null;
  /** Official public portal / bill page link only - never PII (spec §15 rule 4). */
  actionUrl?: string | null;
  /** Factual upcoming event - a real comment-close date, never a prediction. */
  commentCloseDate?: string | null;
}

export interface BuildDigestHtmlArgs {
  /** The business this digest is "viewing as" (e.g. the org/profile label). */
  orgLabel: string;
  /** Human period label, e.g. "Daily digest · Jun 11 2026" or "This week". */
  periodLabel: string;
  /** The APPROVED items to render. Empty is allowed (caller decides to skip). */
  items: DigestItem[];
}

// ── RedLine palette echo (spec §12 tokens) - inlined; email clients drop CSS ──
const C = {
  canvas: "#EFE3D8",
  surface: "#FFFFFF",
  line: "#E7E2DB",
  ink: "#15203B",
  inkSoft: "#3C4660",
  muted: "#8A8F99",
  accent: "#2F6BFF",
  critical: "#C2183A",
  criticalBg: "#FBE9EC",
  high: "#B45A0E",
  highBg: "#FBF0E2",
  monitor: "#2B57C9",
  monitorBg: "#E9EEFC",
  safe: "#13705F",
  safeBg: "#E2F0EC",
} as const;

const MONO = `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace`;
const SANS = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/** Severity stamp colors (fg/bg) by label (spec §12 severity tokens). */
function severityColors(label: SeverityLabel): { fg: string; bg: string } {
  switch (label) {
    case "Critical":
      return { fg: C.critical, bg: C.criticalBg };
    case "High":
      return { fg: C.high, bg: C.highBg };
    case "Monitor":
      return { fg: C.monitor, bg: C.monitorBg };
    case "Low":
      return { fg: C.safe, bg: C.safeBg };
  }
}

/**
 * Escape a string for safe interpolation into HTML text/attributes. Item titles
 * and summaries come from external sources - they must never be trusted as HTML.
 * `&` first so we don't double-escape the entities we then introduce.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve a row's severity label: explicit → from score → "Monitor" fallback. */
function rowSeverity(item: DigestItem): SeverityLabel {
  if (item.severity) return item.severity;
  if (typeof item.score === "number") return severityLabel(item.score);
  return "Monitor";
}

/** Numeric rank for ordering (higher = more severe / earlier in the digest). */
function severityRank(label: SeverityLabel): number {
  switch (label) {
    case "Critical":
      return 3;
    case "High":
      return 2;
    case "Monitor":
      return 1;
    case "Low":
      return 0;
  }
}

/** Render a single approved item as one email-safe table card. */
function renderItem(item: DigestItem): string {
  const label = rowSeverity(item);
  const { fg, bg } = severityColors(label);
  const identifier = item.identifier ? esc(item.identifier) : "-";
  const scoreText = typeof item.score === "number" ? ` · ${esc(String(item.score))}/5` : "";

  // Build the optional metadata + body rows; OMIT anything not provided - we
  // never render a placeholder figure or an invented field (spec §15).
  const rows: string[] = [];

  rows.push(
    `<tr><td style="padding:0 0 6px 0;">` +
      `<span style="display:inline-block;font-family:${MONO};font-size:12px;font-weight:700;` +
      `letter-spacing:0.04em;color:${fg};background:${bg};border-radius:6px;padding:3px 8px;">` +
      `${esc(label)}${scoreText}</span>` +
      `<span style="font-family:${MONO};font-size:13px;color:${C.inkSoft};padding-left:10px;">` +
      `${identifier}</span>` +
      (item.jurisdiction
        ? `<span style="font-family:${MONO};font-size:12px;color:${C.muted};padding-left:8px;">` +
          `${esc(item.jurisdiction)}</span>`
        : "") +
      `</td></tr>`,
  );

  rows.push(
    `<tr><td style="padding:0 0 6px 0;font-family:${SANS};font-size:16px;font-weight:600;` +
      `line-height:1.35;color:${C.ink};">${esc(item.title)}</td></tr>`,
  );

  if (item.whatItDoes) {
    rows.push(
      `<tr><td style="padding:0 0 6px 0;font-family:${SANS};font-size:14px;line-height:1.5;` +
        `color:${C.inkSoft};">${esc(item.whatItDoes)}</td></tr>`,
    );
  }

  if (item.commentCloseDate) {
    rows.push(
      `<tr><td style="padding:0 0 6px 0;font-family:${SANS};font-size:13px;color:${C.inkSoft};">` +
        `<strong style="color:${C.ink};">Comment closes:</strong> ${esc(item.commentCloseDate)}` +
        `</td></tr>`,
    );
  }

  if (item.recommendedAction || item.actionUrl) {
    const actionText = item.recommendedAction
      ? esc(item.recommendedAction.replace(/_/g, " "))
      : "View item";
    const actionCell = item.actionUrl
      ? `<a href="${esc(item.actionUrl)}" style="color:${C.accent};text-decoration:none;` +
        `font-weight:600;">${actionText} &rarr;</a>`
      : `<span style="color:${C.inkSoft};font-weight:600;">${actionText}</span>`;
    rows.push(
      `<tr><td style="padding:4px 0 0 0;font-family:${SANS};font-size:14px;">` +
        `<span style="color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;` +
        `font-size:11px;">Action</span><br/>${actionCell}</td></tr>`,
    );
  }

  return (
    `<tr><td style="padding:0 0 14px 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:${C.surface};border:1px solid ${C.line};border-left:4px solid ${fg};` +
    `border-radius:10px;">` +
    `<tr><td style="padding:16px 18px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>` +
    `</td></tr></table></td></tr>`
  );
}

/**
 * Build the complete, self-contained digest HTML (PURE). Items are rendered most
 * severe first; ties keep input order (stable). The footer states the trust
 * guarantee: this email contains ONLY human-approved items (spec §8).
 */
export function buildDigestHtml(args: BuildDigestHtmlArgs): string {
  const { orgLabel, periodLabel, items: rows } = args;

  // Stable severity-descending sort (decorate-sort-undecorate preserves ties).
  const ordered = rows
    .map((item, index) => ({ item, index, rank: severityRank(rowSeverity(item)) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((d) => d.item);

  const count = ordered.length;
  const itemWord = count === 1 ? "item" : "items";

  const body =
    count > 0
      ? ordered.map(renderItem).join("")
      : `<tr><td style="padding:0 0 14px 0;font-family:${SANS};font-size:15px;` +
        `color:${C.inkSoft};">No approved items this period. Approve memos in the ` +
        `review queue and they will appear here.</td></tr>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>RedLine - ${esc(periodLabel)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.canvas};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:${C.canvas};">` +
    `<tr><td align="center" style="padding:28px 16px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" ` +
    `style="width:600px;max-width:100%;">` +
    // ── header ──────────────────────────────────────────────────────────────
    `<tr><td style="padding:0 0 18px 0;">` +
    `<span style="display:inline-block;width:12px;height:12px;background:${C.critical};` +
    `border-radius:3px;vertical-align:middle;"></span>` +
    `<span style="font-family:${SANS};font-size:20px;font-weight:700;letter-spacing:-0.01em;` +
    `color:${C.ink};vertical-align:middle;padding-left:8px;">RedLine</span>` +
    `<div style="font-family:${SANS};font-size:13px;color:${C.muted};padding-top:6px;">` +
    `${esc(periodLabel)} · viewing as <strong style="color:${C.inkSoft};">` +
    `${esc(orgLabel)}</strong></div>` +
    `<div style="font-family:${SANS};font-size:14px;color:${C.inkSoft};padding-top:10px;">` +
    `${esc(String(count))} approved ${itemWord} this period.</div>` +
    `</td></tr>` +
    // ── items ─────────────────────────────────────────────────────────────────
    body +
    // ── footer (trust guarantee) ───────────────────────────────────────────────
    `<tr><td style="padding:8px 0 0 0;border-top:1px solid ${C.line};">` +
    `<div style="font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted};` +
    `padding-top:12px;">` +
    `This digest contains only items a human reviewer has <strong>approved</strong> in the ` +
    `RedLine review queue - nothing is sent automatically. Figures and dates shown are taken ` +
    `directly from the source filing; RedLine never invents impact numbers or vote predictions.` +
    `</div></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

// ── DB path: the approved-only sender ──────────────────────────────────────────

export interface SendDigestArgs {
  orgId: string;
  /** Recipient address (a verified org member's email, resolved by the caller). */
  to: string;
  /** Human period label for the subject + header, e.g. "Daily digest · Jun 11". */
  periodLabel: string;
  /** Override the subject; defaults to `RedLine - ${periodLabel}`. */
  subject?: string;
  /** Profile/business label for the "viewing as" line; defaults to orgId. */
  orgLabel?: string;
}

export interface SendDigestResult {
  /** False when there were no approved memos (nothing sent). */
  sent: boolean;
  /** Memo ids included in this digest and transitioned approved → sent. */
  memoIds: string[];
  /** The recipient (echoed for logging/audit by the caller). */
  to: string;
  /** Reason when sent === false. */
  skippedReason?: "no_approved_memos";
}

/**
 * Load the org's APPROVED memos joined to their items, build the digest, send it
 * once, then mark each included memo "sent" (approved → sent).
 *
 * APPROVED-ONLY by construction: the WHERE clause filters `status = "approved"`,
 * and `markSent` independently re-checks the source state. If there are zero
 * approved memos, we DO NOT send (no empty email, no state changes) and return a
 * skipped result.
 *
 * Ordering: most severe first (memo.recommended_action "call_counsel" outranks
 * "comment" etc. is NOT used for severity - we order by the linked judgment-free
 * fields we have, falling back to the item's own ordering). We render with the
 * pure `buildDigestHtml`, so the wire format is identical to the tested path.
 */
export async function sendDigest(
  db: Db,
  mailer: Mailer,
  args: SendDigestArgs,
): Promise<SendDigestResult> {
  const { orgId, to, periodLabel } = args;

  // Approved memos for this org, joined to their items (newest item action first
  // as a stable default; buildDigestHtml re-orders by severity for display).
  const rows = await db
    .select({
      memoId: memos.id,
      whatItDoes: memos.whatItDoes,
      recommendedAction: memos.recommendedAction,
      itemIdentifier: items.identifier,
      itemTitle: items.title,
      itemJurisdiction: items.jurisdiction,
      itemFullTextUrl: items.fullTextUrl,
      itemCommentCloseDate: items.commentCloseDate,
      itemLastActionDate: items.lastActionDate,
    })
    .from(memos)
    .innerJoin(items, eq(memos.itemId, items.id))
    .where(and(eq(memos.orgId, orgId), eq(memos.status, "approved")))
    .orderBy(desc(items.lastActionDate), asc(items.identifier));

  if (rows.length === 0) {
    return { sent: false, memoIds: [], to, skippedReason: "no_approved_memos" };
  }

  const digestItems: DigestItem[] = rows.map((r) => ({
    identifier: r.itemIdentifier,
    title: r.itemTitle,
    jurisdiction: r.itemJurisdiction,
    whatItDoes: r.whatItDoes,
    recommendedAction: r.recommendedAction,
    actionUrl: r.itemFullTextUrl,
    commentCloseDate: r.itemCommentCloseDate,
    // score/severity are intentionally absent here (the digest groups approved
    // items; recommended_action carries the action) → "Monitor" stamp default.
  }));

  const html = buildDigestHtml({
    orgLabel: args.orgLabel ?? orgId,
    periodLabel,
    items: digestItems,
  });

  const subject = args.subject ?? `RedLine - ${periodLabel}`;

  // Send ONCE. Only after a successful send do we transition memos approved → sent
  // (so a send failure leaves them approved for the next run - at-least-once, not
  // a silent drop).
  await mailer.send({ to, subject, html });

  const memoIds = rows.map((r) => r.memoId);
  for (const memoId of memoIds) {
    // markSent re-guards approved → sent; throws from any other state (spec §8).
    await markSent(db, { memoId });
  }

  return { sent: true, memoIds, to };
}
