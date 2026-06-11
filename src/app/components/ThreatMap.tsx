"use client";

/**
 * ThreatMap — the Overview hero. A US states choropleth shaded by the active
 * business's threat board (spec §12). Soft blue-grey → navy ramp via mapFill();
 * hairline state borders; hover tooltip; click focuses a state with the one
 * royal-blue accent. The `fill` transition (~250ms) smooths hover/focus changes
 * WITHIN a profile; the visible recolor on a "Viewing as" SWITCH is carried by
 * the parent board wrapper's cross-fade (Dashboard remounts the keyed subtree),
 * not by per-state fill tweening.
 *
 * Geometry: us-atlas (states-10m) topology → topojson feature() → GeoJSON, then
 * geoAlbersUsa().fitSize() + geoPath(). All offline / no keys.
 */
import { useMemo, useState } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import statesTopo from "us-atlas/states-10m.json";
import type { BoardData } from "@/app/lib/board";
import { FIPS_TO_POSTAL, POSTAL_TO_NAME } from "@/app/lib/geo";
import { mapFill } from "@/app/components/ui";
import styles from "./ThreatMap.module.css";

const WIDTH = 720;
const HEIGHT = 440;

// Convert the topology once at module load (deterministic, no per-render cost).
const topo = statesTopo as unknown as Topology;
const STATES: FeatureCollection<Geometry> = feature(
  topo,
  topo.objects.states as GeometryCollection,
) as FeatureCollection<Geometry>;

interface Tip {
  x: number;
  y: number;
  postal: string | null;
}

export function ThreatMap({ board }: { board: BoardData }) {
  const [focused, setFocused] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // Project + path generator fitted to our viewBox (stable for this geometry).
  const pathFor = useMemo(() => {
    const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], STATES);
    return geoPath(projection);
  }, []);

  const trackedCount = Object.keys(board.mapByState).length;
  const ariaLabel =
    trackedCount === 0
      ? `US threat map for ${board.label}. No states have tracked threats yet.`
      : `US threat map for ${board.label}. ${trackedCount} ${
          trackedCount === 1 ? "state has" : "states have"
        } tracked threats; darker states carry higher-severity activity.`;

  const tipThreat = tip?.postal ? board.mapByState[tip.postal] : undefined;

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setTip(null)}
      >
        {STATES.features.map((f: Feature<Geometry>) => {
          const fips = String(f.id);
          const postal = FIPS_TO_POSTAL[fips] ?? null;
          const threat = postal ? board.mapByState[postal] : undefined;
          const d = pathFor(f) ?? undefined;
          if (!d) return null;
          const name = postal ? POSTAL_TO_NAME[postal] ?? "" : "";
          const isFocused = focused === fips;
          const label = name
            ? threat
              ? `${name}: ${threat.severity}, ${threat.count} tracked`
              : `${name}: no tracked threats`
            : name;
          return (
            <path
              key={fips}
              d={d}
              className={`${styles.state} ${isFocused ? styles.focused : ""}`}
              fill={mapFill(threat?.score)}
              tabIndex={0}
              role="button"
              aria-label={label}
              aria-pressed={isFocused}
              onMouseMove={(e) => {
                const svg = e.currentTarget.ownerSVGElement;
                if (!svg) return;
                const r = svg.getBoundingClientRect();
                setTip({
                  // Scale client coords back into viewBox space for absolute positioning.
                  x: ((e.clientX - r.left) / r.width) * 100,
                  y: ((e.clientY - r.top) / r.height) * 100,
                  postal,
                });
              }}
              onFocus={() => setFocused(fips)}
              onClick={() => setFocused((cur) => (cur === fips ? null : fips))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFocused((cur) => (cur === fips ? null : fips));
                }
              }}
            />
          );
        })}
      </svg>

      {tip && tip.postal && POSTAL_TO_NAME[tip.postal] && (
        <div
          className={styles.tooltip}
          style={{ left: `${tip.x}%`, top: `${tip.y}%` }}
          role="status"
        >
          <div className={styles.tipName}>{POSTAL_TO_NAME[tip.postal]}</div>
          {tipThreat ? (
            <>
              <div className={styles.tipScore}>{tipThreat.severity}</div>
              <div className={styles.tipMeta}>
                {tipThreat.count} tracked {tipThreat.count === 1 ? "item" : "items"}
              </div>
            </>
          ) : (
            <div className={styles.tipMeta}>No tracked threats</div>
          )}
        </div>
      )}

      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--map-empty)" }} />
          None tracked
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--map-mid)" }} />
          Monitor
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "#3a4a73" }} />
          High
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--map-hot)" }} />
          Critical
        </span>
      </div>
    </div>
  );
}
