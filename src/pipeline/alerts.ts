/**
 * Comment-deadline alerts (spec §2 Alerts, §5 Regulations.gov, §14 Phase 4).
 *
 * A core RedLine failure mode it prevents: "a rule's comment window closes" and
 * a business never sees it coming (spec §1). This module surfaces items whose
 * public comment period closes soon — using ONLY real `comment_close_date`
 * values from the source. No forecasting, no fabricated deadlines, no predicted
 * outcomes (spec §15): an item with a null/absent or already-past comment date
 * is simply not an upcoming alert.
 *
 * PURE + hermetic: `now` is injected (never read from the system clock here), so
 * the windowing is deterministic and testable with zero infrastructure.
 */

/** The minimal shape an alertable item must expose. */
export interface CommentDeadlineItem {
  /** ISO date (YYYY-MM-DD) or full ISO datetime; null/absent → not alertable. */
  comment_close_date?: string | null;
}

export interface CommentDeadlineOptions {
  /** "Today" — injected so the window is deterministic (no hidden clock). */
  now: Date;
  /** Alert when the window closes within this many days of `now` (default 14). */
  withinDays?: number;
}

/** An item whose comment window closes within the alert window, plus its lead time. */
export type CommentDeadlineAlert<T> = T & {
  /** The parsed close instant (UTC midnight for date-only inputs). */
  closesAt: Date;
  /** Whole days from `now` until close: 0 = today, 1 = tomorrow, … (≤ withinDays). */
  daysLeft: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a `comment_close_date` to a Date, or null if absent/unparseable.
 *
 * Date-only strings (YYYY-MM-DD) are anchored to UTC midnight so `daysLeft` is
 * timezone-stable and not skewed by the runner's local offset. Full datetimes
 * are parsed as-is. Anything else (null, "", garbage) → null (not alertable).
 */
function parseCloseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Date-only → pin to UTC midnight (avoids local-tz off-by-one on daysLeft).
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const parsed = new Date(dateOnly);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole calendar days from `now` to `closesAt` (UTC), floored at the day boundary. */
function daysBetween(now: Date, closesAt: Date): number {
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(closesAt) - startOfDay(now)) / MS_PER_DAY);
}

/**
 * Return the items whose comment window closes within [now, now + withinDays],
 * sorted soonest-closing first, each annotated with `closesAt` + `daysLeft`.
 *
 * Inclusion rule (only REAL, upcoming dates — spec §15):
 *   - the item has a parseable `comment_close_date`,
 *   - that date is on/after `now`'s day (past windows are excluded), AND
 *   - it is within `withinDays` whole days of `now` (default 14).
 *
 * Ties (same close date) keep their input order (stable sort).
 */
export function commentDeadlineAlerts<T extends CommentDeadlineItem>(
  items: T[],
  opts: CommentDeadlineOptions,
): CommentDeadlineAlert<T>[] {
  const withinDays = opts.withinDays ?? 14;
  const now = opts.now;

  const alerts: CommentDeadlineAlert<T>[] = [];
  for (const item of items) {
    const closesAt = parseCloseDate(item.comment_close_date);
    if (!closesAt) continue; // null / absent / unparseable → not alertable.

    const daysLeft = daysBetween(now, closesAt);
    // Exclude past windows (daysLeft < 0) and anything beyond the horizon.
    if (daysLeft < 0 || daysLeft > withinDays) continue;

    alerts.push({ ...item, closesAt, daysLeft });
  }

  // Soonest-closing first; stable on ties via index fallback.
  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => a.alert.daysLeft - b.alert.daysLeft || a.index - b.index)
    .map((d) => d.alert);
}
