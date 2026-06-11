"use client";

/**
 * FloatingCards — the auto-cycling annotation cards over the map (spec §12).
 * Four faces built from board.floating: THREAT (the move + sourced provenance),
 * STATUS (factual next events only — no vote predictions), IMPACT (who's hit +
 * a LABELED estimate only when grounded, never a bare number), ACTION (the
 * recommended step + a link to the official portal).
 *
 * Motion: soft cross-fade every ~3s, pause on hover/focus, a play/pause toggle.
 * prefers-reduced-motion → no auto-advance; the dot row becomes a manual stepper.
 */
import { useEffect, useRef, useState } from "react";
import type { FloatingCardSet } from "@/app/lib/board";
import { Pill, Mono, SurfaceCard } from "@/app/components/ui";
import styles from "./FloatingCards.module.css";

const CYCLE_MS = 3400;

function formatDate(iso: string): string {
  // Parse as a plain calendar date (avoid TZ drift on the YYYY-MM-DD strings).
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Face = "threat" | "status" | "impact" | "action";

export function FloatingCards({ floating }: { floating: FloatingCardSet }) {
  // Only render faces that have data; preserve the THREAT→STATUS→IMPACT→ACTION order.
  const faces: Face[] = (["threat", "status", "impact", "action"] as Face[]).filter(
    (f) => floating[f] != null,
  );

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Keep the index valid if the face set changes (e.g. profile switch).
  useEffect(() => {
    setIndex((i) => (faces.length === 0 ? 0 : i % faces.length));
  }, [faces.length]);

  const autoAdvance = playing && !hovered && !reduced && faces.length > 1;
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = () => setIndex((i) => (i + 1) % faces.length);

  useEffect(() => {
    if (!autoAdvance) return;
    const id = window.setInterval(() => advanceRef.current(), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [autoAdvance]);

  if (faces.length === 0) {
    return (
      <SurfaceCard>
        <Pill kind="neutral">No headline</Pill>
        <p className={styles.empty} style={{ marginTop: 8, marginBottom: 0 }}>
          Nothing is cycling yet. Once a tracked rule surfaces, its move, status, impact, and
          recommended action ride along here.
        </p>
      </SurfaceCard>
    );
  }

  const active = faces[index];

  return (
    <div
      className={styles.stage}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      <div className={styles.bar}>
        <span className={styles.cycleTag}>
          <span className={styles.glyph} aria-hidden="true">
            &#9097;
          </span>
          {reduced ? "Step through" : "Auto-cycling"}
        </span>
        {!reduced && (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause cycling" : "Resume cycling"}
          >
            <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>

      <div className={styles.deck}>
        {faces.map((face, i) => (
          <div
            key={face}
            className={`${styles.card} ${i === index ? styles.active : ""}`}
            aria-hidden={i === index ? undefined : true}
          >
            <SurfaceCard style={{ height: "100%" }}>
              <CardFace face={face} floating={floating} />
            </SurfaceCard>
          </div>
        ))}
      </div>

      <div className={styles.dots} role="tablist" aria-label="Floating card faces">
        {faces.map((face, i) => (
          <button
            key={face}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Show ${face} card`}
            className={`${styles.dot} ${i === index ? styles.on : ""}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
        aria-live="polite"
      >
        Showing the {active} card.
      </span>
    </div>
  );
}

function CardFace({ face, floating }: { face: Face; floating: FloatingCardSet }) {
  if (face === "threat" && floating.threat) {
    const t = floating.threat;
    return (
      <div className={styles.cardInner}>
        <div className={styles.idRow}>
          <Pill kind="threat">The Move</Pill>
          <Mono style={{ fontSize: 12, color: "var(--ink-soft)" }}>{t.identifier}</Mono>
        </div>
        <div className={styles.headline}>{t.title}</div>
        <p className={styles.body} style={{ margin: 0 }}>
          {t.headline}
        </p>
        {t.provenance && (
          <div className={styles.spacer}>
            <span className={styles.metaLabel}>Provenance</span>
            <p className={styles.body} style={{ margin: "3px 0 0" }}>
              {t.provenance}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (face === "status" && floating.status) {
    const s = floating.status;
    return (
      <div className={styles.cardInner}>
        <div className={styles.idRow}>
          <Pill kind="status">Status</Pill>
          <Mono style={{ fontSize: 12, color: "var(--ink-soft)" }}>{s.identifier}</Mono>
        </div>
        <Field label="Stage" value={s.stage.replace(/_/g, " ")} />
        <Field label="Latest action" value={formatDate(s.lastActionDate)} />
        <Field
          label="Comment window"
          value={s.commentCloseDate ? `Closes ${formatDate(s.commentCloseDate)}` : "Not open for comment"}
        />
        <p className={styles.body} style={{ margin: "4px 0 0" }}>
          {s.status}
        </p>
      </div>
    );
  }

  if (face === "impact" && floating.impact) {
    const im = floating.impact;
    return (
      <div className={styles.cardInner}>
        <div className={styles.idRow}>
          <Pill kind="impact">Impact</Pill>
          <Mono style={{ fontSize: 12, color: "var(--ink-soft)" }}>{im.identifier}</Mono>
        </div>
        <div className={styles.headline} style={{ fontSize: 14 }}>
          Why this hits you
        </div>
        <p className={styles.body} style={{ margin: 0 }}>
          {im.whoIsAffected}
        </p>
        {im.impactEstimate ? (
          <div className={styles.estimate}>
            <span className={styles.estimateLabel}>Estimated impact</span>
            {im.impactEstimate}
          </div>
        ) : (
          <p className={styles.body} style={{ margin: "auto 0 0", fontStyle: "italic" }}>
            No grounded dollar estimate — we will not invent one.
          </p>
        )}
      </div>
    );
  }

  if (face === "action" && floating.action) {
    const a = floating.action;
    return (
      <div className={styles.cardInner}>
        <div className={styles.idRow}>
          <Pill kind="action">Action</Pill>
          <Mono style={{ fontSize: 12, color: "var(--ink-soft)" }}>{a.identifier}</Mono>
        </div>
        <div className={styles.headline} style={{ fontSize: 14 }}>
          Recommended next step
        </div>
        <p className={styles.body} style={{ margin: 0, textTransform: "capitalize" }}>
          {a.recommendedAction.replace(/_/g, " ")}
        </p>
        {a.actionUrl && (
          <a
            className={styles.actionLink}
            href={a.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the official portal
            <span aria-hidden="true">&#8599;</span>
          </a>
        )}
      </div>
    );
  }

  return null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className={styles.metaLabel}>{label}</span>{" "}
      <span className={styles.metaVal} style={{ textTransform: "capitalize" }}>
        {value}
      </span>
    </div>
  );
}
