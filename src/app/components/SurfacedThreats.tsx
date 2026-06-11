"use client";

/**
 * SurfacedThreats — the Overview left rail (spec §12). Section header + a live
 * count, then the scored list (sorted desc) with the mono identifier, a
 * truncated title, a small SeverityStamp and a NEW badge. Selecting a row
 * highlights it (royal-blue spine).
 *
 * Footer is HONEST about the seeded demo data (spec §15): a tagline plus the
 * real surfaced/total counts — never a fabricated "130k+".
 */
import { useState } from "react";
import type { BoardData } from "@/app/lib/board";
import { POSTAL_TO_NAME } from "@/app/lib/geo";
import { SectionLabel, SeverityStamp, NewBadge, Mono } from "@/app/components/ui";
import styles from "./SurfacedThreats.module.css";

export function SurfacedThreats({ board }: { board: BoardData }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Already scored upstream; sort desc by score for the rail order.
  const rows = [...board.surfaced].sort((a, b) => b.score - a.score);

  return (
    <div className={styles.rail}>
      <div className={styles.head}>
        <SectionLabel>Surfaced Threats</SectionLabel>
        <span className={styles.count} aria-label={`${rows.length} surfaced`}>
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          Nothing crosses the line for {board.label} yet. Track a rule and it lands here, scored
          against your business.
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((card) => {
            const isSel = selected === card.id;
            const region = card.postal ? POSTAL_TO_NAME[card.postal] ?? card.jurisdiction : "Federal";
            return (
              <li key={card.id}>
                <button
                  type="button"
                  className={`${styles.row} ${isSel ? styles.selected : ""}`}
                  aria-pressed={isSel}
                  onClick={() => setSelected((cur) => (cur === card.id ? null : card.id))}
                >
                  <div className={styles.rowTop}>
                    <span className={styles.idCluster}>
                      <Mono style={{ fontSize: 12, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                        {card.identifier}
                      </Mono>
                      {card.isNew && <NewBadge />}
                    </span>
                    <SeverityStamp score={card.score} severity={card.severity} />
                  </div>
                  <span className={styles.title}>{card.title}</span>
                  <span className={styles.juris}>{region}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.footer}>
        <div className={styles.footTag}>
          Watching every bill and rule moving through Congress and all 50 states — surfacing only
          what threatens {board.label}.
        </div>
        <div className={styles.footNote}>
          <span className={styles.demoDot} aria-hidden="true" />
          Seeded demo data: {rows.length} surfaced of {board.totalItems} sampled
          {board.filteredOut > 0 ? `, ${board.filteredOut} filtered as low relevance` : ""}.
        </div>
      </div>
    </div>
  );
}
