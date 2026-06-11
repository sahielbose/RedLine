"use client";

/**
 * Auto-cycling floating annotation cards over the map (THREAT / STATUS /
 * IMPACT+ACTION), ported from the reference prototype but fed by REAL board
 * data: the memo's what_it_does / who_is_affected come from the engine, the
 * action links to an official portal only, and nothing here is a prediction.
 */
import { ArrowRight } from "lucide-react";
import type { SurfacedCard } from "@/app/lib/board";
import { ACTION_LABEL, STAGE_LABEL, band, displaySource, sevStyle } from "@/app/lib/ui";

export interface FloatCardsProps {
  item: SurfacedCard | null;
  /** Changes per cycle step so the cards re-animate. */
  cycleKey: string;
  dur: number;
  paused: boolean;
}

export function FloatCards({ item, cycleKey, dur, paused }: FloatCardsProps) {
  if (!item) return null;
  const b = band(item.score);
  const move = item.memo?.what_it_does ?? item.summary;
  const impact = item.memo?.who_is_affected ?? item.justification;
  const action = ACTION_LABEL[item.memo?.recommended_action ?? "monitor"] ?? "Monitor";
  const actionNote = item.memo?.recommended_action_note ?? null;

  return (
    <>
      <div className="fcard" key={"a" + cycleKey} style={{ top: 14, left: 14 }}>
        <div className="head">
          <span className="pill" style={sevStyle(b.key)}>{b.label}</span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{item.identifier}</span>
          <span className="when">{item.isNew ? "new today" : "updated"}</span>
        </div>
        <h5>{item.title}</h5>
        <div className="box">
          <div className="boxlbl">The move</div>
          {move}
        </div>
        <div className="org"><b>Status:</b> {item.status}</div>
        {item.provenance && <div className="org"><b>Origin:</b> {item.provenance}</div>}
        {!paused && <div className="prog"><i style={{ "--dur": dur + "ms" } as React.CSSProperties} /></div>}
      </div>

      <div className="fcard" key={"b" + cycleKey} style={{ right: 14, top: 120, maxWidth: 250, animationDelay: ".08s" }}>
        <div className="head"><span className="pill">Status</span></div>
        <div className="box" style={{ background: "var(--surface)" }}>
          <div className="boxlbl">Where it is</div>
          <b style={{ color: "var(--ink)" }}>{STAGE_LABEL[item.stage] ?? item.stage}</b> ·{" "}
          {item.postal ? item.postal.toUpperCase() : "Federal"}
          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 11.5 }}>{displaySource(item)}</div>
          {item.commentCloseDate && (
            <div style={{ marginTop: 6, color: "var(--ink-soft)", fontSize: 11.5 }}>
              Comments close {item.commentCloseDate}
            </div>
          )}
        </div>
      </div>

      <div className="fcard" key={"c" + cycleKey} style={{ left: 30, bottom: 16, maxWidth: 320, animationDelay: ".14s" }}>
        <div className="head"><span className="pill">Impact</span><span className="pill">Action</span></div>
        <div className="box">{impact}</div>
        <div className="actrow">
          {item.actionUrl ? (
            <a className="actbtn" href={item.actionUrl} target="_blank" rel="noreferrer">
              {action} <ArrowRight size={13} />
            </a>
          ) : (
            <span className="actbtn">{action} <ArrowRight size={13} /></span>
          )}
          {actionNote && <span className="actnote">{actionNote}</span>}
        </div>
      </div>
    </>
  );
}
