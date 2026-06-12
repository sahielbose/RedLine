/**
 * LLM error classification (spec §8 trust layer). Turns any thrown LLM error
 * (Anthropic SDK APIError, a fetch/timeout, a Zod/JSON parse failure) into a
 * small, stable shape so callers can:
 *   - decide whether a corrective retry is worthwhile (`retryable`), and
 *   - show the user a precise, actionable status instead of a raw stack
 *     ("Claude is out of credits — add credits", not "400 …").
 *
 * Pure and dependency-free so both the Anthropic adapter and the FallbackLLM
 * wrapper can import it without a cycle.
 */

export type LLMErrorReason =
  | "no_credits"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "timeout"
  | "invalid_request"
  | "parse"
  | "error";

export interface LLMErrorInfo {
  reason: LLMErrorReason;
  /** Worth a single corrective retry on the SAME provider (only true for parse). */
  retryable: boolean;
  /** HTTP status when the error came from the API, else undefined. */
  status?: number;
  /** Raw-ish message for logs. */
  message: string;
  /** One-sentence, user-facing guidance keyed off `reason`. */
  userHint: string;
}

const HINTS: Record<LLMErrorReason, string> = {
  no_credits:
    "Your Anthropic account is out of credits. Add credits at console.anthropic.com → Plans & Billing, then retry.",
  auth: "The Anthropic API key was rejected. Check the key in Settings.",
  rate_limit: "Claude is rate-limited right now. It will work again shortly.",
  overloaded: "Claude is temporarily overloaded. Try again in a moment.",
  timeout: "The request to Claude timed out.",
  invalid_request: "Claude rejected the request as malformed.",
  parse: "Claude returned output that did not match the required format.",
  error: "Claude could not be reached.",
};

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Best-effort numeric HTTP status from an Anthropic SDK error or fetch Response-ish. */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  if (typeof s === "number") return s;
  // SDK sometimes prefixes the message with the status, e.g. `400 {"type":...}`.
  const m = messageOf(err).match(/^\s*(\d{3})\b/);
  return m ? Number(m[1]) : undefined;
}

export function classifyLLMError(err: unknown): LLMErrorInfo {
  const message = messageOf(err);
  const lower = message.toLowerCase();
  const status = statusOf(err);
  const name = (err as { name?: string })?.name ?? "";

  let reason: LLMErrorReason = "error";

  if (name === "ZodError" || lower.includes("no json object") || lower.includes("did not parse")) {
    reason = "parse";
  } else if (lower.includes("credit balance") || lower.includes("billing")) {
    reason = "no_credits";
  } else if (status === 401 || lower.includes("authentication") || lower.includes("invalid x-api-key") || lower.includes("invalid api key")) {
    reason = "auth";
  } else if (status === 429 || lower.includes("rate limit")) {
    reason = "rate_limit";
  } else if (status === 529 || lower.includes("overloaded")) {
    reason = "overloaded";
  } else if (name === "AbortError" || lower.includes("timeout") || lower.includes("timed out")) {
    reason = "timeout";
  } else if (status === 400) {
    reason = "invalid_request";
  }

  return {
    reason,
    retryable: reason === "parse",
    status,
    message,
    userHint: HINTS[reason],
  };
}
