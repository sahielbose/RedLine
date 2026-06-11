"use client";

/**
 * / — the marketing site, ported from the reference prototype: fixed nav,
 * parchment + etching hero with a live mini-app window (the REAL board for the
 * importer profile, computed server-side and passed in), old-way-vs-RedLine,
 * how-it-works, open-source, CTA, footer. Navigation to the dashboard is
 * routing (<Link href="/app">), not view state.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2, Github, MapPin } from "lucide-react";
import type { BoardData } from "@/app/lib/board";
import { band, sevStyle } from "@/app/lib/ui";
import { TileMap } from "@/app/components/TileMap";

/* ---------- copy (the reference prototype is our copy) ---------- */

const STEPS: [string, string, string][] = [
  ["01", "Tell us what you are", "Two minutes of onboarding builds your business profile — what you do, where you operate, what would hurt you. The profile is the filter."],
  ["02", "We read everything", "Continuous ingestion from Congress, the Federal Register, and all 50 state legislatures. Every change lands in an append-only history."],
  ["03", "You get a scored brief", "A 0–5 threat score and a plain-English memo per item — what it does, where it is, who it hits — every claim cited and verified against the source."],
  ["04", "Nothing moves without you", "Memos are drafts until you approve them. Then the digest goes out on your schedule, and the tracker follows every item you care about."],
];

const OSS_ROWS: [string, string][] = [
  ["MIT licensed, end to end.", "No closed core, no usage meter. Fork it, ship it, sell with it."],
  ["Bring your own model.", "Claude for the best memos, or a local model via Ollama for a fully self-hosted deploy. The interface is the same."],
  ["Eval-gated by design.", "A golden test set scores the relevance engine on every change. If recall drops, the change doesn't merge. That's the trust."],
  ["Honest about coverage.", "Sample data is labeled. Beta modules are labeled. No theater."],
];

const TICKER = ["CONGRESS.GOV", "FEDERAL REGISTER", "REGULATIONS.GOV", "50 STATES + DC", "SYNCED HOURLY"];

const GITHUB_URL = "https://github.com/sahielbose/RedLine";

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
      <div className="old"><div className="tag">The old way</div><p>{old}</p></div>
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

/* ---------- site ---------- */

