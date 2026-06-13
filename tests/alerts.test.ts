/**
 * Comment-deadline alert tests - PURE / hermetic (spec §2 Alerts, §14 Phase 4).
 *
 * `now` is injected, so the window math is deterministic with zero
 * infrastructure. We assert: only items closing within [now, now+withinDays] are
 * returned, soonest-closing first, with correct `daysLeft`; past and null/absent
 * deadlines are excluded; nothing is fabricated (only real dates produce alerts).
 */
import { describe, it, expect } from "vitest";

import { commentDeadlineAlerts, type CommentDeadlineItem } from "@/pipeline/alerts";

/** Fixed "today" anchored to UTC midnight so date-only math is stable. */
const NOW = new Date("2026-06-11T00:00:00.000Z");

interface Item extends CommentDeadlineItem {
  id: string;
}

describe("commentDeadlineAlerts (pure)", () => {
  it("returns only items whose window closes within the default 14-day horizon", () => {
    const items: Item[] = [
      { id: "today", comment_close_date: "2026-06-11" }, // 0 days
      { id: "soon", comment_close_date: "2026-06-18" }, // 7 days
      { id: "edge", comment_close_date: "2026-06-25" }, // 14 days (inclusive)
      { id: "beyond", comment_close_date: "2026-06-26" }, // 15 days (excluded)
      { id: "far", comment_close_date: "2026-12-01" }, // well beyond
    ];
    const alerts = commentDeadlineAlerts(items, { now: NOW });
    expect(alerts.map((a) => a.id)).toEqual(["today", "soon", "edge"]);
  });

  it("sorts soonest-closing first and computes daysLeft correctly", () => {
    const items: Item[] = [
      { id: "d10", comment_close_date: "2026-06-21" },
      { id: "d1", comment_close_date: "2026-06-12" },
      { id: "d5", comment_close_date: "2026-06-16" },
      { id: "d0", comment_close_date: "2026-06-11" },
    ];
    const alerts = commentDeadlineAlerts(items, { now: NOW });
    expect(alerts.map((a) => a.id)).toEqual(["d0", "d1", "d5", "d10"]);
    expect(alerts.map((a) => a.daysLeft)).toEqual([0, 1, 5, 10]);
  });

  it("excludes items whose comment window already closed (past dates)", () => {
    const items: Item[] = [
      { id: "yesterday", comment_close_date: "2026-06-10" },
      { id: "last_month", comment_close_date: "2026-05-01" },
      { id: "valid", comment_close_date: "2026-06-13" },
    ];
    const alerts = commentDeadlineAlerts(items, { now: NOW });
    expect(alerts.map((a) => a.id)).toEqual(["valid"]);
    expect(alerts[0]!.daysLeft).toBe(2);
  });

  it("excludes items with a null, absent, empty, or unparseable comment date", () => {
    const items: Item[] = [
      { id: "null", comment_close_date: null },
      { id: "absent" }, // comment_close_date undefined
      { id: "empty", comment_close_date: "   " },
      { id: "garbage", comment_close_date: "not-a-date" },
      { id: "real", comment_close_date: "2026-06-20" },
    ];
    const alerts = commentDeadlineAlerts(items, { now: NOW });
    expect(alerts.map((a) => a.id)).toEqual(["real"]);
  });

  it("respects a custom withinDays horizon", () => {
    const items: Item[] = [
      { id: "in3", comment_close_date: "2026-06-14" }, // 3 days
      { id: "in7", comment_close_date: "2026-06-18" }, // 7 days
    ];
    const alerts = commentDeadlineAlerts(items, { now: NOW, withinDays: 5 });
    expect(alerts.map((a) => a.id)).toEqual(["in3"]);
  });

  it("preserves input order for items closing on the same day (stable sort)", () => {
    const items: Item[] = [
      { id: "a", comment_close_date: "2026-06-15" },
      { id: "b", comment_close_date: "2026-06-15" },
      { id: "c", comment_close_date: "2026-06-15" },
    ];
    const alerts = commentDeadlineAlerts(items, { now: NOW });
    expect(alerts.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(alerts.every((a) => a.daysLeft === 4)).toBe(true);
  });

  it("parses full ISO datetimes and annotates each alert with closesAt", () => {
    const items: Item[] = [{ id: "dt", comment_close_date: "2026-06-20T17:00:00.000Z" }];
    const alerts = commentDeadlineAlerts(items, { now: NOW });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.closesAt).toBeInstanceOf(Date);
    expect(alerts[0]!.daysLeft).toBe(9);
  });

  it("returns an empty array when nothing is within the window (no fabrication)", () => {
    const items: Item[] = [{ id: "far", comment_close_date: "2027-01-01" }];
    expect(commentDeadlineAlerts(items, { now: NOW })).toEqual([]);
  });

  it("is non-mutating: original items keep no daysLeft/closesAt fields", () => {
    const items: Item[] = [{ id: "x", comment_close_date: "2026-06-13" }];
    commentDeadlineAlerts(items, { now: NOW });
    expect("daysLeft" in items[0]!).toBe(false);
    expect("closesAt" in items[0]!).toBe(false);
  });
});
