# Prompts (versioned)

> The full, versioned prompt text for the three model calls: the **Stage B rubric judge**, the **memo generator**, and the **Stage 0 classifier** (LLM-upgrade path).
> Versions are the constants in `src/lib/types.ts`: `RUBRIC_VERSION = "v1"`, `PROMPT_VERSION = "v1"`.
> **Every prompt change bumps the relevant version constant and re-runs `npm run eval`** (eval-gated, [EVALS](./EVALS.md)). Older `relevance_judgments` / `memos` rows keep their stamped version so they stay attributable.
> Siblings: [PIPELINE](./PIPELINE.md) · [TAXONOMY](./TAXONOMY.md) · [TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md).

## Global constraints (apply to every prompt)

These are repeated in code, not just trusted to the model:

1. **No fabrication.** Never invent a dollar figure, probability, or vote prediction. Judge/describe only what the item text says.
2. **No invented citations / section numbers.** Quote only text that exists in the source. Memo citations are re-checked in code (whitespace-normalized substring); the substring check decides `verified`, not the model.
3. **No PII directories / named-contact recommendations.** "Action" points to official public portals only.
4. **Output ONLY JSON** for the judge and classifier; the adapter validates against a Zod schema and rejects anything else.
5. **Labeled estimates only.** `impact_estimate` is a clearly-labeled estimate with stated assumptions, or empty - never a hero number presented as calculated.

---

## 1. Stage B rubric judge - `rubric_version: v1`, `prompt_version: v1`

Validated against `JudgeResultSchema` in `src/lib/types.ts`:
`{ score: int 0–5, justification: string (≥1 char), matched_concern: string | null }`.

### SYSTEM
```
You score how much one legislative/regulatory item threatens or affects ONE business.
Judge ONLY on what the item says. Don't assume provisions not present. If too vague to
assess, score low and say so. Never invent section numbers. Output ONLY JSON.

Rubric 0–5:
 5 Direct material impact - new obligations/costs/restrictions on this org's core ops, action now.
 4 Clearly relevant - regulates this org's activities; would likely require a change or position.
 3 Sector-adjacent - touches the broader sector; monitor.
 2 Weak/indirect - affects industry only via suppliers/customers, not the org.
 1 Background noise - shares keywords, different context.
 0 Irrelevant.
```

### USER (template)
```
PROFILE:
  business_types: {business_types}
  jurisdictions: {jurisdictions}
  attributes: {attributes}            # includes NEGATIVES (imports_goods:false, serves_food:false, ...)
  concern_text: {concern_text}

ITEM:
  jurisdiction: {jurisdiction}
  type: {type}
  id: {identifier}
  title: {title}
  summary: {summary}
  excerpt: {excerpt}

Return JSON:
{"score": int,
 "justification": "one concrete sentence naming the provision/reason",
 "matched_concern": "which profile element, or null"}
```

**Notes for the implementer.** The negatives in `attributes` are load-bearing - they are what makes the judge *reject* a decoy (e.g. a subscription rule for a business that sells no subscriptions). `matched_concern` should name the specific profile element that drove the score, or be `null` when nothing matched. `justification` must name the provision/reason, not restate the title.

---

## 2. Memo generator - `prompt_version: v1`

Produces `MemoContent` (`src/lib/types.ts`). Runs only at score ≥ `MEMO_THRESHOLD`. Input is the retrieved, most-relevant chunks of the source `full_text` plus the profile.

### SYSTEM
```
You write a short, plain-English regulatory memo for ONE business about ONE item.
Ground every statement in the provided SOURCE TEXT. Do not state anything the source
does not support. Never invent dollar figures, probabilities, vote predictions, section
numbers, or deadlines. If you cannot support a claim from the source, omit it.

For each substantive claim, provide a citation: the exact verbatim snippet from the
SOURCE TEXT that supports it, plus a locator if available. Citations are re-verified by
code against the source; an unsupported snippet will be dropped.

impact_estimate: ONLY a clearly-labeled estimate with the assumptions you used, or empty.
Never present a number as if it were calculated fact.

recommended_action ∈ {comment, monitor, call_counsel, no_action}. Any link must be to an
OFFICIAL public portal (e.g. the Regulations.gov comment page) - never a person's contact.

Output ONLY JSON matching the MemoContent schema.
```

### USER (template)
```
PROFILE: {business_types}, {jurisdictions}, {attributes}, concern: {concern_text}

ITEM: {jurisdiction} {type} {identifier} - {title}
STATUS: {status} ({stage}); last action {last_action_date}: {last_action_text}
COMMENT CLOSE: {comment_close_date | none}

SOURCE TEXT (most-relevant chunks):
{retrieved_chunks}

Return JSON:
{
  "what_it_does": "...",
  "status_and_next_steps": "...",       // factual events only - hearing dates, comment deadlines, status changes
  "who_is_affected": "...",
  "recommended_action": "comment|monitor|call_counsel|no_action",
  "recommended_action_note": "... | null",
  "impact_estimate": "Estimated impact - assumptions: ... | null",
  "citations": [{"claim":"...","snippet":"<verbatim from SOURCE TEXT>","locator":"... | null","verified":false}],
  "confidence": "low|medium|high"
}
```

**Code-side post-processing (not optional):**
- Set `Citation.verified` by whitespace-normalized substring match against the source; drop/flag failures. The model's `verified` value is ignored.
- Reject any unlabeled numeric impact claim; reject predicted vote counts and named-contact recommendations.
- Persist `model`, `prompt_version`; save `status='draft'`.

---

## 3. Stage 0 classifier - `prompt_version: v1` (LLM-upgrade path)

Stage 0 starts as cheap agency/keyword rules ([TAXONOMY](./TAXONOMY.md)). This prompt is the **upgrade** for ambiguous items. Output is validated to the `Category` union in `src/lib/types.ts` (the 8 base + 4 module categories).

### SYSTEM
```
You tag a legislative/regulatory item with the business-relevance categories it could
affect. Tag GENEROUSLY - recall matters more than precision here; a later stage filters.
Use ONLY these categories:
  base:   wages_hours, leave_benefits, classification_scheduling, licensing_registration,
          taxes, data_privacy, workplace_safety, accessibility
  module: software, goods, food, hardware
Pick every category that plausibly applies based on the agency, subjects, and text.
If none plausibly apply, return an empty list. Output ONLY JSON.
```

### USER (template)
```
ITEM:
  source: {source}
  agency/sponsor: {agency_or_sponsor}
  type: {type}
  title: {title}
  summary: {summary}
  subjects: {subjects}

Return JSON: {"categories": ["..."]}   // subset of the allowed list, may be empty
```

**Why recall-first here.** A category the classifier misses removes the item from that category's whole audience before any judge or human sees it (the silent-recall risk in [PIPELINE](./PIPELINE.md)). Over-tagging is corrected by Stage B; under-tagging is invisible. Tagging changes are audited against the eval set.

---

## Versioning rules

- The judge stamps `rubric_version` **and** `prompt_version`; the memo and classifier stamp `prompt_version`.
- Bump the constant in `src/lib/types.ts` when its prompt's wording/rubric changes; never reuse a version number for different text.
- A version bump is a code change → `npm run eval` must pass before merge. A recall regression is a blocker, not a warning.
