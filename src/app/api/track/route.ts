/**
 * POST /api/track — track / untrack an item (spec §6 tracked_items).
 *
 * Body: { profileId, itemId, on }. Best-effort durable sync for the dashboard's
 * Track button: resolves the org from the profile and upserts/deletes a
 * tracked_items row when both live in Postgres; a no-op otherwise so the
 * optimistic UI (localStorage) is never blocked.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  profileId: z.string().min(1),
  itemId: z.string().uuid(),
  on: z.boolean().default(true),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  const { profileId, itemId, on } = parsed.data;

  try {
    const pool = getPool();
    const org = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM org_profiles WHERE id = $1 LIMIT 1`,
      [profileId],
    );
    const orgId = org.rows[0]?.org_id;
    if (!orgId) return NextResponse.json({ ok: true, persisted: false });

    if (on) {
      await pool.query(
        `INSERT INTO tracked_items (org_id, item_id) VALUES ($1, $2)
         ON CONFLICT (org_id, item_id) DO NOTHING`,
        [orgId, itemId],
      );
    } else {
      await pool.query(`DELETE FROM tracked_items WHERE org_id = $1 AND item_id = $2`, [orgId, itemId]);
    }
    return NextResponse.json({ ok: true, persisted: true });
  } catch {
    return NextResponse.json({ ok: true, persisted: false });
  }
}
