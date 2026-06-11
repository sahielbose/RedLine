/**
 * Shared visual primitives for the dashboard (spec §12). One vocabulary so every
 * view looks coherent: pill labels, severity stamps, NEW badge, mono identifiers.
 * Tokens come from globals.css (warm parchment / navy ink / one royal-blue accent).
 */
import type { CSSProperties } from "react";
import type { SeverityLabel } from "@/lib/types";

/** Severity → token pair (used by the feed stamps and the map legend). */
export const SEVERITY_STYLE: Record<SeverityLabel, { color: string; bg: string }> = {
  Critical: { color: "var(--critical)", bg: "var(--critical-bg)" },
  High: { color: "var(--high)", bg: "var(--high-bg)" },
  Monitor: { color: "var(--monitor)", bg: "var(--monitor-bg)" },
  Low: { color: "var(--safe)", bg: "var(--safe-bg)" },
};

/** Map a 0–5 score to a map-fill along the blue-grey → navy ramp (spec §12). */
export function mapFill(score: number | undefined): string {
  if (score === undefined) return "var(--map-empty)";
  if (score >= 5) return "var(--map-hot)";
  if (score >= 4) return "#3a4a73";
  if (score >= 3) return "var(--map-mid)";
  return "var(--map-empty)";
}

export function Mono({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <span className="mono" style={{ fontVariantLigatures: "none", ...style }}>
      {children}
    </span>
  );
}

export type PillKind = "threat" | "status" | "impact" | "action" | "intel" | "neutral";

const PILL_ACCENT: Record<PillKind, string> = {
  threat: "var(--critical)",
  status: "var(--monitor)",
  impact: "var(--high)",
  action: "var(--accent)",
  intel: "var(--ink-soft)",
  neutral: "var(--muted)",
};

/** Thin-outlined, uppercase, letter-spaced pill label (THREAT / STATUS / …). */
export function Pill({ kind = "neutral", children }: { kind?: PillKind; children: React.ReactNode }) {
  const color = PILL_ACCENT[kind];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "2px 8px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Category chip (subtle, on the warm inset). */
export function CategoryChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--ink-soft)",
        background: "var(--inset)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "1px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** The severity stamp on a Bills card: mono score + label, severity-colored. */
export function SeverityStamp({ score, severity }: { score: number; severity: SeverityLabel }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        color: s.color,
        background: s.bg,
        borderRadius: 8,
        padding: "3px 9px",
        fontWeight: 600,
      }}
    >
      <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
        {score}
      </span>
      <span style={{ fontSize: 11, letterSpacing: "0.04em" }}>{severity}</span>
    </span>
  );
}

/** Royal-blue NEW badge (the one bright accent, spec §12). */
export function NewBadge() {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.1em",
        color: "#fff",
        background: "var(--accent)",
        borderRadius: 4,
        padding: "1px 5px",
        verticalAlign: "middle",
      }}
    >
      NEW
    </span>
  );
}

/** A white app-surface card with a hairline border and soft hover lift. */
export function SurfaceCard({
  children,
  style,
  onClick,
  interactive,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  interactive?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: 14,
        cursor: interactive ? "pointer" : undefined,
        transition: "box-shadow var(--motion), transform var(--motion)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Small uppercase section label (rail headers etc.). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--ink-soft)",
      }}
    >
      {children}
    </div>
  );
}
