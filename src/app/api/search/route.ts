/**
 * POST /api/search - the agentic search the dashboard runs (spec §2, §8).
 *
 * This is a REAL pipeline over REAL data, streamed so the UI can show the agent
 * working step by step (Server-Sent Events):
 *   1. embed the natural-language query (in-process embedder)
 *   2. retrieve candidates from Postgres - HYBRID: Postgres full-text keyword
 *      rank (real text search) blended with pgvector cosine similarity
 *   3. judge each candidate with the LLM (Claude Haiku when ANTHROPIC_API_KEY is
 *      set - the cheapest model - else the deterministic heuristic judge), scoped
 *      to the active business profile so a search means "relevant to THIS business"
 *   4. stream each judged result as it lands, then a final summary
 *
 * No fabrication: every field returned is a column the pipeline populated from a
 * verifiable government source. Judgments are not persisted here (search is
 * exploratory); the scheduled scorer owns the durable relevance_judgments log.
 */
import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { getEmbedder } from "@/lib/embedder";
import { getLLM } from "@/lib/llm";
import { AnthropicLLM } from "@/lib/adapters/anthropicLLM";
import { judge } from "@/pipeline/judge";
import { env } from "@/lib/env";
import type {
  BusinessProfile,
  BusinessType,
  Category,
  ProfileAttributes,
} from "@/lib/types";
import type { JudgeableItem } from "@/pipeline/relevance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many candidates the retriever hands the judge. Bounded for latency/cost. */
const TOP_K = 8;

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

interface CandidateRow {
  id: string;
  source: string;
  jurisdiction: string;
  type: string;
  identifier: string | null;
  title: string;
  summary: string | null;
  status: string | null;
  stage: string | null;
  last_action_date: Date | null;
  comment_close_date: Date | null;
  full_text: string | null;
  full_text_url: string | null;
  categories: string[];
  raw: unknown;
  similarity: number | null;
  kw: number | null;
}

async function loadProfile(profileId: string): Promise<BusinessProfile | null> {
  const { rows } = await getPool().query(
    `SELECT id, org_id, business_types, jurisdictions, attributes,
            subscribed_categories, concern_text
       FROM org_profiles WHERE id = $1 LIMIT 1`,
    [profileId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    org_id: r.org_id,
    business_types: (r.business_types ?? []) as BusinessType[],
    jurisdictions: (r.jurisdictions ?? []) as string[],
    attributes: (r.attributes ?? {}) as ProfileAttributes,
    subscribed_categories: (r.subscribed_categories ?? []) as Category[],
    concern_text: r.concern_text ?? "",
  };
}

function agencyOf(row: CandidateRow): string | null {
  if (row.source !== "federal_register") return null;
  const r = row.raw as { agencies?: { name?: string | null }[] } | null;
  return r?.agencies?.[0]?.name ?? null;
}

function isoDate(d: Date | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { query?: string; profileId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const query = (body.query ?? "").trim();
  if (!query) return new Response("Empty query", { status: 400 });
  const profileId = body.profileId;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(sse(o)));
        } catch {
          /* client disconnected */
        }
      };

      try {
        // 1. Parse + embed.
        send({ type: "stage", key: "parse", label: "Reading your question", status: "run" });
        const embedder = getEmbedder();
        const [qEmb] = await embedder.embed([query]);
        const profile = profileId ? await loadProfile(profileId) : null;
        send({
          type: "stage",
          key: "parse",
          status: "done",
          detail: profile
            ? `Scoped to ${profile.business_types.join(", ") || "your business"}`
            : "Across every business profile",
        });

        // 2. Retrieve - hybrid keyword (full-text) + semantic (pgvector) over real items.
        send({
          type: "stage",
          key: "retrieve",
          label: "Searching live bills and rules",
          status: "run",
        });
        const vec = `[${qEmb.join(",")}]`;
        const jurs = profile?.jurisdictions?.length ? profile.jurisdictions : null;
        const params: unknown[] = [vec, query];
        let jurClause = "";
        if (jurs) {
          params.push(jurs);
          jurClause = `AND jurisdiction = ANY($${params.length})`;
        }
        const sql = `
          SELECT id, source, jurisdiction, type, identifier, title, summary, status, stage,
                 last_action_date, comment_close_date, full_text, full_text_url, categories, raw,
                 1 - (embedding <=> $1::vector) AS similarity,
                 ts_rank(
                   to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'')),
                   plainto_tsquery('english', $2)
                 ) AS kw
            FROM items
           WHERE embedding IS NOT NULL ${jurClause}
           ORDER BY kw DESC NULLS LAST, embedding <=> $1::vector ASC
           LIMIT ${TOP_K}`;
        const { rows } = await getPool().query<CandidateRow>(sql, params);
        const totalRes = await getPool().query<{ count: string }>(
          `SELECT count(*)::text AS count FROM items`,
        );
        send({
          type: "stage",
          key: "retrieve",
          status: "done",
          detail: `${rows.length} candidates from ${Number(totalRes.rows[0]?.count ?? 0).toLocaleString()} live items`,
        });

        if (rows.length === 0) {
          send({ type: "done", count: 0, relevant: 0 });
          controller.close();
          return;
        }

        // 3. Judge each candidate with the LLM, scoped to the query (as the concern).
        const useClaude = Boolean(env().ANTHROPIC_API_KEY);
        const llm = useClaude ? new AnthropicLLM() : getLLM();
        const judgeProfile: BusinessProfile = {
          id: profile?.id ?? "search",
          org_id: profile?.org_id ?? "search",
          business_types: profile?.business_types ?? [],
          jurisdictions: profile?.jurisdictions ?? ["us"],
          attributes: profile?.attributes ?? ({} as ProfileAttributes),
          subscribed_categories: profile?.subscribed_categories ?? [],
          concern_text: query,
          embedding: qEmb,
        };
        send({
          type: "stage",
          key: "judge",
          label: `Judging ${rows.length} candidates with ${useClaude ? "Claude" : "the local engine"}`,
          status: "run",
        });

        let relevant = 0;
        // Judge concurrently, stream each result as it resolves (agentic + fast).
        await Promise.all(
          rows.map(async (row) => {
            const item: JudgeableItem = {
              title: row.title,
              summary: row.summary,
              source: row.source,
              agency: agencyOf(row),
              categories: row.categories ?? [],
              identifier: row.identifier,
              jurisdiction: row.jurisdiction,
              type: row.type,
              full_text: row.full_text,
            };
            let score = 0;
            let justification = "";
            let matchedConcern: string | null = null;
            try {
              const j = await judge({ profile: judgeProfile, item, llm });
              score = j.score;
              justification = j.justification;
              matchedConcern = j.matched_concern;
            } catch (err) {
              justification = `Could not judge this item (${err instanceof Error ? err.message : "error"}).`;
            }
            if (score >= 3) relevant += 1;
            send({
              type: "result",
              result: {
                id: row.id,
                identifier: row.identifier ?? "",
                title: row.title,
                summary: row.summary ?? "",
                source: row.source,
                agency: agencyOf(row),
                jurisdiction: row.jurisdiction,
                categories: row.categories ?? [],
                similarity: row.similarity == null ? null : Number(row.similarity),
                score,
                justification,
                matchedConcern,
                status: row.status ?? "",
                stage: row.stage ?? "",
                lastActionDate: isoDate(row.last_action_date),
                commentCloseDate: isoDate(row.comment_close_date),
                actionUrl: row.full_text_url,
              },
            });
          }),
        );

        send({ type: "stage", key: "judge", status: "done", detail: `${relevant} relevant` });
        send({ type: "done", count: rows.length, relevant });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Search failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
