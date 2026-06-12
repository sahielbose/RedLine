"use client";

/**
 * / - the RedLine marketing site, product-as-hero (spec §12 aesthetic: warm
 * parchment, antique-engraving panels, one royal-blue accent, restrained
 * motion). Structure: airy hero → full-width product window on an engraving
 * panel (the REAL board for the importer profile, computed server-side) →
 * proof strip → two feature splits whose mocks render real engine output →
 * scroll-active process → comparison → open source & trust → CTA → footer.
 *
 * Honesty rules carry into marketing: the hero map, threat cards, citations,
 * and severity scores are real pipeline output for a real profile - no
 * invented dollar figures, no fake vote counts, our own copy throughout.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  Github,
  Loader2,
  Lock,
  MapPin,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import type { BoardData, SurfacedCard } from "@/app/lib/board";
import { DEMO_ITEMS } from "@/app/lib/demo-data";
import { band, sevStyle } from "@/app/lib/ui";
import { USMap } from "@/app/components/USMap";
import { usePrefersReducedMotion } from "@/app/lib/useReducedMotion";

/* ---------- copy (ours - honest, specific) ---------- */

const GITHUB_URL = "https://github.com/sahielbose/RedLine";

const TICKER = ["CONGRESS.GOV", "FEDERAL REGISTER", "OPEN STATES", "50 STATES + DC", "4,400+ ITEMS LIVE"];

const PROOF: [string, string][] = [
  ["4,400+", "Live bills and rules ingested and embedded"],
  ["3", "Sources: Congress, the Federal Register, the states"],
  ["50 + DC", "State legislatures plus the federal docket"],
  ["2 min", "From a blank profile to your first scored board"],
];

const STEPS: [string, string, string][] = [
  [
    "01",
    "Tell us your business",
    "A two-minute profile sets what you do, where you operate, and what would hurt you. Business type, headcount, imports, subscriptions, marketplaces, food role, data, and all fifty states. That profile is the filter.",
  ],
  [
    "02",
    "Agents read and score every item",
    "Each live bill and rule runs through the real pipeline: a category gate, a vector prefilter, then a Claude judge scoped to your profile. Every item gets a 0 to 5 threat score and a reason it does, or does not, apply to you.",
  ],
  [
    "03",
    "You get a cited brief and act",
    "A plain-English memo lays out what the item does, where it is, and who it hits. Every claim is cited to the source text and verified by code. The memo stays a draft until a human approves it.",
  ],
];

const COMPARE: [string, string][] = [
  [
    "Built for lobbying shops. Six-figure contracts, onboarding webinars, months to value, priced so a small business never sees the demo.",
    "Built for the small business. Describe yourself in two minutes and see your real exposure the same session. MIT licensed and self-hostable.",
  ],
  [
    "Confident vote percentages and dollar impacts that nobody can audit. A number is easy to generate. It just is not evidence.",
    "No predicted votes, no invented dollar figures. We show the bill, where it is, and what it says, with every claim cited and verified against the source.",
  ],
  [
    "One generic feed for everyone. You sift hundreds of unrelated items to find the few that touch you, and you find out too late.",
    "Scored per business profile through a real relevance engine. The handful of items aimed at you rise to the top; the rest are filtered with a reason.",
  ],
  [
    "A black box. You trust the vendor because you have no other choice, and you cannot inspect how a score was reached.",
    "Open source, end to end. Read the pipeline, run the eval suite, see why every item scored the way it did. The code is the proof.",
  ],
];

const TRUST: [string, string][] = [
  ["MIT licensed, end to end.", "No closed core and no usage meter. Read the pipeline, fork it, and self-host it on your own machine with your own model."],
  ["Citations verified by code.", "Every quoted claim is checked against the source text before it reaches you. A citation that does not match the document is dropped, not guessed."],
  ["Official portals only.", "Links point to public government portals to read and comment. No scraped personal data, no shadow databases."],
  ["No fabrication.", "No predicted vote counts and no invented dollar impacts. The memo is a draft until a human approves it, and the eval suite keeps the filter honest on every change."],
];

