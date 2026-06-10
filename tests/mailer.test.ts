/**
 * Mailer tests — hermetic (no SMTP server, no credentials, no network).
 * With no SMTP_URL the factory must return a LogMailer whose send() resolves
 * without throwing, so the digest job can run end-to-end in dev/CI.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getMailer, LogMailer } from "@/lib/mailer";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LogMailer (no SMTP_URL)", () => {
  it("getMailer() returns a LogMailer when SMTP_URL is unset", () => {
    // env default has no SMTP_URL, so the hermetic LogMailer is selected.
    expect(getMailer()).toBeInstanceOf(LogMailer);
  });

  it("send() resolves without throwing", async () => {
    const mailer = new LogMailer();
    await expect(
      mailer.send({
        to: "owner@example.com",
        subject: "RedLine daily digest",
        html: "<h1>3 new threats</h1>",
      }),
    ).resolves.toBeUndefined();
  });

  it("logs a one-line summary and never dumps the HTML body", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mailer = new LogMailer("redline@example.com");
    await mailer.send({
      to: "owner@example.com",
      subject: "RedLine weekly digest",
      html: "<p>SECRET MEMO CONTENT</p>",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("RedLine weekly digest");
    expect(logged).toContain("owner@example.com");
    expect(logged).toContain("redline@example.com");
    // Body must not be logged (could contain memo content).
    expect(logged).not.toContain("SECRET MEMO CONTENT");
  });

  it("send() resolves for multiple recipients in sequence", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const mailer = new LogMailer();
    const recipients = ["a@example.com", "b@example.com", "c@example.com"];
    await expect(
      Promise.all(
        recipients.map((to) => mailer.send({ to, subject: "Digest", html: "<p>hi</p>" })),
      ),
    ).resolves.toHaveLength(3);
  });
});
