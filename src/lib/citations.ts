/**
 * Citation verification (spec §7, §8, CLAUDE.md §9).
 *
 * CODE decides whether a citation is real - never the model. A citation is
 * "verified" iff its snippet, after whitespace normalization, is a substring of
 * the source text (also whitespace-normalized). Unverifiable citations are
 * flagged (verified=false) so the memo layer can drop or surface them.
 */
import type { Citation, MemoContent } from "@/lib/types";

/** Collapse all whitespace to single spaces, trim, lowercase for tolerant match. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * True iff `snippet` is a whitespace-normalized substring of `sourceText`.
 * Empty snippets never verify (an empty string is trivially a substring, which
 * would let the model "cite nothing" - reject that).
 */
export function verifyCitation(sourceText: string, snippet: string): boolean {
  const s = normalize(snippet);
  if (s.length === 0) return false;
  return normalize(sourceText).includes(s);
}

/**
 * Verify every citation in a memo against the source text and return a new memo
 * with each citation's `verified` flag set by CODE. By default unverifiable
 * citations are DROPPED (the safe behavior for outbound memos); pass
 * `{ drop: false }` to keep them flagged instead (useful for debugging/review).
 */
export function verifyMemoCitations(
  memo: MemoContent,
  sourceText: string,
  opts: { drop?: boolean } = {},
): MemoContent {
  const drop = opts.drop ?? true;
  const checked: Citation[] = memo.citations.map((c) => ({
    ...c,
    verified: verifyCitation(sourceText, c.snippet),
  }));
  const citations = drop ? checked.filter((c) => c.verified) : checked;
  return { ...memo, citations };
}
