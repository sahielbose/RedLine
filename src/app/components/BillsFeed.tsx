"use client";

/**
 * BillsFeed — the full scored feed for the business you're "Viewing as" (spec §2).
 *
 * Renders board.surfaced (already scored + sorted highest-threat-first; we sort
 * defensively too) as a list of cards. Each card shows a SeverityStamp, the mono
 * identifier, source + jurisdiction, category chips, status, the per-business
 * justification (the "why this hits you" line), a NEW badge for fresh items, and
 * a Track affordance. Clicking a card opens the MemoPanel slide-over.
 *
 * Below the list, an expander — "{filteredOut} items filtered out as low
 * relevance" — explains that those items failed Stage 0/A (category /
 * jurisdiction) for this business, making PRECISION visible (spec §2).
 *
 * The board prop is swapped wholesale when the profile switches (no recompute
 * here); React re-renders the new feed. Track state is local/illustrative — this
 * is clearly-labeled seeded demo data (spec §15).
 */
import { useMemo, useState } from "react";
import type { BoardData, SurfacedCard } from "@/app/lib/board";
import { CategoryChip, Mono, NewBadge, SeverityStamp, SurfaceCard } from "@/app/components/ui";
import { MemoPanel } from "@/app/components/MemoPanel";
import styles from "./BillsFeed.module.css";

/** Human-readable category labels (taxonomy tokens → product copy). */
const CATEGORY_LABEL: Record<string, string> = {
  wages_hours: "Wages & hours",
  leave_benefits: "Leave & benefits",
  classification_scheduling: "Classification & scheduling",
  licensing_registration: "Licensing & registration",
  taxes: "Taxes",
  data_privacy: "Data privacy",
  workplace_safety: "Workplace safety",
  accessibility: "Accessibility",
  software: "Software",
  goods: "Goods",
  food: "Food",
  hardware: "Hardware",
};

function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c.replace(/_/g, " ");
}

export function BillsFeed({ board }: { board: BoardData }) {
  const [selected, setSelected] = useState<SurfacedCard | null>(null);
  const [filteredOpen, setFilteredOpen] = useState(false);
  const [tracked, setTracked] = useState<Record<string, boolean>>({});

  // Defensive sort by score desc (the board arrives sorted; this is cheap + safe).
  const cards = useMemo(() => [...board.surfaced].sort((a, b) => b.score - a.score), [board.surfaced]);

  const toggleTrack = (id: string) => setTracked((t) => ({ ...t, [id]: !t[id] }));

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.headCount}>
          {cards.length} surfaced for <strong style={{ color: "var(--ink)" }}>{board.label}</strong>, sorted by
          threat
        </span>
      </div>

      {cards.length === 0 ? (
        <div className={styles.empty}>
          Nothing clears the relevance bar for {board.label} right now. Switch the business you&apos;re viewing
          as, or track a rule and it lands here.
        </div>
      ) : (
        <div className={styles.list}>
          {cards.map((card) => {
            const isTracked = Boolean(tracked[card.id]);
            return (
              <SurfaceCard
                key={card.id}
                interactive
                onClick={() => setSelected(card)}
                style={{ cursor: "pointer" }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={styles.card}
                  aria-label={`Open memo for ${card.identifier}: ${card.title}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(card);
                    }
                  }}
                >
                  <div className={styles.cardTop}>
                    <SeverityStamp score={card.score} severity={card.severity} />
                    <div className={styles.cardTopMain}>
                      <div className={styles.identifierRow}>
                        <Mono style={{ fontSize: 12, color: "var(--ink-soft)" }}>{card.identifier}</Mono>
                        {card.isNew ? <NewBadge /> : null}
                      </div>
                      <h3 className={styles.cardTitle}>{card.title}</h3>
                    </div>
                  </div>

                  <div className={styles.metaRow}>
                    <span>{card.agency ?? card.source}</span>
                    <span className={styles.metaDot}>·</span>
                    <span>{card.jurisdiction.toUpperCase()}</span>
                  </div>

                  {card.categories.length > 0 ? (
                    <div className={styles.chips}>
                      {card.categories.map((c) => (
                        <CategoryChip key={c}>{categoryLabel(c)}</CategoryChip>
                      ))}
                    </div>
                  ) : null}

                  <p className={styles.justification}>
                    <span className={styles.justLabel}>Why this hits you</span>
                    {card.justification}
                  </p>

                  <div className={styles.cardFoot}>
                    <span className={styles.status}>{card.status}</span>
                    <button
                      type="button"
                      className={`${styles.track} ${isTracked ? styles.trackOn : ""}`}
                      aria-pressed={isTracked}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTrack(card.id);
                      }}
                    >
                      {isTracked ? "✓ Tracking" : "Track"}
                    </button>
                  </div>
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}

      <div className={styles.filteredExpander}>
        <button
          type="button"
          className={styles.filteredBtn}
          aria-expanded={filteredOpen}
          onClick={() => setFilteredOpen((o) => !o)}
        >
          <span className={`${styles.filteredCaret} ${filteredOpen ? styles.filteredCaretOpen : ""}`}>▶</span>
          <span>
            <span className={styles.filteredCount}>{board.filteredOut}</span> item
            {board.filteredOut === 1 ? "" : "s"} filtered out as low relevance
          </span>
        </button>
        {filteredOpen ? (
          <div className={styles.filteredBody}>
            <p>
              These never reached scoring for {board.label}. They failed Stage 0/A — the category and
              jurisdiction filter — because their topic isn&apos;t in this business&apos;s subscribed modules,
              or they sit in a state this business doesn&apos;t operate in.
            </p>
            <p>
              That&apos;s the point: precision over volume. Switching the business you&apos;re viewing as
              re-runs the same filter, so an item filtered out here can surface for another profile.
            </p>
          </div>
        ) : null}
      </div>

      <p className={styles.footerNote}>
        Scored over {board.totalItems} seeded demo items. RedLine&apos;s mission is wide coverage — Congress,
        the Federal Register, and all 50 statehouses — shown here on a clearly-labeled demo set.
      </p>

      <MemoPanel card={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </div>
  );
}
