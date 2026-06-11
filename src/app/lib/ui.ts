/**
 * Client-safe UI helpers shared by the site + app views (ported from the
 * reference prototype). Pure data/lookup — no React, no server imports.
 */
import type { SurfacedCard } from "@/app/lib/board";

/** Severity band for a 0–5 score → CSS token key + label. */
export type BandKey = "critical" | "high" | "monitor" | "low";
export function band(score: number): { key: BandKey; label: string } {
  if (score >= 5) return { key: "critical", label: "Critical" };
  if (score === 4) return { key: "high", label: "High" };
  if (score === 3) return { key: "monitor", label: "Monitor" };
  return { key: "low", label: "Low" };
}

/** Inline style trio for a severity-toned pill/stamp. */
export function sevStyle(key: BandKey | "safe"): React.CSSProperties {
  return {
    background: `var(--${key}-bg)`,
    borderColor: `var(--${key}-line)`,
    color: `var(--${key})`,
  };
}

/** Normalized lifecycle stage → display label (Tracker columns, status pills). */
export const STAGE_LABEL: Record<string, string> = {
  proposed: "Proposed",
  comment_open: "Comment open",
  finalized: "Finalized",
  in_effect: "In effect",
  contested_vacated: "Contested",
};
export const STAGE_ORDER = ["proposed", "comment_open", "finalized", "in_effect", "contested_vacated"] as const;

/** recommended_action → display label (never a prediction, spec §15). */
export const ACTION_LABEL: Record<string, string> = {
  comment: "Comment",
  monitor: "Monitor",
  call_counsel: "Call counsel",
  no_action: "No action",
};

/** Source token → display name. */
export const SOURCE_LABEL: Record<string, string> = {
  congress: "Congress",
  federal_register: "Federal Register",
  openstates: "State legislature",
};

export function displaySource(card: Pick<SurfacedCard, "agency" | "source">): string {
  return card.agency ?? SOURCE_LABEL[card.source] ?? card.source;
}

export function displayJurisdiction(postal: string | null): string {
  return postal ? postal.toUpperCase() : "Federal";
}

/** Category token → chip label. */
export function categoryLabel(c: string): string {
  const words = c.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Profile jurisdictions ('us','us-ca',…) → home-state postals ['CA',…]. */
export function homeStates(jurisdictions: string[]): string[] {
  return jurisdictions
    .filter((j) => j !== "us")
    .map((j) => j.replace(/^us-/, "").toUpperCase());
}

/** Tile-grid US map: each state = one tile, roughly geographic (col,row). */
export const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [11, 0],
  WA: [1, 1], ID: [2, 1], MT: [3, 1], ND: [4, 1], MN: [5, 1], WI: [6, 1], MI: [8, 1], NY: [9, 1], VT: [10, 1], NH: [11, 1],
  OR: [1, 2], NV: [2, 2], WY: [3, 2], SD: [4, 2], IA: [5, 2], IL: [6, 2], IN: [7, 2], OH: [8, 2], PA: [9, 2], NJ: [10, 2], MA: [11, 2],
  CA: [1, 3], UT: [2, 3], CO: [3, 3], NE: [4, 3], MO: [5, 3], KY: [6, 3], WV: [7, 3], VA: [8, 3], MD: [9, 3], DE: [10, 3], CT: [11, 3],
  AZ: [2, 4], NM: [3, 4], KS: [4, 4], AR: [5, 4], TN: [6, 4], NC: [7, 4], SC: [8, 4], DC: [9, 4], RI: [11, 4],
  OK: [4, 5], LA: [5, 5], MS: [6, 5], AL: [7, 5], GA: [8, 5],
  HI: [0, 6], TX: [4, 6], FL: [9, 6],
};

/** Onboarding-modal option lists (mirror spec §10's question→field map). */
export const BIZ_TYPES = [
  { id: "software", label: "Software / SaaS" },
  { id: "goods", label: "Goods / e-commerce" },
  { id: "food", label: "Food" },
  { id: "hardware", label: "Hardware" },
] as const;

export const ATTR_OPTIONS = [
  { id: "subscription", label: "Sells subscriptions / auto-renewal" },
  { id: "imports", label: "Imports goods or components" },
  { id: "foodMaker", label: "Makes, packs, or holds food" },
  { id: "contractors", label: "Uses 1099 contractors" },
] as const;

export const STATE_OPTIONS = ["US", "CA", "TX", "NY", "WA", "IL", "CO", "GA"] as const;
