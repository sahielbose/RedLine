/**
 * /app — the dashboard (Overview map · Bills · Alerts · Tracker). Server
 * component: runs the REAL relevance engine over the seeded demo data for
 * every profile (computeDashboard), then hands the precomputed, serializable
 * boards to the client AppView. Switching "Viewing as {business}" there just
 * swaps a board — the signature recolor, no recompute, no keys/DB.
 */
import { computeDashboard } from "@/app/lib/board";
import { AppView } from "@/app/components/AppView";

export default async function Page() {
  const data = await computeDashboard();
  return <AppView data={data} />;
}
