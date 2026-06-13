/**
 * POST /api/feedback - 👍/👎 relevance feedback (spec §8 feedback loop).
 *
 * Records a human relevance label into relevance_feedback, the table that feeds
 * new eval labels. Body: { profileId, itemId, label: 'relevant'|'not_relevant', on }.
 * Best-effort: resolves the org from the profile and writes only when both live
 * in Postgres (real profile + real item); a no-op for demo/custom profiles or a
 * missing DB, so the optimistic UI never breaks.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  profileId: z.string().min(1),
  itemId: z.string().uuid(),
  label: z.enum(["relevant", "not_relevant"]),
  on: z.boolean().default(true),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  const { profileId, itemId, label, on } = parsed.data;

  try {
    const pool = getPool();
    const org = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM org_profiles WHERE id = $1 LIMIT 1`,
      [profileId],
    );
    const orgId = org.rows[0]?.org_id;
    if (!orgId) return NextResponse.json({ ok: true, persisted: false });

    if (!on) {
      await pool.query(`DELETE FROM relevance_feedback WHERE org_id = $1 AND item_id = $2`, [orgId, itemId]);
      return NextResponse.json({ ok: true, persisted: true });
    }

    // Attach the most recent judgment for this item+org so the label is traceable.
    const jr = await pool.query<{ id: string }>(
      `SELECT id FROM relevance_judgments WHERE org_id = $1 AND item_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [orgId, itemId],
    );
    // One active label per (org,item): replace any prior one.
    await pool.query(`DELETE FROM relevance_feedback WHERE org_id = $1 AND item_id = $2`, [orgId, itemId]);
    await pool.query(
      `INSERT INTO relevance_feedback (org_id, item_id, judgment_id, label) VALUES ($1, $2, $3, $4)`,
      [orgId, itemId, jr.rows[0]?.id ?? null, label],
    );
    return NextResponse.json({ ok: true, persisted: true });
  } catch {
    return NextResponse.json({ ok: true, persisted: false });
  }
}
