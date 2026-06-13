/**
 * POST /api/profiles — "Add your business" (the two-minute onboarding, spec §10).
 *
 * Takes the modal form, builds a REAL BusinessProfile through the engine's
 * onboarding (concern_text with positives AND negatives + an embedding), then
 * scores the board for it through the actual Stage 0→A→B pipeline. The board
 * that comes back re-scored is the real engine's verdict, not a UI imitation.
 *
 * No DB required (the demo path is hermetic); profiles live in the client's
 * localStorage. Persisting orgs/profiles to Postgres is the seeded-DB path.
 */
import { NextResponse } from "next/server";
import { buildProfile } from "@/pipeline/onboarding";
import { getEmbedder } from "@/lib/embedder";
import { getPool } from "@/lib/db";
import { computeBoardForProfile, profileSummaryOf, type BoardProfile } from "@/app/lib/board";
import { computeBoardForProfileLive, persistNewProfile, updateProfile } from "@/app/lib/live-board";
import { AddBusinessSchema, formMeta, toOnboardingAnswers } from "@/app/lib/onboardingMap";

export const dynamic = "force-dynamic";

/** DELETE /api/profiles?id=… — soft-delete a custom profile (is_active=false) so
 *  it stops showing up via the live board. Best-effort: a no-op when the profile
 *  was never persisted to Postgres (client-only) or the DB is unreachable. */
export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    await getPool().query(`UPDATE org_profiles SET is_active = false WHERE id = $1`, [id]);
  } catch {
    /* DB absent or profile was client-only — the client already removed it. */
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AddBusinessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid form", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }
  const form = parsed.data;
  // Optional `id` ⇒ EDIT an existing profile in place (round-trip personalization);
  // absent ⇒ create. AddBusinessSchema strips the extra key, so read it raw.
  const editId =
    body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string"
      ? (body as { id: string }).id
      : null;

  const answers = toOnboardingAnswers(form);
  const id = editId ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const profile = await buildProfile(answers, {
    id,
    org_id: `org-${id}`,
    embedder: getEmbedder(),
  });

  // Persist so the profile is a real, durable org_profiles row the agentic search
  // can scope to. Edit → UPDATE the existing row; create → INSERT a new org+profile.
  // When the DB is reachable we adopt the REAL ids; when not, we keep the id we
  // were given / synthesized and stay hermetic (no persistence).
  let persisted = false;
  try {
    const ids = editId ? await updateProfile(editId, profile, form.name) : await persistNewProfile(profile, form.name);
    if (ids) {
      profile.id = ids.profileId;
      profile.org_id = ids.orgId;
      persisted = true;
    }
  } catch (err) {
    console.error("[profiles] persistence unavailable, using synthetic id (no DB):", err);
  }

  const boardProfile: BoardProfile = {
    ...profile,
    label: form.name,
    kind: "Your business",
    meta: formMeta(form),
  };

  // Score the new business against REAL ingested data (Stage 0/A prefilter +
  // heuristic judge over live items). Fall back to the seeded dataset only when
  // the DB is empty or unreachable, so "Add your business" always returns a board.
  let board;
  let live = false;
  try {
    const liveBoard = await computeBoardForProfileLive(boardProfile);
    if (liveBoard) {
      board = liveBoard;
      live = true;
    }
  } catch (err) {
    console.error("[profiles] live scoring unavailable, using seeded fallback:", err);
  }
  if (!board) board = await computeBoardForProfile(boardProfile);

  return NextResponse.json({
    profile: profileSummaryOf(boardProfile),
    concernText: profile.concern_text,
    live,
    persisted,
    board,
  });
}
