# Design system

> Expands [`REDLINE_MASTER_SPEC.md` §12](./REDLINE_MASTER_SPEC.md#12-design-system).
> The product surface (tabs, the "Viewing as" switch) is spec §2; severity presentation maps to `severityLabel` / `SeverityLabel` in `src/lib/types.ts`.
> Siblings: [ARCHITECTURE](./ARCHITECTURE.md) · [PIPELINE](./PIPELINE.md).

## The direction (and why)

**Warm parchment canvas, an antique-engraving hero, a clean white app card, a US threat-map with auto-cycling floating annotation cards, deep-navy + soft blue-grey + one royal-blue accent. Branded RedLine.** It is grounded in the subject - the machinery of government and official filings. The **antique etching hero** is the signature: an old-world, archival feel that says "this watches the institution," paired with a crisp modern app surface. **Spend the boldness there; keep everything else quiet.** Clone the idea, not anyone's copy - use our own name and figures (spec §1).

## Color tokens (verbatim from spec §12)

```css
:root{
  /* canvas + hero */
  --canvas:#EFE3D8;          /* warm parchment behind the app */
  --hero-sepia:#6B5844;      /* antique etching ink (low-opacity texture over canvas) */
  /* surfaces */
  --surface:#FFFFFF;         /* the app card */
  --chrome:#ECEAE6;          /* window title bar */
  --inset:#F4F1EC;           /* insets / hovers on warm */
  --line:#E7E2DB;            /* hairlines */
  /* ink */
  --ink:#15203B;             /* headings, selected state, hot map state */
  --ink-soft:#3C4660;
  --muted:#8A8F99;
  /* map */
  --map-empty:#DCE3EE;       /* states with no tracked threats */
  --map-mid:#9AA9C2;         /* some tracked */
  --map-hot:#15203B;         /* selected / high-threat state */
  /* accent (the ONE bright color) */
  --accent:#2F6BFF;          /* NEW badge, focus, links */
  /* severity (used on the Bills feed stamps) */
  --critical:#C2183A; --critical-bg:#FBE9EC;
  --high:#B45A0E;     --high-bg:#FBF0E2;
  --monitor:#2B57C9;  --monitor-bg:#E9EEFC;
  --safe:#13705F;     --safe-bg:#E2F0EC;
}
```

### Severity token mapping
`severityLabel(score)` in `src/lib/types.ts` returns `Critical | High | Monitor | Low`. Bind each to its token pair:

| `SeverityLabel` | Score | Token / bg |
|---|---|---|
| Critical | ≥ 5 | `--critical` / `--critical-bg` |
| High | ≥ 4 | `--high` / `--high-bg` |
| Monitor | ≥ 3 | `--monitor` / `--monitor-bg` |
| Low | < 3 | `--safe` / `--safe-bg` (the "filtered out" band) |

Note: ≥ `MEMO_THRESHOLD` (default 4) is the band that drafts a memo - so Critical/High items are the ones with a memo to open.

## Type

- **Display / headings:** a clean geometric grotesque - **Inter** (or `Söhne` / `General Sans` if available), semibold, tight tracking. Big numbers (counts) in the same family, heavy weight.
- **Body / UI:** Inter regular/medium.
- **Mono (data):** `ui-monospace, "JetBrains Mono", "SF Mono"` for **bill identifiers** (`TX-HB-892`, = `items.identifier`) and severity scores - a tasteful "intelligence terminal" nod. Everything else stays sans.
- **Pill labels** (`THREAT` / `INTEL` / `STATUS` / `IMPACT` / `ACTION`): uppercase, letter-spaced, thin-outlined rounded rectangles.

## Layout - Overview (the hero)

```
┌───────────────────────────────────────────────────────────────────────┐
│ ● ● ●   [Overview] Bills  Alerts                 RedLine   last sync 2m │  ← window chrome
├───────────────┬───────────────────────────────────────────────────────┤
│ SURFACED      │                  ⌁ auto-cycling                         │
│ THREATS    6  │        ┌─ THREAT ─────────────┐                         │
│               │        │ TX-HB-892  · 11:47pm  │                        │
│ ▸ TX-HB-892   │        │ THE MOVE  …amendment… │      [ US  MAP ]        │
│ ▸ WA-HB-2089  │        │ Origin: near-identical│   states shaded by      │
│   NEW         │        └───────────────────────┘   threat; one selected │
│ ▸ IL-SB-445   │                          ┌─ STATUS ──────────┐          │
│ ▸ CO-HB-1117  │   ┌─ IMPACT ───────────┐ │ Hearing: Tue 2pm  │          │
│ ▸ VA-SB-892   │   │ Why this hits you   │ │ Comment closes …  │          │
│ ▸ GA-SB-678   │   │ (labeled estimate)  │ └───────────────────┘          │
│               │   │ ┌ ACTION ─────────┐ │   legend: ▣ tracked ▢ none     │
│ Monitoring    │   │ │ Submit comment →│ │                                │
│ 130k+ items   │   └─┴─────────────────┴─┘                                │
└───────────────┴───────────────────────────────────────────────────────┘
        ▲ top bar also holds the persistent "Viewing as {business}" switcher
```

### The floating card variants → data
- **THREAT / THE MOVE** - headline analysis + **provenance** ("near-identical to a failed bill in another state"). Provenance is **sourced, not invented**.
- **STATUS** - *factual* next events only: hearing date, `comment_close_date`, `last_action_text`. **No predicted vote counts.**
- **IMPACT** - qualitative "why this hits you" + a **labeled** `impact_estimate` only when grounded. Never a bare fabricated figure.
- **ACTION** - `recommended_action` + a link to the **official** portal/bill page, never a person.

## Product surface (spec §2)

Three tabs in one app shell + the persistent profile switcher:
- **Overview** - the map (above).
- **Bills** - the full scored list (the existing `redline-dashboard.jsx` prototype): each card a `SeverityStamp` + identifier + source + category chips + status + per-you justification + Track; click → memo slide-over. A "N items filtered out as low relevance" expander makes **precision visible**.
- **Alerts** - the **review queue** (approval gate): memos sit `draft` until approved; nothing goes out otherwise. Plus digest settings + comment-deadline alerts.
- **Tracker** - kanban by normalized `Stage`: Proposed → Comment open → Finalized → In effect → Contested/Vacated (`STAGES` in `src/lib/types.ts`).

## Components to build

`AppShell` (chrome + tabs + sync indicator) · `ProfileSwitcher` (**the signature** - re-scores everything) · `SurfacedThreats` (left rail + NEW badges + count) · `ThreatMap` (react-simple-maps choropleth, states shaded by threat for the active profile, click to focus) · `FloatingCard` (THREAT/STATUS/IMPACT/ACTION, auto-cycle with pause-on-hover) · `BillsFeed` + `SeverityStamp` + `MemoPanel` (slide-over) · `Tracker` · `ReviewQueue`.

A working prototype of the Bills feed + memo panel + profile switcher exists in `redline-dashboard.jsx` - **re-theme it to the warm palette above and add the Overview map.**

## Motion (restrained)

Severity stamp + map recolor on profile switch (**250ms**); floating cards auto-cycle with a soft cross-fade (**pausable**); slide-over panel transition; hover lift on cards. **Respect `prefers-reduced-motion`. Nothing else.** The one memorable motion is the re-score on profile switch - keep everything around it quiet.

## Quality floor (non-negotiable)

- **Responsive to mobile:** nav collapses, map stacks above cards, slide-over → full width.
- **Visible keyboard focus** using `--accent`.
- **Reduced motion respected** everywhere.
- **Empty / error states give direction in the product's voice** - "Track a rule and it lands here," not a mood.
- **Coverage honesty in the UI:** beta modules/states are labeled; the state-regulatory-register gap is surfaced, not hidden ([TRUST_AND_GUARDRAILS](./TRUST_AND_GUARDRAILS.md#coverage-honesty)).
