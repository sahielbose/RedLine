/**
 * Overview — the Overview tab hero (spec §2, §12). Composes the SURFACED
 * THREATS rail, the US threat map, and the auto-cycling floating annotation
 * cards into the §12 layout for the ALREADY-SCORED active board. Switching the
 * "Viewing as" business swaps the `board` prop, which recolors the map and
 * re-fills the rail (no recompute here).
 *
 * Server component: it only lays out the three client leaves and passes data
 * through. Empty state speaks in the product voice.
 */
import type { BoardData } from "@/app/lib/board";
import { ThreatMap } from "@/app/components/ThreatMap";
import { FloatingCards } from "@/app/components/FloatingCards";
import { SurfacedThreats } from "@/app/components/SurfacedThreats";
import styles from "./Overview.module.css";

export function Overview({ board }: { board: BoardData }) {
  const hasThreats = board.surfaced.length > 0;
  const hasFloating = board.floating.threat != null;

  return (
    <div className={styles.grid}>
      <aside className={styles.rail}>
        <SurfacedThreats board={board} />
      </aside>

      <section className={styles.stage} aria-label="US threat map">
        <div className={styles.stageHead}>
          <span className={styles.stageTitle}>Threat across the country</span>
          <span className={styles.viewingAs}>
            Viewing as <strong>{board.label}</strong>
          </span>
        </div>

        {hasThreats ? (
          <div className={styles.mapArea}>
            <ThreatMap board={board} />
            {/* One FloatingCards instance: a map overlay on desktop, flowing
                below the map on mobile (CSS only) — no duplicate timer/tablist. */}
            {hasFloating && (
              <div className={styles.cards}>
                <FloatingCards floating={board.floating} />
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyStage}>
            <p className={styles.emptyLead}>The map is quiet for {board.label}.</p>
            <p className={styles.emptyBody}>
              Nothing has crossed the line yet. Track a rule or switch the business you are viewing
              as, and the states it touches light up here — scored, sorted, and ready to act on.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
