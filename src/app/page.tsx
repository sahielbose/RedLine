/**
 * Home — the dashboard entry (spec §2, §12). Server component: it runs the REAL
 * relevance engine over the seeded demo data for every profile on the server
 * (computeDashboard), then hands the precomputed, serializable boards to the
 * client Dashboard. Switching "Viewing as {business}" there just swaps a board —
 * the signature recolor, no recompute, no keys/DB.
 */
import { computeDashboard } from "@/app/lib/board";
import { Dashboard } from "@/app/components/Dashboard";

export default async function Page() {
  const data = await computeDashboard();
  return <Dashboard data={data} />;
}
