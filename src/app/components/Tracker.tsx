/**
 * Tracker — a kanban of the surfaced items for the active business, bucketed by
 * normalized legislative stage (spec §2; STAGES in src/lib/types.ts):
 * Proposed → Comment open → Finalized → In effect → Contested/Vacated.
 * The board prop is already scored for the active profile, so switching the
 * "Viewing as" business just re-fills the columns — no recompute here.
 */
import type { BoardData, SurfacedCard } from "@/app/lib/board";
import type { Stage } from "@/lib/types";
import { STAGES } from "@/lib/types";
import { Mono, SeverityStamp, NewBadge, CategoryChip } from "@/app/components/ui";
import { POSTAL_TO_NAME } from "@/app/lib/geo";
import styles from "./Tracker.module.css";

/** Column presentation per normalized stage: label, dot color, empty-state copy. */
const STAGE_META: Record<Stage, { label: string; dot: string; empty: string }> = {
  proposed: {
    label: "Proposed",
    dot: "var(--map-mid)",
    empty: "Nothing introduced for this business yet.",
  },
  comment_open: {
    label: "Comment open",
    dot: "var(--monitor)",
    empty: "No open comment windows right now.",
  },
  finalized: {
    label: "Finalized",
    dot: "var(--high)",
    empty: "No finalized rules tracked here yet.",
  },
  in_effect: {
    label: "In effect",
    dot: "var(--critical)",
    empty: "Nothing has reached effect for this business.",
  },
  contested_vacated: {
    label: "Contested / Vacated",
    dot: "var(--muted)",
    empty: "No items are being challenged or vacated.",
  },
};

/** Coerce an item's raw stage string to a known Stage; default to Proposed. */
function toStage(raw: string): Stage {
  return (STAGES as readonly string[]).includes(raw) ? (raw as Stage) : "proposed";
}

function jurisdictionName(card: SurfacedCard): string {
  if (card.postal) return POSTAL_TO_NAME[card.postal] ?? card.postal.toUpperCase();
  return "Federal";
}

export function Tracker({ board }: { board: BoardData }) {
  const byStage: Record<Stage, SurfacedCard[]> = {
    proposed: [],
    comment_open: [],
    finalized: [],
    in_effect: [],
    contested_vacated: [],
  };
  for (const card of board.surfaced) byStage[toStage(card.stage)].push(card);

  return (
    <div>
      <div className={styles.head}>
        <div>
          <h2 className={styles.headTitle}>Tracker</h2>
          <p className={styles.headSub}>
            Everything surfaced for {board.label}, lined up by where it sits in the
            rulemaking lifecycle. Items move left to right as they advance.
          </p>
        </div>
      </div>

      <div className={styles.board}>
        {STAGES.map((stage) => {
          const meta = STAGE_META[stage];
          const cards = byStage[stage];
          return (
            <section className={styles.column} key={stage} aria-label={meta.label}>
              <div className={styles.colHead}>
                <span className={styles.colTitle}>
                  <span className={styles.colDot} style={{ background: meta.dot }} />
                  {meta.label}
                </span>
                <span className={styles.colCount}>{cards.length}</span>
              </div>
              <div className={styles.colBody}>
                {cards.length === 0 ? (
                  <p className={styles.colEmpty}>{meta.empty}</p>
                ) : (
                  cards.map((card) => <TrackerCard key={card.id} card={card} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TrackerCard({ card }: { card: SurfacedCard }) {
  const primaryCategory = card.categories[0];
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardIdentRow}>
          <Mono>
            <span className={styles.cardIdent}>{card.identifier}</span>
          </Mono>
          {card.isNew && <NewBadge />}
        </span>
        <SeverityStamp score={card.score} severity={card.severity} />
      </div>
      <p className={styles.cardTitle}>{card.title}</p>
      <div className={styles.cardMeta}>
        <span className={styles.cardJuris}>{jurisdictionName(card)}</span>
        {primaryCategory && <CategoryChip>{primaryCategory}</CategoryChip>}
        {card.commentCloseDate && <span>Comment closes {card.commentCloseDate}</span>}
      </div>
    </article>
  );
}
