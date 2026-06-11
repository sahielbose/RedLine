"use client";

/**
 * MemoPanel — the right-side memo slide-over for a selected Bills item (spec §2).
 *
 * Renders the four memo parts (what_it_does / status_and_next_steps /
 * who_is_affected / recommended_action + note) plus a CITATIONS section listing
 * every citation's claim and its VERBATIM snippet with a "verified" check —
 * citations are verified by CODE upstream (the substring check decides, not the
 * model), so all shown here are verified (CLAUDE.md rule 9).
 *
 * impact_estimate is shown ONLY when non-null and clearly LABELED (it is
 * sanitized upstream to drop bare unlabeled figures — spec §15); otherwise we
 * state plainly that there is no quantified estimate.
 *
 * When card.memo is null the score fell below MEMO_THRESHOLD, so no memo is
 * drafted — we show the per-business justification and say so honestly.
 *
 * Accessibility: role="dialog" + aria-modal, ESC to close, a close button, focus
 * moved into the panel on open and restored to the trigger on close, and a basic
 * Tab focus loop within the dialog. Transition is 250ms (--motion); reduced
 * motion is honored globally.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecommendedAction } from "@/lib/types";
import type { SurfacedCard } from "@/app/lib/board";
import { Mono, Pill, SeverityStamp, SectionLabel } from "@/app/components/ui";
import styles from "./MemoPanel.module.css";

const ACTION_LABEL: Record<RecommendedAction, string> = {
  comment: "Submit a comment",
  monitor: "Monitor",
  call_counsel: "Call counsel",
  no_action: "No action needed",
};

const SECTIONS: Array<{ key: "what_it_does" | "status_and_next_steps" | "who_is_affected"; label: string }> = [
  { key: "what_it_does", label: "What it does" },
  { key: "status_and_next_steps", label: "Status & next steps" },
  { key: "who_is_affected", label: "Who is affected" },
];

export function MemoPanel({
  card,
  open,
  onClose,
}: {
  card: SurfacedCard | null;
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Remember what had focus so we can restore it when the slide-over closes.
  const restoreRef = useRef<HTMLElement | null>(null);
  // Mount-gate so the enter transition actually plays (render closed, then open).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      restoreRef.current = (document.activeElement as HTMLElement) ?? null;
      // next frame → toggle the open class so transform/opacity animate
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    return undefined;
  }, [open]);

  // Move focus into the panel once it is open + mounted.
  useEffect(() => {
    if (open && mounted) panelRef.current?.focus();
  }, [open, mounted]);

  // Restore focus to the trigger on close.
  useEffect(() => {
    if (!open && restoreRef.current) {
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Minimal focus loop: keep Tab within the dialog.
      const root = panelRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open && !mounted && !card) return null;
  if (!card) return null;

  const memo = card.memo;

  return (
    <>
      <div
        className={`${styles.backdrop} ${mounted ? styles.backdropOpen : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`${styles.panel} ${mounted ? styles.panelOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Memo for ${card.identifier}: ${card.title}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <div className={styles.headerMain}>
            <div className={styles.headerMeta}>
              <SeverityStamp score={card.score} severity={card.severity} />
              <Mono style={{ fontSize: 12, color: "var(--ink-soft)" }}>{card.identifier}</Mono>
            </div>
            <h2 className={styles.title}>{card.title}</h2>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close memo">
            ×
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span>{card.agency ?? card.source}</span>
            <span>{card.jurisdiction.toUpperCase()}</span>
            <span>{card.status}</span>
          </div>

          {memo ? (
            <>
              {SECTIONS.map((s) => (
                <section key={s.key} className={styles.section}>
                  <SectionLabel>{s.label}</SectionLabel>
                  <p className={styles.sectionBody}>{memo[s.key]}</p>
                </section>
              ))}

              <section className={styles.section}>
                <SectionLabel>Recommended action</SectionLabel>
                <div style={{ marginTop: 2 }}>
                  <Pill kind="action">{ACTION_LABEL[memo.recommended_action]}</Pill>
                </div>
                {memo.recommended_action_note ? (
                  <p className={styles.actionNote}>{memo.recommended_action_note}</p>
                ) : null}
              </section>

              <section className={styles.section}>
                <SectionLabel>Estimated impact</SectionLabel>
                {memo.impact_estimate ? (
                  <p className={styles.estimate}>{memo.impact_estimate}</p>
                ) : (
                  <p className={styles.estimateMuted}>
                    No quantified estimate — qualitative only. RedLine never shows an unlabeled figure.
                  </p>
                )}
              </section>

              <section className={styles.section}>
                <SectionLabel>Citations</SectionLabel>
                {memo.citations.length > 0 ? (
                  <>
                    <ul className={styles.citationList}>
                      {memo.citations.map((c, i) => (
                        <li key={i} className={styles.citation}>
                          <div className={styles.citationClaim}>
                            <span>{c.claim}</span>
                            <span className={styles.verifiedTick} title="Snippet verified against the source by code">
                              ✓ Verified
                            </span>
                          </div>
                          <p className={styles.snippet}>&ldquo;{c.snippet}&rdquo;</p>
                          {c.locator ? <div className={styles.locator}>{c.locator}</div> : null}
                        </li>
                      ))}
                    </ul>
                    <p className={styles.verifiedNote}>
                      Every snippet is a verbatim substring of the source, checked by code — not trusted from
                      the model.
                    </p>
                  </>
                ) : (
                  <p className={styles.estimateMuted}>
                    No citations passed verification, so none are shown — claims are dropped unless a snippet
                    matches the source text.
                  </p>
                )}
              </section>
            </>
          ) : (
            <>
              <section className={styles.section}>
                <SectionLabel>Why this hits you</SectionLabel>
                <p className={styles.sectionBody}>{card.justification}</p>
              </section>
              <p className={styles.noMemo}>
                No memo is drafted below the memo threshold. This item scored {card.score} ({card.severity}),
                so RedLine is tracking it but hasn&apos;t written a full cited brief yet. It moves to a drafted
                memo if its relevance rises.
              </p>
            </>
          )}
        </div>

        <footer className={styles.footer}>
          {card.actionUrl ? (
            <a className={styles.actionLink} href={card.actionUrl} target="_blank" rel="noreferrer">
              Open the official portal →
            </a>
          ) : (
            <span className={styles.draftNote}>No public portal linked.</span>
          )}
          {memo ? <span className={styles.confidence}>Confidence: {memo.confidence}</span> : null}
          <span className={styles.draftNote}>Draft — pending approval</span>
        </footer>
      </div>
    </>
  );
}
