/**
 * AppShell — the window chrome (spec §12). Presentational: a warm parchment page
 * behind a clean white "app window" with a light title bar (the ●●● dots, the
 * RedLine wordmark, the tab bar, a "last sync" indicator), a sub-bar that holds
 * the persistent ProfileSwitcher slot + an honest "seeded demo" note, and the
 * active tab content as children.
 *
 * Spend the boldness on the chrome; keep the views quiet. Tabs are real buttons
 * with visible focus (globals :focus-visible) + aria-current. Responsive: the
 * tab bar wraps and the top bar stacks on narrow screens.
 */
import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export type TabId = "overview" | "bills" | "alerts" | "tracker";

export interface TabDef {
  id: TabId;
  label: string;
}

export const TABS: readonly TabDef[] = [
  { id: "overview", label: "Overview" },
  { id: "bills", label: "Bills" },
  { id: "alerts", label: "Alerts" },
  { id: "tracker", label: "Tracker" },
] as const;

export function AppShell({
  activeTab,
  onTabChange,
  switcher,
  demoCount,
  children,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  /** The persistent ProfileSwitcher — the signature control. */
  switcher: ReactNode;
  /** Real seeded-item count, surfaced honestly (spec §15) — not "130k+ measured". */
  demoCount: number;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.window}>
        {/* Title bar */}
        <header className={styles.titleBar}>
          <span className={styles.dots} aria-hidden="true">
            <span className={`${styles.dot} ${styles.dotR}`} />
            <span className={`${styles.dot} ${styles.dotY}`} />
            <span className={`${styles.dot} ${styles.dotG}`} />
          </span>

          <span className={styles.wordmark}>
            <span className={styles.tick} aria-hidden="true" />
            <span className={styles.wordmarkText}>RedLine</span>
          </span>

          <nav className={styles.tabs} aria-label="Dashboard sections">
            {TABS.map((t) => {
              const active = t.id === activeTab;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onTabChange(t.id)}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>

          <span className={styles.sync} title="Demo data — sync is illustrative">
            <span className={styles.syncPulse} aria-hidden="true" />
            last sync 2m ago
          </span>
        </header>

        {/* Sub-bar: profile switcher (signature) + honest demo note */}
        <div className={styles.topBar}>
          <div className={styles.topBarSlot}>{switcher}</div>
          <span className={styles.demoNote}>
            <span className={styles.demoDot}>Seeded demo</span>
            {demoCount} sample items, scored live
          </span>
        </div>

        {/* Active view */}
        <main className={styles.content}>{children}</main>
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerTag}>
          Built to watch every bill and rule moving through U.S. government, so a small
          business sees what threatens it before it lands.
        </span>
        <span>Open-source · self-hostable · cited briefs over hero numbers</span>
      </footer>
    </div>
  );
}
