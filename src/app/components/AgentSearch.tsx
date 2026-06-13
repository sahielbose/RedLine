"use client";

/**
 * Agentic search (the "agents actually run" surface). Posts a natural-language
 * question to /api/search and renders the REAL pipeline working over REAL data,
 * streamed step by step via Server-Sent Events: read query -> retrieve live
 * bills + rules (hybrid keyword + vector) -> judge each candidate with Claude.
 * Results stream in as the judge finishes each one. Nothing here is mocked.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, Check, ExternalLink, Loader2, Search, Sparkles, X } from "lucide-react";
import { band, sevStyle, displaySource } from "@/app/lib/ui";

const SAVED_KEY = "redline.savedSearches";

interface Stage {
  key: string;
  label: string;
  status: "run" | "done";
  detail?: string;
}
interface Result {
  id: string;
  identifier: string;
  title: string;
  summary: string;
  source: string;
  agency: string | null;
  jurisdiction: string;
  categories: string[];
  similarity: number | null;
  score: number;
  justification: string;
  matchedConcern: string | null;
  status: string;
  stage: string;
  lastActionDate: string | null;
  commentCloseDate: string | null;
  actionUrl: string | null;
}

const EXAMPLES = [
  "tariffs and customs duties on imported products",
  "independent contractor and worker classification",
  "FTC consumer protection consent orders",
  "data breach notification requirements",
];

export function AgentSearch({
  profileId,
  profileLabel,
}: {
  profileId: string;
  profileLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) setSaved(JSON.parse(raw) as string[]);
    } catch {
      /* ignore corrupted storage */
    }
  }, []);

  const persistSaved = useCallback((next: string[]) => {
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable - non-fatal */
    }
  }, []);

  const saveCurrent = useCallback(() => {
    const q = query.trim();
    if (!q || saved.includes(q)) return;
    persistSaved([q, ...saved].slice(0, 12));
  }, [query, saved, persistSaved]);

  const removeSaved = useCallback(
    (q: string) => persistSaved(saved.filter((s) => s !== q)),
    [saved, persistSaved],
  );

  const run = useCallback(
    async (qOverride?: string) => {
      const q = (qOverride ?? query).trim();
      if (!q || running) return;
      if (qOverride) setQuery(qOverride);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setRunning(true);
      setRan(true);
      setError(null);
      setStages([]);
      setResults([]);

      const upsertStage = (s: Stage) =>
        setStages((prev) => {
          const i = prev.findIndex((p) => p.key === s.key);
          if (i === -1) return [...prev, s];
          const next = [...prev];
          next[i] = { ...next[i], ...s };
          return next;
        });

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, profileId: profileId || undefined }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          for (const ev of events) {
            const line = ev.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const msg = JSON.parse(line.slice(6));
            if (msg.type === "stage") upsertStage(msg);
            else if (msg.type === "result")
              setResults((prev) =>
                [...prev, msg.result as Result].sort(
                  (a, b) => b.score - a.score || (b.similarity ?? 0) - (a.similarity ?? 0),
                ),
              );
            else if (msg.type === "error") setError(msg.message);
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError"))
          setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setRunning(false);
      }
    },
    [query, running, profileId],
  );

  const relevant = results.filter((r) => r.score >= 3);

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h2 className="h-app">Agentic search</h2>
        <div className="sub-app">
          Ask in plain English. The agents retrieve real bills and rules, then judge each one
          for <b>{profileLabel}</b> live.
        </div>
      </div>

      <div className="srch-bar">
        <Search size={17} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          className="srch-input"
          placeholder="e.g. new rules on imported goods, contractor classification, privacy..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          aria-label="Search bills and rules"
        />
        <button
          className="srch-save"
          onClick={saveCurrent}
          disabled={!query.trim() || saved.includes(query.trim())}
          title={saved.includes(query.trim()) ? "Already saved" : "Save this search"}
        >
          {saved.includes(query.trim()) ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        </button>
        <button className="btn-run" onClick={() => run()} disabled={running || !query.trim()}>
          {running ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
          {running ? "Running" : "Run agents"}
        </button>
      </div>

      {saved.length > 0 && (
        <div className="srch-examples">
          <span className="ex-label">Saved:</span>
          {saved.map((s) => (
            <span key={s} className="chip ex-chip saved-chip">
              <button className="saved-run" onClick={() => run(s)} disabled={running} title="Re-run this search">{s}</button>
              <button className="saved-x" onClick={() => removeSaved(s)} aria-label={`Remove saved search: ${s}`}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="srch-examples">
        <span className="ex-label">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip ex-chip" onClick={() => run(ex)} disabled={running}>
            {ex}
          </button>
        ))}
      </div>

      {stages.length > 0 && (
        <div className="agent-run">
          <div className="ar-head">AGENT RUN</div>
          <ol className="ar-steps">
            {stages.map((s) => (
              <li key={s.key} className={`ar-step ${s.status}`}>
                <span className="ar-ico">
                  {s.status === "done" ? <Check size={13} /> : <Loader2 size={13} className="spin" />}
                </span>
                <span className="ar-label">{s.label}</span>
                {s.detail && <span className="ar-detail">{s.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && <div className="srch-error">Search error: {error}</div>}

      {ran && !running && results.length > 0 && (
        <div className="srch-summary">
          {relevant.length > 0 ? (
            <>
              <b>{relevant.length}</b> relevant {relevant.length === 1 ? "item" : "items"} found
              {results.length > relevant.length && ` (${results.length} judged in total)`}.
            </>
          ) : (
            <>
              Judged <b>{results.length}</b> closest items - none scored relevant for this business.
              That is the honest answer: nothing in the live corpus matches strongly right now.
            </>
          )}
        </div>
      )}

      <div className="srch-results">
        {results.map((r) => {
          const b = band(r.score);
          return (
            <div key={r.id} className="card srch-card">
              <div className="sc-top">
                <span className="stamp" style={sevStyle(r.score >= 3 ? b.key : "safe")}>
                  {r.score >= 3 ? b.label : "Low"} · {r.score}/5
                </span>
                <span className="mono sc-id">{r.identifier}</span>
                <span className="sc-src">{displaySource({ source: r.source, agency: r.agency })}</span>
                {r.agency && <span className="sc-agency">{r.agency}</span>}
              </div>
              <div className="sc-title">{r.title}</div>
              <div className="sc-just">{r.justification}</div>
              <div className="sc-foot">
                {r.status && <span className="sc-status">{r.status}</span>}
                {r.lastActionDate && <span className="sc-date">Updated {r.lastActionDate}</span>}
                {r.commentCloseDate && (
                  <span className="sc-date sc-deadline">Comments close {r.commentCloseDate}</span>
                )}
                {r.actionUrl && (
                  <a
                    className="sc-link"
                    href={r.actionUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official source <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {ran && !running && results.length === 0 && !error && (
        <div className="empty">
          No items matched. Try a broader phrasing.
          <br />
          <button className="chip" style={{ marginTop: 8 }} onClick={() => run(EXAMPLES[0])}>
            {EXAMPLES[0]} <ArrowRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
