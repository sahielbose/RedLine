"use client";

/**
 * Tile-grid US threat map (ported from the reference prototype): each state is
 * one tile, roughly geographic. Shading comes from the server-computed board
 * (`mapByState`, keyed by lowercase postal): score >= 4 → hot navy, score 3 →
 * blue-grey "watching", else clear. Home states get a dashed red ring. Click a
 * tile to focus the cycling cards on that state.
 */
import { TILES } from "@/app/lib/ui";
import type { StateThreat } from "@/app/lib/board";

export interface TileMapProps {
  /** BoardData.mapByState - lowercase-postal → threat summary. */
  map: Record<string, StateThreat>;
  selected?: string | null;
  onSelect?: (state: string | null) => void;
  /** Home-state postals (uppercase), ringed on the map. */
  home?: string[];
  compact?: boolean;
}

export function TileMap({ map, selected = null, onSelect, home = [], compact }: TileMapProps) {
  return (
    <div className="tilegrid" style={compact ? { maxWidth: 420, marginTop: 18, gap: 3 } : undefined}>
      {Object.entries(TILES).map(([st, [c, r]], i) => {
        const info = map[st.toLowerCase()];
        const cls =
          "tile" +
          (info && info.score >= 4 ? " hot" : info && info.score === 3 ? " mid" : "") +
          (selected === st ? " sel" : "") +
          (home.includes(st) ? " home" : "");
        return (
          <button
            key={st}
            className={cls}
            style={{ gridColumn: c + 1, gridRow: r + 1, animationDelay: `${i * 8}ms`, fontSize: compact ? 8 : undefined }}
            title={info ? `${st} · ${info.count} item${info.count > 1 ? "s" : ""} · top: ${info.top}` : `${st} · clear`}
            onClick={() => onSelect && onSelect(selected === st ? null : st)}
            aria-label={`${st}${info ? `, ${info.count} relevant item${info.count > 1 ? "s" : ""}` : ", no relevant items"}`}
          >
            {st}
          </button>
        );
      })}
    </div>
  );
}
