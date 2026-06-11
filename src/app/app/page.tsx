/**
 * /app - the dashboard (Overview map · Bills · Alerts · Tracker). Server
 * component. Prefers the LIVE board read over real ingested data (real bills +
 * rules from Congress.gov, the Federal Register, and Open States, with the
 * judgments + cited memos the pipeline logged). Falls back to the hermetic
 * seeded board only when the DB is empty or unreachable - so the page always
 * renders, with keys or without. Switching "Viewing as {business}" in the
 * client AppView just swaps a precomputed, serializable board.
 */
import { computeDashboard, type DashboardData } from "@/app/lib/board";
import { computeLiveDashboard } from "@/app/lib/live-board";
import { AppView } from "@/app/components/AppView";

// Always read fresh from the DB (real data changes as ingestion runs).
export const dynamic = "force-dynamic";

async function loadDashboard(): Promise<DashboardData> {
  try {
    const live = await computeLiveDashboard();
    if (live) return live;
  } catch (err) {
    console.error("[app] live board unavailable, using seeded fallback:", err);
  }
  return computeDashboard();
}

export default async function Page() {
  const data = await loadDashboard();
  return <AppView data={data} />;
}
