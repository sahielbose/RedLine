"use client";

/**
 * Geographic US threat choropleth (Albers USA, real state shapes - replaces
 * the square tile grid). Shading comes from the server-computed board
 * (`mapByState`, keyed by lowercase postal): score >= 4 → hot navy, score 3 →
 * blue-grey "watching", else clear. Home states get a dashed red outline;
 * the focused state gets an accent ring. Click a state to focus it (plus
 * Federal). Fully keyboard-operable: every state is a focusable button.
 *
 * Geometry is baked into us-map-data.ts at build time (us-atlas, public-domain
 * census geography) - zero runtime geo dependencies.
 */
import { useId } from "react";
import type { StateThreat } from "@/app/lib/board";
import { NATION_PATH, STATE_PATHS, US_MAP_VIEWBOX } from "@/app/lib/us-map-data";

export interface USMapProps {
  /** BoardData.mapByState - lowercase-postal → threat summary. */
  map: Record<string, StateThreat>;
  selected?: string | null;
  onSelect?: (state: string | null) => void;
  /** Reports the hovered state (uppercase postal) or null on leave. */
  onHover?: (state: string | null) => void;
  /** Home-state postals (uppercase), ringed on the map. */
  home?: string[];
  /** State of the item the floating cards are showing (uppercase) - soft accent ring. */
  active?: string | null;
  compact?: boolean;
}

export function USMap({ map, selected = null, onSelect, onHover, home = [], active = null, compact }: USMapProps) {
  const shadowId = useId();

  const threatOf = (postal: string) => map[postal.toLowerCase()];
  const classOf = (postal: string) => {
    const info = threatOf(postal);
    return (
      "st" +
      (info && info.score >= 4 ? " hot" : info && info.score === 3 ? " mid" : "") +
      (selected === postal ? " sel" : "") +
      (home.includes(postal) ? " home" : "")
    );
  };
  const titleOf = (postal: string, name: string) => {
    const info = threatOf(postal);
    return info
      ? `${name}: ${info.count} state item${info.count > 1 ? "s" : ""} (top: ${info.top}). Click to focus ${postal} + Federal.`
      : `${name}: no state-level items yet. Click to focus ${postal} + Federal.`;
  };

  // Home + selected states re-render as outlines on top so their strokes are
  // never buried under neighboring shapes.
  const outlined = STATE_PATHS.filter(
    (s) => home.includes(s.postal) || selected === s.postal || active === s.postal,
  );

  return (
    <svg
      className={"usmap" + (compact ? " compact" : "")}
      viewBox={US_MAP_VIEWBOX}
      role="group"
      aria-label="US map - state threat status. Click a state to focus it plus federal items."
      preserveAspectRatio="xMidYMid meet"
      onMouseLeave={() => onHover && onHover(null)}
    >
      <defs>
        <filter id={shadowId} x="-4%" y="-4%" width="108%" height="112%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#21180C" floodOpacity="0.18" />
        </filter>
      </defs>

      {/* paper-cutout shadow under the nation silhouette */}
      <path d={NATION_PATH} className="usmap-shadow" filter={`url(#${shadowId})`} aria-hidden="true" />

      {STATE_PATHS.map((s) => {
        const info = threatOf(s.postal);
        return (
          <path
            key={s.postal}
            d={s.d}
            className={classOf(s.postal)}
            role="button"
            tabIndex={onSelect ? 0 : -1}
            aria-pressed={selected === s.postal}
            aria-label={
              `Focus ${s.name} plus federal` +
              (info ? `, ${info.count} state item${info.count > 1 ? "s" : ""}` : ", no state items yet")
            }
            onClick={() => onSelect && onSelect(selected === s.postal ? null : s.postal)}
            onMouseEnter={() => onHover && onHover(s.postal)}
            onFocus={() => onHover && onHover(s.postal)}
            onKeyDown={(e) => {
              if (onSelect && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSelect(selected === s.postal ? null : s.postal);
              }
            }}
          >
            <title>{titleOf(s.postal, s.name)}</title>
          </path>
        );
      })}

      {/* outline pass: home + focused states drawn last so rings stay visible */}
      {outlined.map((s) => (
        <path
          key={"ring-" + s.postal}
          d={s.d}
          className={
            "st-ring" +
            (selected === s.postal ? " sel" : active === s.postal ? " active" : "") +
            (home.includes(s.postal) ? " home" : "")
          }
          aria-hidden="true"
        />
      ))}

      {/* radar ping on the active (card-driven) state: an expanding ring that reads
          as a live signal. Purely cosmetic; CSS animation is globally disabled
          under prefers-reduced-motion, leaving a static dot. */}
      {active &&
        (() => {
          const a = STATE_PATHS.find((s) => s.postal === active);
          return a ? (
            <g aria-hidden="true">
              <circle className="usmap-ping" cx={a.cx} cy={a.cy} r={5} />
              <circle className="usmap-ping-dot" cx={a.cx} cy={a.cy} r={3} />
            </g>
          ) : null;
        })()}
    </svg>
  );
}
