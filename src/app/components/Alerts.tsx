/**
 * Alerts — the review queue (the approval gate made visible) + digest settings.
 * Spec §2 (Alerts tab) and §8 (approval gate): drafted memos sit as Draft until a
 * human approves; NOTHING leaves RedLine without that approval. Approve/Reject are
 * optimistic LOCAL state only — this is seeded demo data with no DB or outbound.
 */
"use client";

import { useMemo, useState } from "react";
import type { BoardData, SurfacedCard } from "@/app/lib/board";
import { Mono, SeverityStamp, SectionLabel } from "@/app/components/ui";
import styles from "./Alerts.module.css";

type Decision = "draft" | "approved" | "rejected";
type DigestCadence = "daily" | "weekly";

/** The one-line preview pulled from a drafted memo. */
function memoPreview(card: SurfacedCard): string {
  const m = card.memo;
  if (!m) return card.justification;
  return m.what_it_does || m.who_is_affected || card.justification;
}

const ACTION_LABEL: Record<string, string> = {
  comment: "File a comment",
  monitor: "Monitor",
  call_counsel: "Call counsel",
  no_action: "No action",
};

export function Alerts({ board }: { board: BoardData }) {
  // Items that crossed the memo threshold have a drafted memo to review.
  const drafts = useMemo(
    () => board.surfaced.filter((c) => c.memo != null),
    [board.surfaced],
  );

  // Decisions are keyed by card id and reset when the active board changes.
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const decisionFor = (id: string): Decision => decisions[id] ?? "draft";

  // Digest settings — cosmetic local state; honest copy about delivery.
  const [cadence, setCadence] = useState<DigestCadence>("daily");
  const [deadlineAlerts, setDeadlineAlerts] = useState(true);

  const pending = drafts.filter((c) => decisionFor(c.id) === "draft");
  const approved = drafts.filter((c) => decisionFor(c.id) === "approved");
  const rejected = drafts.filter((c) => decisionFor(c.id) === "rejected");

  const set = (id: string, d: Decision) =>
    setDecisions((prev) => ({ ...prev, [id]: d }));

  return (
    <div className={styles.layout}>
      {/* ── Review queue ──────────────────────────────────────────────── */}
      <div>
        <div className={styles.head}>
          <h2 className={styles.headTitle}>Review queue</h2>
        </div>
        <p className={styles.gateNote}>
          Every memo lands here as a <strong>draft</strong>. RedLine drafts and cites
          the analysis, but <strong>nothing is delivered until you approve it</strong> —
          there is no auto-send. Approve to release it into the next digest, or reject
          to keep it out.
        </p>

        {/* Pending drafts */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <SectionLabel>Awaiting your review</SectionLabel>
            <span className={styles.count}>{pending.length}</span>
          </div>

          {pending.length === 0 ? (
            drafts.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>No drafts to review yet</p>
                <p className={styles.emptyBody}>
                  When a tracked rule scores high enough to matter for this business,
                  RedLine drafts a cited memo and parks it here for your sign-off.
                </p>
              </div>
            ) : (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>Queue clear</p>
                <p className={styles.emptyBody}>
                  You have acted on every drafted memo for this business. Approved memos
                  are queued for the next digest; nothing was sent automatically.
                </p>
              </div>
            )
          ) : (
            pending.map((card) => (
              <DraftRow
                key={card.id}
                card={card}
                onApprove={() => set(card.id, "approved")}
                onReject={() => set(card.id, "rejected")}
              />
            ))
          )}
        </div>

        {/* Approved */}
        {approved.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <SectionLabel>Approved — queued for the next digest</SectionLabel>
              <span className={styles.count}>{approved.length}</span>
            </div>
            {approved.map((card) => (
              <ResolvedRow
                key={card.id}
                card={card}
                kind="approved"
                onUndo={() => set(card.id, "draft")}
              />
            ))}
          </div>
        )}

        {/* Rejected */}
        {rejected.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <SectionLabel>Rejected — held back</SectionLabel>
              <span className={styles.count}>{rejected.length}</span>
            </div>
            {rejected.map((card) => (
              <ResolvedRow
                key={card.id}
                card={card}
                kind="rejected"
                onUndo={() => set(card.id, "draft")}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Digest settings rail ──────────────────────────────────────── */}
      <aside className={styles.rail}>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            padding: 16,
          }}
        >
          <h3 className={styles.railTitle}>Digest delivery</h3>
          <p className={styles.railSub}>
            How RedLine packages the items you have approved. Configured here, but it
            only ever sends memos you signed off on above.
          </p>

          <div className={styles.field}>
            <div className={styles.fieldLabel}>Cadence</div>
            <div className={styles.radioGroup}>
              <CadenceOption
                checked={cadence === "daily"}
                onSelect={() => setCadence("daily")}
                title="Daily brief"
                hint="One roundup each weekday morning"
              />
              <CadenceOption
                checked={cadence === "weekly"}
                onSelect={() => setCadence("weekly")}
                title="Weekly digest"
                hint="A single summary every Monday"
              />
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.fieldLabel}>Comment deadlines</div>
            <div className={styles.toggleRow}>
              <div className={styles.toggleText}>
                Deadline alerts
                <em>Nudge before a comment window closes on an approved item</em>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={deadlineAlerts}
                aria-label="Comment-deadline alerts"
                className={`${styles.switch} ${deadlineAlerts ? styles.switchOn : ""}`}
                onClick={() => setDeadlineAlerts((v) => !v)}
              >
                <span className={styles.knob} />
              </button>
            </div>
          </div>

          <p className={styles.deliveryNote}>
            Delivery to {board.label} is configured, not live in this preview. RedLine
            never sends a memo you have not approved.
          </p>
        </div>
      </aside>
    </div>
  );
}

