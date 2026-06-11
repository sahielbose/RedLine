"use client";

/**
 * Dashboard — the client root. Holds the only two pieces of UI state:
 *   - activeProfileId : which business we're "Viewing as" (the signature switch)
 *   - activeTab       : Overview | Bills | Alerts | Tracker
 * Everything is precomputed server-side (computeDashboard); switching the profile
 * just swaps the already-scored board prop into the active view — instant recolor,
 * no recompute. The recolor itself is the one memorable motion (250ms), keyed on
 * the profile id; everything around it stays quiet.
 */
import { useMemo, useState } from "react";
import type { DashboardData } from "@/app/lib/board";
import { AppShell, type TabId } from "@/app/components/AppShell";
import { ProfileSwitcher } from "@/app/components/ProfileSwitcher";
import { Overview } from "@/app/components/Overview";
import { BillsFeed } from "@/app/components/BillsFeed";
import { Alerts } from "@/app/components/Alerts";
import { Tracker } from "@/app/components/Tracker";
import styles from "./Dashboard.module.css";

export function Dashboard({ data }: { data: DashboardData }) {
  const firstProfileId = data.profiles[0]?.id ?? "";
  const [activeProfileId, setActiveProfileId] = useState(firstProfileId);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Resolve the active (already-scored) board; fall back to the first profile so
  // an unknown id can never blank the board.
  const board = data.boards[activeProfileId] ?? data.boards[firstProfileId];

  const demoCount = useMemo(() => {
    const anyBoard = data.boards[firstProfileId];
    return anyBoard?.totalItems ?? 0;
  }, [data.boards, firstProfileId]);

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      demoCount={demoCount}
      switcher={
        <ProfileSwitcher
          profiles={data.profiles}
          activeProfileId={activeProfileId}
          onChange={setActiveProfileId}
        />
      }
    >
      {board ? (
        // key on the profile id so the recolor animation replays on every switch.
        <div key={activeProfileId} className={styles.board}>
          {activeTab === "overview" && <Overview board={board} />}
          {activeTab === "bills" && <BillsFeed board={board} />}
          {activeTab === "alerts" && <Alerts board={board} />}
          {activeTab === "tracker" && <Tracker board={board} />}
        </div>
      ) : (
        <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>
          No business profiles are loaded yet. Add one and its board lands here.
        </p>
      )}
    </AppShell>
  );
}