export function SiteView({ heroBoard, heroHome = [] }: { heroBoard: BoardData; heroHome?: string[] }) {
  // ONE floating card over the hero map, from the real board's top item.
  const heroCard = heroBoard.surfaced.length > 0 ? heroBoard.surfaced[0] : null;
  const heroBand = heroCard ? band(heroCard.score) : null;
  const heroMove = heroCard ? (heroCard.memo?.what_it_does ?? heroCard.summary) : "";

  return (
    <div className="rx">
      <nav className="nav">
        <span className="wordmark">RED<span className="bar">|</span>LINE</span>
        <a className="lnk" href="#how">How it works</a>
        <a className="lnk" href="#compare">Compare</a>
        <a className="lnk" href="#oss">Open source</a>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <a className="lnk" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub"
            style={{ display: "flex", alignItems: "center", gap: 6 }}><Github size={16} /> GitHub</a>
          <Link href="/app" className="btn" style={{ textDecoration: "none" }}>
            Open dashboard <ArrowRight size={15} />
          </Link>
        </span>
      </nav>

      {/* hero */}
      <header className="hero etch">
        <div className="hero-in heroflex">
          <div className="heroleft">
            <div className="eyebrow">Open-source regulatory watch</div>
            <h1 className="h1">130,000 bills are moving right now.<br /><span className="em">A few are aimed at you.</span></h1>
            <p className="sub">
              RedLine reads every bill and rule across Congress and all 50 states, scores what threatens
              <b> your</b> business, and briefs you in plain English — with receipts. The watch a $30K-a-month
              lobbyist runs for big companies, open-sourced for everyone else.
            </p>
            <div style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
              <Link href="/app" className="btn" style={{ textDecoration: "none" }}>
                Open the dashboard <ArrowRight size={15} />
              </Link>
              <a className="btn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer"
                style={{ textDecoration: "none" }}><Github size={15} /> Star on GitHub</a>
            </div>
            <div className="ticker">
              {TICKER.map((t) => <span className="tick" key={t}>{t}</span>)}
            </div>
          </div>

          {/* hero mini-app */}
          <div className="heroright float">
            <div className="window" style={{ boxShadow: "0 44px 100px -42px rgba(33,24,12,.6)" }}>
              <div className="chrome">
                <div className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
                <div className="tabs"><span className="tab on">Overview</span><span className="tab">Bills</span><span className="tab">Alerts</span></div>
                <div className="sync"><span><span className="syncdot" /> Scored live · demo data</span></div>
              </div>
              <div style={{ position: "relative", padding: "16px 16px 22px", background: "linear-gradient(180deg,#FBFAF7,#F6F3EE)" }}>
                <span className="pill"><MapPin size={11} /> Viewing as {heroBoard.label}</span>
                <TileMap map={heroBoard.mapByState} compact home={heroHome} />
                {heroCard && heroBand && (
                  <div className="fcard" style={{ top: 48, left: 12, maxWidth: 250, padding: "13px 14px" }}>
                    <div className="head">
                      <span className="pill" style={sevStyle(heroBand.key)}>{heroBand.label}</span>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{heroCard.identifier}</span>
                      {heroCard.sample && <span className="chip sample">SAMPLE</span>}
                    </div>
                    <h5 style={{ fontSize: 13 }}>{heroCard.title}</h5>
                    <div className="box" style={{ fontSize: 11.5 }}>
                      <div className="boxlbl">The move</div>
                      {heroMove.slice(0, 110)}…
                    </div>
                  </div>
                )}
                <div className="legend" style={{ marginTop: 18 }}>
                  <span><span className="sw" style={{ background: "var(--map-hot)" }} />High threat</span>
                  <span><span className="sw" style={{ background: "var(--map-mid)" }} />Watching</span>
                  <span><span className="sw" style={{ background: "var(--map-empty)" }} />Clear</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* compare */}
      <section className="section warm" id="compare">
        <div className="section-in">
          <h2 className="h2">The old way vs. RedLine.</h2>
          <p className="h2sub">Regulatory intelligence has been theater priced for lobbying shops. We took the theater out and open-sourced the rest.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 30 }}>
            <Cmp
              old="An AI announces a confident percentage that a bill passes — a number nobody can audit, trained on nothing it will show you. Confidence is easy to generate. It just isn't evidence."
              neu="We don't predict votes and we don't invent dollar figures. We show you the bill, where it is, what changed, and what it actually says — every claim cited to the source text and verified by code, every analysis a draft until you approve it. You bring the judgment."
            />
            <Cmp
              old="Built for lobbying shops: six-figure contracts, onboarding webinars, months to value. Priced so a small business never even sees the demo."
              neu="Describe your business in two minutes. Your first scored brief lands the same day. MIT-licensed and self-hostable — run it on your own machine, with your own model if you want. The code is public; so is the eval suite that keeps it honest."
              delay=".06s"
            />
            <Cmp
              old="Reads the bill at introduction and moves on. The midnight amendment, the quiet re-referral, the comment window that closes Friday — missed, and you find out when it's law."
              neu="Every status change is recorded the moment a sync sees it — amendments, hearings, comment deadlines — in an append-only history with a full audit trail. If something you track moves, it surfaces. That's the whole point."
              delay=".12s"
            />
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="section paper" id="how">
        <div className="section-in">
          <h2 className="h2">How it works.</h2>
          <p className="h2sub">Four steps between &ldquo;what&apos;s out there&rdquo; and &ldquo;what do I do.&rdquo;</p>
          <div className="steps">
            {STEPS.map(([n, t, b], i) => <StepCard key={n} n={n} t={t} b={b} i={i} />)}
          </div>
        </div>
      </section>

      {/* open source */}
      <section className="section warm" id="oss">
        <div className="section-in">
          <h2 className="h2">Trust you can read the source of.</h2>
          <p className="h2sub">The product is the filter and the proof. Both are public.</p>
          <div className="oss">
            <div className="codecard">
              <div><span className="c"># self-host in an afternoon</span></div>
              <div>$ git clone github.com/sahielbose/RedLine</div>
              <div>$ colima start</div>
              <div>$ npm run db:up</div>
              <div>$ cp .env.example .env <span className="c"># keys optional — local fallbacks</span></div>
              <div>{"$ npm i && npm run dev"}</div>
              <div><span className="c"># prove the filter before you trust it</span></div>
              <div>$ npm run eval</div>
            </div>
            <div className="osslist">
              {OSS_ROWS.map(([b, t]) => (
                <div className="row" key={b}>
                  <CheckCircle2 size={17} color="var(--safe)" style={{ flex: "0 0 auto", marginTop: 2 }} />
                  <span><b>{b}</b> {t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="cta etch">
        <h2 className="h2">Stop getting blindsided.</h2>
        <p className="h2sub" style={{ marginBottom: 26 }}>Open the dashboard, pick a business — or add your own — and watch the board re-score.</p>
        <Link href="/app" className="btn" style={{ fontSize: 15, padding: "13px 22px", textDecoration: "none" }}>
          Open the dashboard <ArrowRight size={16} />
        </Link>
      </section>

      <footer className="foot">
        <span className="wordmark" style={{ fontSize: 16 }}>RED<span className="bar">|</span>LINE</span>
        <span>Built in the open · MIT licensed · demo includes labeled sample state data pending live ingestion.</span>
        <a className="lnk" href={GITHUB_URL} target="_blank" rel="noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--hero-ink)" }}><Github size={15} /> sahielbose/RedLine</a>
      </footer>
    </div>
  );
}