/* ---------- reveal-on-scroll (reduced-motion guarded) ---------- */

const reduced = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced() || typeof IntersectionObserver === "undefined") {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ---------- hero product window (the money shot, real board) ---------- */

function HeroShot({ heroBoard, heroHome }: { heroBoard: BoardData; heroHome: string[] }) {
  const ref = useReveal();
  const rail = heroBoard.surfaced.slice(0, 6);
  const spot: SurfacedCard | null = heroBoard.surfaced[0] ?? null;
  const b = spot ? band(spot.score) : null;
  const move = spot ? (spot.memo?.what_it_does || spot.summary || spot.justification) : "";

  return (
    <div className="hero-shot reveal" ref={ref}>
      <div className="engraving shot-panel">
        <div className="window shot-window">
          <div className="chrome">
            <div className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
            <div className="tabs">
              <span className="tab on">Overview</span><span className="tab">Bills</span><span className="tab">Alerts</span>
            </div>
            <div className="sync"><span><span className="syncdot" /> Scored live</span></div>
          </div>
          <div className="shot-body">
            <aside className="shot-rail">
              <div className="shot-railh">Surfaced threats <span className="ct mono">{heroBoard.surfaced.length}</span></div>
              {rail.map((c, i) => (
                <div className={"shot-item" + (i === 0 ? " on" : "")} key={c.id}>
                  <span className="mono si-id">
                    {c.identifier}
                    {c.isNew && <span className="chip new">NEW</span>}
                  </span>
                  <span className="si-t">{c.title}</span>
                </div>
              ))}
              <div className="shot-railf">Monitoring {heroBoard.totalItems.toLocaleString()}+ items across 50 states + Congress</div>
            </aside>
            <div className="shot-stage">
              <div className="shot-viewing">
                <span className="pill"><MapPin size={11} /> Viewing as {heroBoard.label}</span>
                <span className="shot-meta mono">{heroBoard.meta || "Per-business exposure"}</span>
              </div>
              <USMap map={heroBoard.mapByState} home={heroHome} compact active={spot?.postal ? spot.postal.toUpperCase() : null} />
              {spot && b && (
                <>
                  <div className="fcard shot-fc shot-fc-threat">
                    <div className="head">
                      <span className="pill" style={sevStyle(b.key)}>Threat</span>
                      <span className="mono fc-id">{spot.identifier}</span>
                      {spot.isNew && <span className="chip new">NEW</span>}
                    </div>
                    <h5>{spot.title}</h5>
                    <div className="box">
                      <div className="boxlbl">What it does</div>
                      {move.length > 110 ? move.slice(0, 110).trimEnd() + "…" : move}
                    </div>
                  </div>
                  <div className="fcard shot-fc shot-fc-impact">
                    <div className="head">
                      <span className="pill" style={sevStyle(b.key)}>{b.label} · {spot.score}/5</span>
                    </div>
                    <div className="box">
                      <div className="boxlbl">Why it hits this business</div>
                      {spot.justification.length > 110 ? spot.justification.slice(0, 110).trimEnd() + "…" : spot.justification}
                    </div>
                  </div>
                  <div className="fcard shot-fc shot-fc-action">
                    <div className="head"><span className="pill">Action</span></div>
                    <span className="actbtn">
                      {spot.memo?.recommended_action === "comment" ? "Comment" : "Monitor"} <ArrowUpRight size={12} />
                    </span>
                    <div className="org">Official public portal only.</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- feature split 1: the agent run (mock mirrors the REAL stages) -- */

const AGENT_STEPS: { label: string; detail?: string; state: "done" | "run" | "wait" }[] = [
  { label: "Reading your question", state: "done" },
  { label: "Category gate", detail: "food · goods · data privacy", state: "done" },
  { label: "Searching live bills and rules", detail: "keyword + vector", state: "done" },
  { label: "Judging 50 candidates against your profile", state: "run" },
  { label: "Drafting the cited memo", state: "wait" },
];

function AgentMock() {
  return (
    <div className="window splitwin agentmock">
      <div className="chrome">
        <div className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
        <div className="sync"><span>RedLine · Search</span></div>
      </div>
      <div className="am-body">
        <div className="am-bar">
          <ScanSearch size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span className="am-q">Which new rules hit a California food maker that imports packaging?</span>
          <span className="am-run"><Loader2 size={12} className="spin" /> Working</span>
        </div>
        <div className="am-head mono">REDLINE AGENT RUN · 3/5 TASKS</div>
        <ol className="am-steps">
          {AGENT_STEPS.map((s, i) => (
            <li key={s.label} className={"am-step " + s.state} style={{ animationDelay: `${0.25 + i * 0.45}s` }}>
              <span className="am-ico">
                {s.state === "done" ? <Check size={12} /> : s.state === "run" ? <Loader2 size={12} className="spin" /> : null}
              </span>
              <span>{s.label}</span>
              {s.detail && <span className="am-detail mono">{s.detail}</span>}
            </li>
          ))}
        </ol>
        <div className="am-foot mono">
          <span>4,400+ live items</span><span>·</span><span>3 sources</span><span>·</span><span>every judgment logged</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- feature split 2: clause-level brief (REAL memo + citation) ---- */

function ClauseMock({ spot }: { spot: SurfacedCard | null }) {
  if (!spot) return null;
  const b = band(spot.score);
  const demoItem = DEMO_ITEMS.find((d) => d.id === spot.id);
  const sourceText = demoItem?.full_text ?? spot.summary;
  const cite = spot.memo?.citations.find((c) => c.verified) ?? spot.memo?.citations[0] ?? null;
  // Split the source text around the verified snippet so it renders highlighted
  // in context - the same substring check the pipeline enforces (spec §8).
  let before = sourceText, mark = "", after = "";
  if (cite) {
    const idx = sourceText.indexOf(cite.snippet);
    if (idx >= 0) {
      before = sourceText.slice(0, idx);
      mark = cite.snippet;
      after = sourceText.slice(idx + cite.snippet.length);
    } else {
      mark = cite.snippet;
      before = "";
      after = "";
    }
  }

  return (
    <div className="window splitwin clausemock">
      <div className="chrome">
        <div className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
        <div className="sync"><span>RedLine · Memo</span></div>
      </div>
      <div className="cm-body">
        <div className="cm-doc">
          <div className="cm-doctop">
            <span className="chip id">{spot.identifier}</span>
            <span className="chip">{spot.status}</span>
          </div>
          <div className="cm-doctitle">{spot.title}</div>
          <p className="cm-text">
            {before}
            {mark && <mark>{mark}</mark>}
            {after}
          </p>
        </div>
        <div className="cm-memo">
          <div className="cm-sec">
            <div className="boxlbl"><FileText size={10} style={{ verticalAlign: "-1px" }} /> Plain English</div>
            <p>{spot.memo?.what_it_does ?? spot.summary}</p>
          </div>
          <div className="cm-sec">
            <div className="boxlbl">Why this matters <span className="pill cm-sev" style={sevStyle(b.key)}>{b.label} · {spot.score}/5</span></div>
            <p>{spot.justification}</p>
          </div>
          {cite && (
            <div className="cm-sec">
              <div className="boxlbl">Source</div>
              <p className="cm-cite">&ldquo;{cite.snippet.length > 90 ? cite.snippet.slice(0, 90).trimEnd() + "…" : cite.snippet}&rdquo;</p>
              {cite.verified && <span className="ok"><CheckCircle2 size={11} /> citation verified in source by code</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- process: three steps, scroll-activated ---------- */

function Process() {
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  const secRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = secRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setInView(e.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const prefersReduced = usePrefersReducedMotion();
  useEffect(() => {
    if (!inView || pinned || prefersReduced) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 3500);
    return () => clearInterval(t);
  }, [inView, pinned, prefersReduced]);

  return (
    <section className="section paper" id="process" ref={secRef}>
      <div className="section-in">
        <div className="eyebrow center">Our process</div>
        <h2 className="h2 h2-light">Three steps from noise to a decision.</h2>
        <p className="h2sub">Tell us your business, let the agents read and score every item against you, and act on a cited brief.</p>
        <div className="process2">
          {STEPS.map(([n, t, b], i) => (
            <button
              key={n}
              className={"pstep" + (active === i ? " live" : "")}
              onMouseEnter={() => { setActive(i); setPinned(true); }}
              onMouseLeave={() => setPinned(false)}
              onFocus={() => { setActive(i); setPinned(true); }}
              onBlur={() => setPinned(false)}
              aria-pressed={active === i}
            >
              <span className="ps-rule" />
              <span className="ps-n mono">{n}</span>
              <span className="ps-t">{t}</span>
              <span className="ps-b">{b}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- site ---------- */

export function SiteView({ heroBoard, heroHome = [] }: { heroBoard: BoardData; heroHome?: string[] }) {
  const spot = heroBoard.surfaced[0] ?? null;
  const r1 = useReveal();
  const r2 = useReveal();
  const r3 = useReveal();
  const r4 = useReveal();

  return (
    <div className="rx site2">
      <nav className="nav">
        <span className="wordmark">RED<span className="bar">|</span>LINE</span>
        <a className="lnk" href="#process">Process</a>
        <a className="lnk" href="#compare">Compare</a>
        <a className="lnk" href="#features">Features</a>
        <a className="lnk" href="#oss">Open source</a>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <a className="lnk" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub"
            style={{ display: "flex", alignItems: "center", gap: 6 }}><Github size={16} /> GitHub</a>
          <Link href="/app" className="btn btn-blue" style={{ textDecoration: "none" }}>
            Open the app <ArrowRight size={15} />
          </Link>
        </span>
      </nav>

      {/* hero: airy statement, then the full-width product window */}
      <header className="hero2">
        <div className="hero2-in">
          <div className="eyebrow">Open-source regulatory watch</div>
          <h1 className="h1 hero2-h1">
            See the bills aimed at your business,
            <br />
            <span className="em">before they land.</span>
          </h1>
          <p className="sub hero2-sub">
            RedLine reads every live bill and rule across Congress, the Federal Register, and the
            states, scores what threatens <b>your</b> business, and briefs you in plain English with
            cited, code-verified receipts. The watch a lobbying shop runs for big companies, open
            for everyone else.
          </p>
          <div className="hero-cta">
            <Link href="/app" className="btn btn-blue btn-lg" style={{ textDecoration: "none" }}>
              Open the app <ArrowRight size={16} />
            </Link>
            <a className="btn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer"
              style={{ textDecoration: "none" }}><Github size={15} /> View the source</a>
          </div>
          <div className="ticker">
            {TICKER.map((t) => <span className="tick" key={t}>{t}</span>)}
          </div>
        </div>
        <HeroShot heroBoard={heroBoard} heroHome={heroHome} />
      </header>

      {/* proof strip */}
      <section className="proof">
        <div className="proof-in">
          {PROOF.map(([n, l]) => (
            <div className="proof-cell" key={l}>
              <div className="proof-n mono">{n}</div>
              <div className="proof-l">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* feature split 1: reads + scores */}
      <section className="section paper" id="features">
        <div className="section-in">
          <div className="split reveal" ref={r1}>
            <div className="split-copy">
              <div className="eyebrow">The engine</div>
              <h2 className="h2 h2-light h2-left">Reads the whole docket. Scores what actually hits you.</h2>
              <p className="split-p">
                Keyword alerts miss the rider that breaks your pricing model. RedLine&apos;s agents
                read each live bill and rule, gate it by category, prefilter it by meaning, and have
                a judge score it 0&ndash;5 against your specific business &mdash; with the reason logged,
                every time.
              </p>
              <ul className="split-list">
                <li><ScanSearch size={15} /> Hybrid keyword + vector retrieval over the live corpus</li>
                <li><Activity size={15} /> A 0&ndash;5 rubric judge scoped to your profile, streamed step by step</li>
                <li><ShieldCheck size={15} /> Every judgment logged with model + prompt version</li>
              </ul>
            </div>
            <div className="engraving split-panel">
              <AgentMock />
            </div>
          </div>

          {/* feature split 2: the cited brief */}
          <div className="split split-rev reveal" ref={r2}>
            <div className="split-copy">
              <div className="eyebrow">The brief</div>
              <h2 className="h2 h2-light h2-left">The brief a $500-an-hour consultant would write. In seconds.</h2>
              <p className="split-p">
                You are reading a rule at 10pm wondering if it is going to be a problem. The memo
                tells you what it means in plain English, why it matters to your business, and where
                it is in the process &mdash; and every claim is checked by code against the source
                text before it reaches you.
              </p>
              <ul className="split-list">
                <li><FileText size={15} /> What it does · status &amp; next steps · who is affected · the action</li>
                <li><CheckCircle2 size={15} /> Citations verified as exact substrings of the source</li>
                <li><Lock size={15} /> Drafts until a human approves &mdash; nothing auto-sends</li>
              </ul>
            </div>
            <div className="engraving split-panel">
              <ClauseMock spot={spot} />
            </div>
          </div>
        </div>
      </section>

      {/* process */}
      <Process />

      {/* compare */}
      <section className="section warm" id="compare">
        <div className="section-in">
          <div className="eyebrow center">The difference</div>
          <h2 className="h2 h2-light">Incumbents versus RedLine.</h2>
          <p className="h2sub">Regulatory intelligence was priced for lobbying shops and built as a black box. We took both apart.</p>
          <div className="cmp-stack reveal" ref={r3}>
            {COMPARE.map(([old, neu]) => (
              <div className="cmp" key={old.slice(0, 24)}>
                <div className="old"><div className="tag">Incumbents</div><p>{old}</p></div>
                <div className="new"><div className="tag">RedLine</div><p>{neu}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* open source + trust */}
      <section className="section paper" id="oss">
        <div className="section-in">
          <div className="eyebrow center">Open source and honest by design</div>
          <h2 className="h2 h2-light">Trust you can read the source of.</h2>
          <p className="h2sub">The product is the filter and the proof. Both are public, both are auditable.</p>
          <div className="oss reveal" ref={r4}>
            <div className="codecard">
              <div><span className="c"># clone it and run it yourself</span></div>
              <div>$ git clone github.com/sahielbose/RedLine</div>
              <div>$ npm install</div>
              <div>$ npm run dev <span className="c"># the full app, locally</span></div>
              <div><span className="c"># prove the relevance engine</span></div>
              <div>$ npm run eval <span className="c"># golden set, P/R/F1</span></div>
            </div>
            <div className="osslist">
              {TRUST.map(([b, t]) => (
                <div className="row" key={b}>
                  <CheckCircle2 size={17} color="var(--safe)" style={{ flex: "0 0 auto", marginTop: 2 }} />
                  <span><b>{b}</b> {t}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="trust-badges">
            <span className="trust-badge"><ShieldCheck size={14} /> Code-verified citations</span>
            <span className="trust-badge"><Lock size={14} /> Official portals only</span>
            <span className="trust-badge"><Github size={14} /> MIT licensed</span>
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="cta-band">
        <div className="cta-in">
          <h2 className="h2 h2-light">Find out what is aimed at you.</h2>
          <p className="h2sub" style={{ marginBottom: 28 }}>
            Open the app, build a two-minute profile, and watch the board score live against your business.
          </p>
          <div className="cta-row">
            <Link href="/app" className="btn btn-blue btn-lg" style={{ textDecoration: "none" }}>
              Open the app <ArrowRight size={16} />
            </Link>
            <a className="btn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer"
              style={{ textDecoration: "none" }}><Github size={15} /> Star on GitHub</a>
          </div>
        </div>
      </section>

      <footer className="foot">
        <span className="wordmark" style={{ fontSize: 16 }}>RED<span className="bar">|</span>LINE</span>
        <span>Built in the open. MIT licensed. Scoring live bills and rules from Congress, the Federal Register, and the states.</span>
        <a className="lnk" href={GITHUB_URL} target="_blank" rel="noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--hero-ink)" }}><Github size={15} /> sahielbose/RedLine</a>
      </footer>
    </div>
  );
}
