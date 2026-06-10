# Pipeline — the core engine

> Expands [`REDLINE_MASTER_SPEC.md` §7](./REDLINE_MASTER_SPEC.md#7-the-pipeline-the-core-engine).
> Codes against `src/lib/types.ts` (`NormalizedItem`, `Judgment`, `JudgeResultSchema`, `MemoContent`, `Citation`) and `src/lib/interfaces.ts` (`SourceClient`, `Embedder`, `LLM`, `Mailer`).
> The prompts live in [PROMPTS](./PROMPTS.md); thresholds come from `src/lib/env.ts`.
> Siblings: [TAXONOMY](./TAXONOMY.md) · [DATA_MODEL](./DATA_MODEL.md) · [EVALS](./EVALS.md).

## The funnel, end to end

```
ingest → classify (Stage 0 tag) → embed
  per active profile:
    Stage 0  category intersection      (cheap, recall-first)
    Stage A  pgvector prefilter         (top PREFILTER_LIMIT, default 50)
    Stage B  LLM rubric judge 0–5        (expensive; only category∩, embedding-near items)
    score ≥ MEMO_THRESHOLD (default 4) → Memo + citation verify → status='draft'
```

Each stage is cheaper than the next and narrows the candidate set, so the LLM only ever judges items that already passed category + embedding gates. **Every stage logs its decision** to `relevance_judgments` (including filters-out) — that log is the trust substrate, not an afterthought.

---

## Ingest (before the funnel)

For each `SourceClient` (`src/sources/`):
1. `fetchSince(cursor)` → `NormalizedItem[]` + next cursor.
2. Upsert on `UNIQUE(source, external_id)`; compute/compare `content_hash`.
3. On change, append a row to `item_status_history` (the no-missed-amendment backbone).
4. Persist the cursor to `sync_state`.
5. Classify (Stage 0 tagging) and embed.

Full text is **not** fetched here — only lazily at memo time via `fetchFullText`.

---

## Stage 0 — category tagging + intersection (`src/pipeline/classify.ts`)

**Tagging.** At ingest, tag each item with taxonomy categories (`Category` in `src/lib/types.ts`) using **cheap agency/keyword rules first**, upgrading to a small LLM classifier later. Examples:

- FDA + "food" → `food`
- CBP / "de minimis" / "tariff" → `goods`, `hardware`
- DOL / "overtime" → `wages_hours`

Full tagging rules are in [TAXONOMY](./TAXONOMY.md). **Tag generously — recall first.** A missed tag here silently drops the item from a business's funnel forever, so over-tagging (caught later by the judge) is the safe error.

**Intersection.** Keep only items whose `items.categories[]` intersect the profile's `subscribed_categories[]`. This is why a food rule never reaches a SaaS company's judge — it is the first and cheapest precision gate.

> ⚠️ **Silent-recall risk.** Because Stage 0 can drop an item before any human or LLM sees it, tagging is audited against the eval set ([EVALS](./EVALS.md)). A tagging change is an eval-gated change.

---

## Stage A — pgvector prefilter (`src/pipeline/prefilter.ts`)

```sql
SELECT i.id, 1 - (i.embedding <=> $1) AS similarity
FROM items i
WHERE i.jurisdiction = ANY($2) AND i.categories && $3 AND i.last_synced_at > $4
ORDER BY i.embedding <=> $1
LIMIT 50;  -- PREFILTER_LIMIT
```

- `$1` = the profile embedding (`org_profiles.embedding`, produced by `Embedder.embed`).
- `$2` = profile `jurisdictions`; `$3` = `subscribed_categories` (the GIN-indexed overlap reused from Stage 0); `$4` = a recency watermark.
- `LIMIT` = `PREFILTER_LIMIT` (`src/lib/env.ts`, default 50).
- Each survivor is logged with `stage='prefilter'` and its `similarity`.

The HNSW index on `items.embedding` makes this fast. Stage A is a *recall-preserving narrowing* — it picks the most semantically similar candidates for the judge, it does not make the relevance call.

---

## Stage B — LLM rubric judge (`src/pipeline/judge.ts`)

Calls `LLM.json({ system, user, schema: JudgeResultSchema })`. The system prompt is the rubric (verbatim in [PROMPTS](./PROMPTS.md)); the user message is the profile + item. Output is **validated by Zod** against `JudgeResultSchema`:

```ts
{ score: 0..5 (int), justification: string (≥1), matched_concern: string | null }
```

The 0–5 rubric (full text in PROMPTS):

| Score | Meaning |
|---|---|
| 5 | Direct material impact — new obligations/costs/restrictions on core ops, act now. |
| 4 | Clearly relevant — regulates this org's activities; likely a change or position. |
| 3 | Sector-adjacent — touches the broader sector; monitor. |
| 2 | Weak/indirect — affects the industry via suppliers/customers, not the org. |
| 1 | Background noise — shares keywords, different context. |
| 0 | Irrelevant. |

**Log every judgment** to `relevance_judgments` with `model`, `prompt_version`, `rubric_version` (the constants `RUBRIC_VERSION`/`PROMPT_VERSION` = `v1` in `src/lib/types.ts`). The `Judgment` type carries exactly these fields. Bump the version constants on any prompt/rubric change so older judgments stay attributable, then re-run evals.

**No-fabrication at the judge:** the prompt instructs the model to judge only on what the item says, never to invent section numbers, and to score low if too vague. The score is advisory for triage; nothing it says is presented to a user as a verified fact without passing memo citation verification.

---

## Memo generator (`src/pipeline/memo.ts`)

Runs when **score ≥ `MEMO_THRESHOLD`** (default 4 → "High"/"Critical" per `severityLabel` in `types.ts`).

1. **Ensure full text** — lazily via `SourceClient.fetchFullText`; persist to `items.full_text`.
2. **Chunk + retrieve** — split the source text, embed chunks, retrieve the sections most similar to the profile's `concern_text` so the memo is grounded in the relevant passages.
3. **Generate** a structured `MemoContent` (the memo prompt in PROMPTS): `what_it_does`, `status_and_next_steps`, `who_is_affected`, `recommended_action` (`comment`/`monitor`/`call_counsel`/`no_action`), `recommended_action_note`, `impact_estimate`, `citations[]`, `confidence`.
4. **Verify every citation in code** — `verified` is set by a **whitespace-normalized substring check** against the source text: the model's claimed `snippet` must literally appear in the source after collapsing whitespace. **The substring check, not the model, decides.** A citation that fails is dropped/flagged.
5. **No-fabrication enforcement** — `impact_estimate` is a labeled estimate with stated assumptions, or empty (`null`). A bare numeric dollar/probability/vote claim is rejected in code, not just discouraged in the prompt. No predicted vote counts, no named-contact info.
6. **Save `status='draft'`** — the approval gate ([TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#approval-gate)). Nothing is delivered until a human approves.

`recommended_action` links only to **official public portals** (e.g. the Regulations.gov comment page), never a person's contact info.

---

## Thresholds & knobs (`src/lib/env.ts`)

| Env | Default | Used by |
|---|---|---|
| `MEMO_THRESHOLD` | `4` | Stage B → memo gate. |
| `PREFILTER_LIMIT` | `50` | Stage A candidate cap. |
| `EMBED_DIM` | `384` | Embedder + vector columns (must match the embedder). |
| `LLM_PROVIDER` | `local` | Judge + memo backend (`local`/`anthropic`/`ollama`). |
| `EMBEDDER` | `hash` | Embedding backend (`hash`/`local`/`ollama`/`api`). |

The `local` judge + `hash` embedder defaults make the whole funnel **hermetic** — `npm run eval` runs green with zero secrets, which is exactly what gates every prompt change.

## Acceptance test (spec §14)

Switching the active profile must re-score the board correctly: the **import de minimis** item (eval anchor C) flags **Critical** for `ecom-goods` and `hardware-maker`, and is **filtered out** for `saas-remote` and `food-cpg`. That single behavior exercises Stage 0 (category gate), Stage A (similarity), and Stage B (the rubric).
