/**
 * Stage 0 — category tagging + intersection (spec §7, §9).
 *
 * `classifyItem` runs the declarative TAGGING_RULES over an item's
 * title + summary + agency/source signal and returns the union of matched
 * categories. Tagging is recall-first (spec §7): we'd rather over-tag and let
 * the Stage-B judge reject than silently drop an item before it reaches a judge.
 *
 * `categoryIntersect` is the cheap pre-filter: keep an item for a profile only
 * if its categories overlap the profile's subscribed categories. This is why a
 * food rule never reaches a SaaS company's judge.
 */
import { TAGGING_RULES } from "@/lib/taxonomy";
import { isCategory, type Category } from "@/lib/types";

/**
 * The minimal item shape Stage 0 needs. A superset of the source-signal fields
 * of `NormalizedItem` (spec §6) — we accept either a live `NormalizedItem` or an
 * eval fixture. `agency` is an optional explicit agency token (fixtures provide
 * it); otherwise `source` is used as the agency signal.
 */
export interface ClassifiableItem {
  title: string;
  summary?: string | null;
  source?: string | null;
  /** Explicit issuing agency token, e.g. "FDA", "CBP" (eval fixtures set this). */
  agency?: string | null;
  /** If already tagged (e.g. at ingest), used as-is by relevance scoring. */
  categories?: string[];
}

/** Whitespace/lowercase-normalize a signal string for matching. */
function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Tag an item with taxonomy categories using TAGGING_RULES (spec §9).
 * Generous by design (recall-first). Returns a de-duplicated, validated list.
 */
export function classifyItem(item: ClassifiableItem): Category[] {
  // The combined signal text: title + summary + agency/source tokens.
  const agencySignal = normalize(item.agency ?? item.source ?? "");
  const text = `${normalize(item.title)} ${normalize(item.summary)} ${agencySignal}`;

  const matched = new Set<Category>();
  for (const rule of TAGGING_RULES) {
    const keywordHit = rule.keywords.some((kw) => text.includes(kw));
    const agencyHit = (rule.agencies ?? []).some((a) => agencySignal.includes(a));
    if (keywordHit || agencyHit) {
      for (const cat of rule.categories) {
        if (isCategory(cat)) matched.add(cat);
      }
    }
  }
  return [...matched];
}

/**
 * Resolve an item's categories: prefer explicit `categories` (set at ingest or
 * in a fixture), else classify from the signal text.
 */
export function resolveCategories(item: ClassifiableItem): Category[] {
  if (item.categories && item.categories.length > 0) {
    return item.categories.filter(isCategory);
  }
  return classifyItem(item);
}

/**
 * Stage 0 intersection (spec §7): the categories shared by an item and a
 * profile. Empty result ⇒ the item is out of scope for that profile.
 */
export function categoryIntersect(
  itemCats: readonly string[],
  subscribedCats: readonly string[],
): Category[] {
  const subs = new Set(subscribedCats);
  const out = new Set<Category>();
  for (const c of itemCats) {
    if (subs.has(c) && isCategory(c)) out.add(c);
  }
  return [...out];
}
