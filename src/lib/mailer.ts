/**
 * Mailer adapters (spec §4, §7).
 *
 * One `Mailer` interface, selected by env().SMTP_URL:
 *   - LogMailer  (no SMTP_URL)  - logs the email to the console and resolves.
 *                                 The hermetic dev/CI default: no network, no
 *                                 secrets, and respects the approval gate (only
 *                                 approved memos ever reach a mailer - spec §8).
 *   - SmtpMailer (SMTP_URL set) - sends via Nodemailer over any SMTP transport,
 *                                 `from` = env().MAIL_FROM.
 *
 * We use Nodemailer + SMTP (MIT) rather than a proprietary email SaaS so the
 * core stays open and self-hostable (spec §4). A Resend adapter is optional.
 */
import type { Mailer } from "@/lib/interfaces";
import { env } from "@/lib/env";

type SendArgs = { to: string; subject: string; html: string };

// ── LogMailer (hermetic default) ──────────────────────────────────────────────

/**
 * No-network mailer for dev/CI. Logs a one-line summary instead of sending, so
 * the digest job can run end-to-end without an SMTP server or credentials.
 */
export class LogMailer implements Mailer {
  private readonly from: string;

  constructor(from = env().MAIL_FROM) {
    this.from = from;
  }

  async send({ to, subject }: SendArgs): Promise<void> {
    // Log metadata only - never dump full HTML bodies (may contain memo content).
    // eslint-disable-next-line no-console
    console.info(`[mailer:log] would send "${subject}" from <${this.from}> to <${to}>`);
  }
}

// ── SmtpMailer (Nodemailer) ───────────────────────────────────────────────────

// Minimal structural type for the Nodemailer transport we use. Keeping this
// local avoids leaking nodemailer's types through the shared `Mailer` contract.
interface SmtpTransport {
  sendMail(opts: { from: string; to: string; subject: string; html: string }): Promise<unknown>;
}

/**
 * Real SMTP delivery via Nodemailer. The transport is built from a single
 * SMTP_URL (e.g. `smtps://user:pass@smtp.example.com:465`) so any provider
 * works with one env var; `from` defaults to MAIL_FROM.
 *
 * Nodemailer is imported dynamically on first `send()` so the hermetic LogMailer
 * path never loads it - `getMailer()` stays synchronous and the CI path stays
 * dependency-thin, while real sends still use the declared `nodemailer` dep.
 */
export class SmtpMailer implements Mailer {
  private readonly smtpUrl: string;
  private readonly from: string;
  private transport: SmtpTransport | null = null;

  constructor(smtpUrl: string, from = env().MAIL_FROM) {
    this.smtpUrl = smtpUrl;
    this.from = from;
  }

  private async getTransport(): Promise<SmtpTransport> {
    if (this.transport) return this.transport;
    const nodemailer = (await import("nodemailer")) as unknown as {
      createTransport: (url: string) => SmtpTransport;
      default?: { createTransport: (url: string) => SmtpTransport };
    };
    const createTransport = nodemailer.createTransport ?? nodemailer.default?.createTransport;
    if (!createTransport) {
      throw new Error("[mailer:smtp] could not load nodemailer.createTransport");
    }
    this.transport = createTransport(this.smtpUrl);
    return this.transport;
  }

  async send({ to, subject, html }: SendArgs): Promise<void> {
    const transport = await this.getTransport();
    await transport.sendMail({ from: this.from, to, subject, html });
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Resolve the configured mailer. With no SMTP_URL we return the hermetic
 * LogMailer (dev/CI default). With SMTP_URL set we return a Nodemailer-backed
 * SmtpMailer that builds its transport lazily on first send.
 */
export function getMailer(): Mailer {
  const smtpUrl = env().SMTP_URL;
  if (!smtpUrl) return new LogMailer();
  return new SmtpMailer(smtpUrl, env().MAIL_FROM);
}
