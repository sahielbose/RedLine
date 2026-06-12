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
import { computeBoardForProfile, profileSummaryOf, type BoardProfile } from "@/app/lib/board";
import { computeBoardForProfileLive, persistNewProfile } from "@/app/lib/live-board";
import { AddBusinessSchema, formMeta, toOnboardingAnswers } from "@/app/lib/onboardingMap";

export const dynamic = "force-dynamic";

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

  const answers = toOnboardingAnswers(form);
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const profile = await buildProfile(answers, {
    id,
    org_id: `org-${id}`,
    embedder: getEmbedder(),
  });

  // Persist the profile so it becomes a real, durable org_profiles row the
  // agentic search can scope to (loadProfile(profileId)). When the DB is
  // reachable we adopt the REAL org_profiles.id; when it is unreachable we keep
  // the synthetic id and the hermetic in-memory behaviour (no persistence).
  let persisted = false;
  try {
    const ids = await persistNewProfile(profile, form.name);
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
