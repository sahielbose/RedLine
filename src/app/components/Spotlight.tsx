"use client";

/**
 * Spotlight: ONE calm, stationary detail panel for the item highlighted in the
 * Overview rail (replaces the old three auto-cycling floating cards). No
 * absolute positioning, no perpetual animation - it just shows the selected
 * item. Every field is real engine output: what_it_does / who_is_affected come
 * from the cited memo, the action links only to an official portal, and nothing
 * here is a prediction.
 */
import { ArrowRight } from "lucide-react";
import type { SurfacedCard } from "@/app/lib/board";
import { ACTION_LABEL, STAGE_LABEL, band, displaySource, sevStyle } from "@/app/lib/ui";

export function Spotlight({ item }: { item: SurfacedCard | null }) {
  if (!item) {
    return (
      <div className="spotlight empty-spot">
        Select an item on the left to see what it does, who it affects, and the recommended action.
      </div>
    );
  }
  const b = band(item.score);
  const move = item.memo?.what_it_does ?? item.summary;
  const impact = item.memo?.who_is_affected ?? item.justification;
  const action = ACTION_LABEL[item.memo?.recommended_action ?? "monitor"] ?? "Monitor";
  const actionNote = item.memo?.recommended_action_note ?? null;

  return (
    <div className="spotlight">
      <div className="sp-head">
        <span className="stamp" style={sevStyle(item.score >= 3 ? b.key : "safe")}>
          {b.label} · {item.score}/5
        </span>
        <span className="mono sp-id">{item.identifier}</span>
        {item.isNew && <span className="chip new">NEW</span>}
        <span className="sp-where">
          {STAGE_LABEL[item.stage] ?? (item.stage || "Tracked")} · {item.postal ? item.postal.toUpperCase() : "Federal"}
        </span>
      </div>

      <h4 className="sp-title">{item.title}</h4>

      <div className="sp-box">
        <div className="boxlbl">What it does</div>
        {move}
      </div>

      <div className="sp-grid">
        <div>
          <div className="boxlbl">Who it affects</div>
          <p>{impact}</p>
        </div>
        <div>
          <div className="boxlbl">Status</div>
          <p>
            {item.status || "In progress"}
            {item.commentCloseDate && (
              <>
                <br />
                <span className="sp-deadline">Comments close {item.commentCloseDate}</span>
              </>
            )}
          </p>
          <div className="sp-src">{displaySource(item)}</div>
        </div>
      </div>

      <div className="sp-foot">
        {item.actionUrl ? (
          <a className="actbtn" href={item.actionUrl} target="_blank" rel="noreferrer">
            {action} <ArrowRight size={13} />
          </a>
        ) : (
          <span className="actbtn">{action}</span>
        )}
        {actionNote && <span className="actnote">{actionNote}</span>}
      </div>
    </div>
  );
}
