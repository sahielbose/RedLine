/**
 * Shared HTTP helper for SourceClients (spec §5): JSON GET with query building,
 * timeout, and rate-limit-aware retry/backoff (honors Retry-After; exponential
 * otherwise). `fetchImpl` is injectable so source clients are testable without
 * network — though most tests exercise the pure `normalize*` functions directly.
 */
type QueryValue = string | number | boolean | undefined | null;

export interface FetchJsonOpts {
  headers?: Record<string, string>;
  /** Array values expand to repeated params (`include=a&include=b`), which is
   *  what the Open States v3 gateway requires (it 422s on comma/space joins). */
  query?: Record<string, QueryValue | QueryValue[]>;
  /** Total attempts = maxRetries + 1. */
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Sleep hook (injectable so tests don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function buildUrl(base: string, query?: FetchJsonOpts["query"]): string {
  if (!query) return base;
  const url = new URL(base);
  const keep = (x: QueryValue) => x !== undefined && x !== null && x !== "";
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) if (keep(item)) url.searchParams.append(k, String(item));
    } else if (keep(v)) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function fetchJson<T>(base: string, opts: FetchJsonOpts = {}): Promise<T> {
  const { headers = {}, query, maxRetries = 4, timeoutMs = 30_000 } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const url = buildUrl(base, query);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { accept: "application/json", ...headers },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) return (await res.json()) as T;

      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        await sleep(backoffMs(res, attempt));
        continue;
      }
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    } catch (err) {
      lastErr = err;
      // Network/abort errors are retryable up to the cap.
      if (attempt < maxRetries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`fetchJson failed for ${url}`);
}

/** Backoff for a retryable response: Retry-After header if present, else exp. */
function backoffMs(res: Response, attempt: number): number {
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  }
  return Math.min(2 ** attempt * 500, 30_000);
}
