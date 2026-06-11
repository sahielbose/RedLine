"use client";

/**
 * ProfileSwitcher — THE signature interaction (spec §2 "Viewing as {business}").
 * Changing the active business re-scores and recolors the whole board (the parent
 * just swaps the precomputed board prop). Built as an accessible listbox so it can
 * carry the prominence the spec wants while staying keyboard-operable:
 *   - Enter / Space / ↓ / ↑ open it
 *   - ↑/↓ move the active option, Home/End jump, Enter/Space select, Esc closes
 *   - clicking outside or blurring closes it
 * Quiet relative to the engraving hero, but clearly the focal affordance.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ProfileSummary } from "@/app/lib/board";
import { POSTAL_TO_NAME } from "@/app/lib/geo";
import styles from "./ProfileSwitcher.module.css";

function jurisdictionSummary(jurisdictions: string[]): string {
  const states = jurisdictions
    .filter((j) => j !== "us")
    .map((j) => {
      const postal = j.replace(/^us-/, "");
      return POSTAL_TO_NAME[postal] ?? postal.toUpperCase();
    });
  const hasFederal = jurisdictions.includes("us");
  const parts: string[] = [];
  if (hasFederal) parts.push("Federal");
  if (states.length) parts.push(states.join(", "));
  return parts.join(" · ") || "—";
}

export function ProfileSwitcher({
  profiles,
  activeProfileId,
  onChange,
}: {
  profiles: ProfileSummary[];
  activeProfileId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    profiles.findIndex((p) => p.id === activeProfileId),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;

  const active = profiles[selectedIndex];

  const openMenu = useCallback(() => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [selectedIndex]);

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (index: number) => {
      const next = profiles[index];
      if (next) onChange(next.id);
      closeMenu();
    },
    [profiles, onChange, closeMenu],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(profiles.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(profiles.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        select(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        closeMenu();
        break;
      case "Tab":
        closeMenu(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <span className={styles.eyebrow} id={labelId}>
        Viewing as
      </span>

      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${baseId}-value`}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.viewingAs}>Business</span>
        <span className={styles.label} id={`${baseId}-value`}>
          {active?.label ?? "Select a business"}
        </span>
        <svg
          className={styles.chevron}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          className={styles.listbox}
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          aria-activedescendant={`${baseId}-opt-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          ref={(el) => {
            el?.focus();
          }}
        >
          {profiles.map((p, i) => {
            const isSelected = p.id === activeProfileId;
            const isActive = i === activeIndex;
            return (
              <li
                key={p.id}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                className={`${styles.option} ${isActive ? styles.optionActive : ""} ${
                  isSelected ? styles.optionSelected : ""
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(i)}
              >
                <svg
                  className={`${styles.check} ${isSelected ? "" : styles.checkHidden}`}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M20 6L9 17l-5-5"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  <span className={styles.optionLabel}>{p.label}</span>
                  <span className={styles.optionMeta}>
                    {p.businessTypes.join(" + ")} · {jurisdictionSummary(p.jurisdictions)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
