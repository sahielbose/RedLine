"use client";

/**
 * / - the RedLine marketing site. A calm, editorial, product-as-hero page:
 * refined hero with a live product mockup (the REAL board for the importer
 * profile, computed server-side and passed in), a quantified proof strip,
 * a three-step process, an expanded old-vs-RedLine comparison, a flagship
 * feature showcase, an open-source and trust section, a final CTA, footer.
 *
 * Navigation to the dashboard is routing (<Link href="/app">), not view state.
 * The SiteView export signature and props contract are preserved.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FileText,
  Github,
  Lock,
  MapPin,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import type { BoardData, SurfacedCard } from "@/app/lib/board";
import { band, sevStyle } from "@/app/lib/ui";
import { TileMap } from "@/app/components/TileMap";

/* ---------- copy (honest, specific) ---------- */

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

const FEATURES: { icon: typeof ScanSearch; head: string; body: string }[] = [
  {
    icon: ScanSearch,
    head: "Agentic search, in plain English",
    body: "Ask a question the way you would ask a lawyer. Agents retrieve live bills and rules with hybrid keyword and vector search, then Claude judges each one scoped to your business, streamed step by step.",
  },
  {
    icon: MapPin,
    head: "A threat board built for you",
    body: "A US map you can click to focus any state plus the federal docket. Every tile is shaded by your real exposure, not a generic heat map, so you see at a glance where the pressure is.",
  },
  {
    icon: Activity,
    head: "A live activity feed",
    body: "The latest real actions as they land: introductions, amendments, hearings, and comment windows. Each event links straight to the item and its score so nothing quiet slips past you.",
  },
  {
    icon: FileText,
    head: "Bill detail with verified citations",
    body: "Key dates, a link to the official portal to read and comment, and citations checked by code against the source text. If a claim is not in the document, it does not ship.",
  },
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

/* ---------- building blocks ---------- */

function Cmp({ old, neu, delay }: { old: string; neu: string; delay?: string }) {
  const ref = useReveal();
  return (
    <div className="cmp reveal" ref={ref} style={delay ? { transitionDelay: delay } : undefined}>
      <div className="old"><div className="tag">Incumbents</div><p>{old}</p></div>
      <div className="new"><div className="tag">RedLine</div><p>{neu}</p></div>
    </div>
  );
}

function StepCard({ n, t, b, i }: { n: string; t: string; b: string; i: number }) {
  const ref = useReveal();
  return (
    <div className="step reveal" ref={ref} style={{ transitionDelay: `${i * 70}ms` }}>
      <div className="n">{n}</div><h4>{t}</h4><p>{b}</p>
    </div>
  );
}

function FeatureBlock({
  icon: Icon,
  head,
  body,
  i,
}: {
  icon: typeof ScanSearch;
  head: string;
  body: string;
  i: number;
}) {
  const ref = useReveal();
  return (
    <div className="feat reveal" ref={ref} style={{ transitionDelay: `${i * 70}ms` }}>
      <div className="feat-ico"><Icon size={18} /></div>
      <h4>{head}</h4>
      <p>{body}</p>
    </div>
  );
}

/* A compact, believable threat row inside the hero product window, fed by the
 * REAL board (real identifier, score, and memo text). One idea per row. */
function HeroRow({ card }: { card: SurfacedCard }) {
  const b = band(card.score);
  const why = card.memo?.what_it_does ?? card.justification ?? card.summary;
  return (
    <div className="hero-row">
      <div className="hero-stamp" style={sevStyle(b.key)}>
        <span className="hsc">{card.score}</span>
        <span className="hsl">{b.label}</span>
      </div>
      <div className="hero-rowbody">
        <div className="hero-rowtop">
          <span className="mono hero-rowid">{card.identifier}</span>
          {card.isNew && <span className="chip new">NEW</span>}
        </div>
        <div className="hero-rowtitle">{card.title}</div>
        <div className="hero-rowwhy">{why.slice(0, 96)}…</div>
      </div>
    </div>
  );
}

/* ---------- site ---------- */

export function SiteView({ heroBoard, heroHome = [] }: { heroBoard: BoardData; heroHome?: string[] }) {
  // The product window is fed by the REAL board: top scored items for the
  // importer profile, with a floating spotlight card on the map.
  const rows = heroBoard.surfaced.slice(0, 3);
  const heroCard = heroBoard.surfaced.length > 0 ? heroBoard.surfaced[0] : null;
  const heroBand = heroCard ? band(heroCard.score) : null;
  const heroMove = heroCard ? (heroCard.memo?.what_it_does ?? heroCard.summary) : "";

  return (
    <div className="rx">
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

      {/* hero */}
      <header className="hero">
        <div className="hero-in heroflex">
          <div className="heroleft">
            <div className="eyebrow">Open-source regulatory watch</div>
            <h1 className="h1 h1-light">
              See the bills aimed<br />at your business,<br /><span className="em">before they land.</span>
            </h1>
            <p className="sub">
              RedLine reads every live bill and rule across Congress, the Federal Register, and the
              states, scores what threatens <b>your</b> business, and briefs you in plain English with
              cited, code-verified receipts. The watch a lobbying shop runs for big companies, open for
              everyone else.
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

          {/* hero product window (real board) */}
          <div className="heroright">
            <div className="window hero-window">
              <div className="chrome">
                <div className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
                <div className="tabs"><span className="tab on">Overview</span><span className="tab">Search</span><span className="tab">Activity</span></div>
                <div className="sync"><span><span className="syncdot" /> Scored live</span></div>
              </div>
              <div className="hero-windowbody">
                <div className="hero-maprow">
                  <span className="pill"><MapPin size={11} /> Viewing as {heroBoard.label}</span>
                  <span className="hero-mapnote">{heroBoard.meta || "Per-business exposure"}</span>
                </div>
                <div className="hero-mapwrap">
                  <TileMap map={heroBoard.mapByState} compact home={heroHome} />
                  {heroCard && heroBand && (
                    <div className="fcard" style={{ top: 40, left: 10, maxWidth: 232, padding: "12px 13px" }}>
                      <div className="head">
                        <span className="pill" style={sevStyle(heroBand.key)}>{heroBand.label}</span>
                        <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{heroCard.identifier}</span>
                      </div>
                      <h5 style={{ fontSize: 12.5 }}>{heroCard.title}</h5>
                      <div className="box" style={{ fontSize: 11 }}>
                        <div className="boxlbl">What it does</div>
                        {heroMove.slice(0, 104)}…
                      </div>
                    </div>
                  )}
                </div>
                <div className="hero-feed">
                  {rows.map((c) => <HeroRow key={c.id} card={c} />)}
                </div>
              </div>
            </div>
          </div>
        </div>
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

      {/* process */}
      <section className="section paper" id="process">
        <div className="section-in">
          <div className="eyebrow center">Our process</div>
          <h2 className="h2 h2-light">Three steps from noise to a decision.</h2>
          <p className="h2sub">Tell us your business, let the agents read and score every item against you, and act on a cited brief.</p>
          <div className="steps steps-3">
            {STEPS.map(([n, t, b], i) => <StepCard key={n} n={n} t={t} b={b} i={i} />)}
          </div>
        </div>
      </section>

      {/* compare */}
      <section className="section warm" id="compare">
        <div className="section-in">
          <div className="eyebrow center">The difference</div>
          <h2 className="h2 h2-light">Incumbents versus RedLine.</h2>
          <p className="h2sub">Regulatory intelligence was priced for lobbying shops and built as a black box. We took both apart.</p>
          <div className="cmp-stack">
            {COMPARE.map(([old, neu], i) => (
              <Cmp key={old} old={old} neu={neu} delay={`${i * 0.06}s`} />
            ))}
          </div>
        </div>
      </section>

      {/* features */}
      <section className="section paper" id="features">
        <div className="section-in">
          <div className="eyebrow center">Flagship features</div>
          <h2 className="h2 h2-light">Everything is real and working in the app.</h2>
          <p className="h2sub">No mockups behind the demo. Each of these runs the same pipeline you can read in the source.</p>
          <div className="feats">
            {FEATURES.map((f, i) => (
              <FeatureBlock key={f.head} icon={f.icon} head={f.head} body={f.body} i={i} />
            ))}
          </div>
        </div>
      </section>

      {/* open source + trust */}
      <section className="section warm" id="oss">
        <div className="section-in">
          <div className="eyebrow center">Open source and honest by design</div>
          <h2 className="h2 h2-light">Trust you can read the source of.</h2>
          <p className="h2sub">The product is the filter and the proof. Both are public, both are auditable.</p>
          <div className="oss">
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
