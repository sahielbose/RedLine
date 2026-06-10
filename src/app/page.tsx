/**
 * Phase-0 placeholder home. The full Overview map + Bills feed + Alerts shell
 * lands in Phase 3 (spec §2, §12). This boots green so `npm run dev` works.
 */
export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <p
          className="mono"
          style={{ color: "var(--accent)", letterSpacing: "0.18em", fontSize: 12 }}
        >
          REDLINE
        </p>
        <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: "0.5rem 0", letterSpacing: "-0.02em" }}>
          Regulatory watch for small business
        </h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 17, lineHeight: 1.5 }}>
          Ingest every bill and rule moving through U.S. government, score what threatens{" "}
          <em>your</em> business, and get a cited, plain-English brief — in seconds.
        </p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: "1.5rem" }} className="mono">
          scaffold ready · dashboard lands in phase 3
        </p>
      </div>
    </main>
  );
}