function DraftRow({
  card,
  onApprove,
  onReject,
}: {
  card: SurfacedCard;
  onApprove: () => void;
  onReject: () => void;
}) {
  const action = card.memo?.recommended_action ?? null;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: 14,
        marginBottom: 12,
        transition: "box-shadow var(--motion)",
      }}
    >
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <div className={styles.rowTopline}>
            <Mono>
              <span className={styles.rowIdent}>{card.identifier}</span>
            </Mono>
            {card.agency && <span className={styles.rowAgency}>{card.agency}</span>}
            <SeverityStamp score={card.score} severity={card.severity} />
          </div>
          <p className={styles.rowTitle}>{card.title}</p>
          <p className={styles.preview}>
            <b>What it does — </b>
            {memoPreview(card)}
          </p>
          <div className={styles.metaLine}>
            {action && (
              <span>
                <span className={styles.mk}>Recommended</span>{" "}
                {ACTION_LABEL[action] ?? action}
              </span>
            )}
            {card.memo?.confidence && (
              <span>
                <span className={styles.mk}>Confidence</span> {card.memo.confidence}
              </span>
            )}
            {card.commentCloseDate && (
              <span>
                <span className={styles.mk}>Comment closes</span> {card.commentCloseDate}
              </span>
            )}
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnApprove}`}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnReject}`}
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function ResolvedRow({
  card,
  kind,
  onUndo,
}: {
  card: SurfacedCard;
  kind: "approved" | "rejected";
  onUndo: () => void;
}) {
  return (
    <div className={styles.resolvedRow}>
      <div className={styles.resolvedMain}>
        <span
          className={`${styles.statusTag} ${
            kind === "approved" ? styles.statusApproved : styles.statusRejected
          }`}
        >
          {kind === "approved" ? "Approved" : "Rejected"}
        </span>
        <Mono>
          <span className={styles.rowIdent}>{card.identifier}</span>
        </Mono>
        <span className={styles.resolvedTitle}>{card.title}</span>
      </div>
      <button type="button" className={styles.btnUndo} onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

function CadenceOption({
  checked,
  onSelect,
  title,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label className={`${styles.radio} ${checked ? styles.radioOn : ""}`}>
      <input
        type="radio"
        name="digest-cadence"
        checked={checked}
        onChange={onSelect}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      <span className={styles.radioDot} aria-hidden>
        <span />
      </span>
      <span className={styles.radioText}>
        <b>{title}</b>
        <em>{hint}</em>
      </span>
    </label>
  );
}
