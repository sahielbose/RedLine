"use client";

/**
 * Floating annotation cards over the Overview map (spec §2): THREAT / STATUS /
 * IMPACT / ACTION for the active surfaced item, auto-cycling through the rail
 * with a progress bar. Presentational only - AppView owns the cycle state so
 * the left rail highlight stays in sync. Every field is real engine output:
 * no predicted votes, no invented figures; the action links only to an
 * official public portal (spec §15).
 */
import { ArrowUpRight, Pause, Play } from "lucide-react";
import type { SurfacedCard } from "@/app/lib/board";
import { ACTION_LABEL, STAGE_LABEL, band, displaySource, sevStyle } from "@/app/lib/ui";

export interface MapCardsProps {
  item: SurfacedCard | null;
  /** Position in the cycle, e.g. "2 / 5". */
  counter: string;
  /** Cycle duration (ms) for the progress bar; 0 hides the bar. */
  cycleMs: number;
  /** Re-keys the progress bar so it restarts on each advance. */
  cycleKey: string;
  paused: boolean;
  onTogglePause: () => void;
  onHoverChange: (hovering: boolean) => void;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

export function MapCards({
  item,
  counter,
  cycleMs,
  cycleKey,
  paused,
  onTogglePause,
  onHoverChange,
}: MapCardsProps) {
  if (!item) return null;

  const b = band(item.score);
  const move = item.memo?.what_it_does || item.summary || item.justification;
  const why = item.justification;
  const affected = item.memo?.who_is_affected ?? null;
  const estimate = item.memo?.impact_estimate ?? null;
  const action = ACTION_LABEL[item.memo?.recommended_action ?? "monitor"] ?? "Monitor";
  const actionNote = item.memo?.recommended_action_note ?? null;
  const closeDays = daysUntil(item.commentCloseDate);

  return (
    <div
      className="mapcards"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <button
        className="cycle mc-toggle"
        onClick={onTogglePause}
        aria-pressed={!paused}
        title={paused ? "Resume auto-cycling" : "Pause auto-cycling"}
      >
        {paused ? <Play size={11} /> : <Pause size={11} />}
        {paused ? "Paused" : "Auto-cycling"}
        <span className="mono mc-counter">{counter}</span>
      </button>

      {/* THREAT - the headline: what just moved */}
      <div className="fcard fc fc-threat" key={"t" + item.id}>
        <div className="head">
          <span className="pill" style={sevStyle(b.key)}>Threat</span>
          <span className="mono fc-id">{item.identifier}</span>
          {item.isNew && <span className="chip new">NEW</span>}
        </div>
        <h5>{item.title}</h5>
        <div className="box">
          <div className="boxlbl">The move</div>
          {move.length > 120 ? move.slice(0, 120).trimEnd() + "…" : move}
        </div>
        {item.provenance && (
          <div className="org"><b>Origin:</b> {item.provenance}</div>
        )}
        {cycleMs > 0 && !paused && (
          <div className="prog" key={cycleKey}>
            <i style={{ ["--dur" as string]: `${cycleMs}ms` }} />
          </div>
        )}
      </div>

      {/* STATUS - factual next events only */}
      <div className="fcard fc fc-status" key={"s" + item.id}>
        <div className="head">
          <span className="pill">Status</span>
          <span className="when">{STAGE_LABEL[item.stage] ?? item.stage}</span>
        </div>
        <div className="fc-rows">
          <div className="fc-row">
            <span className="boxlbl">Where it is</span>
            <span>{item.status || "In progress"}</span>
          </div>
          {item.commentCloseDate && (
            <div className="fc-row">
              <span className="boxlbl">Comment window</span>
              <span className={closeDays !== null && closeDays >= 0 && closeDays <= 30 ? "fc-urgent" : ""}>
                closes {item.commentCloseDate}
                {closeDays !== null && closeDays >= 0 ? ` · ${closeDays}d left` : ""}
              </span>
            </div>
          )}
          {item.lastActionDate && (
            <div className="fc-row">
              <span className="boxlbl">Last action</span>
              <span>{item.lastActionDate}</span>
            </div>
          )}
          <div className="fc-src">{displaySource(item)}</div>
        </div>
      </div>

      {/* IMPACT - why this matters to YOU (qualitative; labeled estimate only) */}
      <div className="fcard fc fc-impact" key={"i" + item.id}>
        <div className="head">
          <span className="pill">Impact</span>
          <span className="mono fc-id">{item.score}/5 · {b.label}</span>
        </div>
        <div className="box">
          <div className="boxlbl">Why this hits you</div>
          {why.length > 140 ? why.slice(0, 140).trimEnd() + "…" : why}
        </div>
        {affected && <div className="org">{affected}</div>}
        {estimate && <div className="org"><b>Estimated impact:</b> {estimate}</div>}
      </div>

      {/* ACTION - recommended action + the official portal */}
      <div className="fcard fc fc-action" key={"a" + item.id}>
        <div className="head">
          <span className="pill">Action</span>
        </div>
        <div className="actrow" style={{ marginTop: 2 }}>
          {item.actionUrl ? (
            <a className="actbtn" href={item.actionUrl} target="_blank" rel="noreferrer">
              {action} <ArrowUpRight size={13} />
            </a>
          ) : (
            <span className="actbtn">{action}</span>
          )}
        </div>
        <div className="org">
          {actionNote ??
            (item.actionUrl
              ? "Official public portal - read the full text or comment."
              : "Watch this one; no public action window right now.")}
        </div>
      </div>
    </div>
  );
}
