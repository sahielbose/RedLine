/**
 * POST /api/memos/approve - move a drafted memo through the approval gate (spec §8).
 *
 * Body: { profileId, itemId, on }. Best-effort durable sync for the dashboard's
 * "Approve memo" toggle: on=true promotes the org's draft memo for that item to
 * 'approved' (so the scheduled digest, which sends APPROVED only, will include
 * it); on=false returns it to 'draft'. Every transition writes an audit_log row.
 * A no-op when the profile/memo isn't in Postgres (demo/custom) - the optimistic
 * UI stays the source of truth for the view. Nothing is ever auto-sent.
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

    const fromStatus = on ? "draft" : "approved";
    const toStatus = on ? "approved" : "draft";
    const upd = await pool.query<{ id: string }>(
      `UPDATE memos
          SET status = $3, approved_at = ${on ? "now()" : "NULL"}
        WHERE org_id = $1 AND item_id = $2 AND status = $4
        RETURNING id`,
      [orgId, itemId, toStatus, fromStatus],
    );
    const memoId = upd.rows[0]?.id;
    if (memoId) {
      await pool.query(
        `INSERT INTO audit_log (org_id, actor, action, entity_type, entity_id, before, after)
         VALUES ($1, 'system', $2, 'memo', $3, $4, $5)`,
        [
          orgId,
          on ? "memo.approved" : "memo.unapproved",
          memoId,
          JSON.stringify({ status: fromStatus }),
          JSON.stringify({ status: toStatus }),
        ],
      );
    }
    return NextResponse.json({ ok: true, persisted: Boolean(memoId) });
  } catch {
    return NextResponse.json({ ok: true, persisted: false });
  }
}
