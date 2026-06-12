"use client";

/**
 * Settings tab — bring-your-own-key control center (spec §4, §15).
 *
 * Lets the operator paste an Anthropic API key, choose a model, and flip the
 * engine between the local (free, hermetic) judge and Claude — all taking effect
 * immediately, with no .env edit or restart. A "Test connection" button does a
 * live one-token probe and reports precisely ("out of credits", "key rejected",
 * etc.). The key is sent once to the server, stored there (mode 0600), and never
 * returned — the UI only ever sees a masked tail.
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Check, X, Loader2, Cpu, Sparkles, Database, Mail, Landmark, Building2 } from "lucide-react";

type LLMProvider = "local" | "anthropic" | "ollama";

interface SafeSettings {
  provider: LLMProvider;
  model: string;
  hasAnthropicKey: boolean;
  anthropicKeyTail: string | null;
  keySource: "settings" | "env" | "none";
  status: { congressKey: boolean; openStatesKey: boolean; database: boolean; smtp: boolean };
  updatedAt: string | null;
}

const MODELS: { id: string; label: string; note: string }[] = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", note: "Most capable" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "Balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fastest / cheapest" },
];

interface TestResult {
  ok: boolean;
  reason?: string;
  hint?: string;
  model?: string;
}

export function SettingsPanel({ onToast }: { onToast?: (msg: string) => void }) {
  const [settings, setSettings] = useState<SafeSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [provider, setProvider] = useState<LLMProvider>("local");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const s: SafeSettings = await res.json();
      setSettings(s);
      setModel(s.model);
      setProvider(s.provider);
    } catch {
      /* leave defaults */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setTest(null);
    try {
      const body: Record<string, string> = { anthropicModel: model, llmProvider: provider };
      if (keyInput.trim()) body.anthropicApiKey = keyInput.trim();
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const s: SafeSettings = await res.json();
      setSettings(s);
      setProvider(s.provider);
      setModel(s.model);
      setKeyInput("");
      onToast?.(provider === "anthropic" ? "Saved — agents now run on Claude" : "Settings saved");
    } catch {
      onToast?.("Could not save settings");
    } finally {
      setSaving(false);
    }
  }, [keyInput, model, provider, onToast]);

  const clearKey = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropicApiKey: "", llmProvider: "local" }),
      });
      const s: SafeSettings = await res.json();
      setSettings(s);
      setProvider(s.provider);
      setKeyInput("");
      setTest(null);
      onToast?.("Key removed — using the local engine");
    } finally {
      setSaving(false);
    }
  }, [onToast]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyInput.trim() ? { anthropicApiKey: keyInput.trim(), anthropicModel: model } : { anthropicModel: model }),
      });
      setTest(await res.json());
    } catch {
      setTest({ ok: false, hint: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  }, [keyInput, model]);

  const keyLine = settings?.hasAnthropicKey
    ? `Key set ${settings.keySource === "env" ? "from .env" : "in app"} · ${settings.anthropicKeyTail}`
    : "No Anthropic key yet";

  return (
    <main className="main" key="settings">
      <div className="h-app">Settings</div>
      <div className="sub-app">
        Bring your own Anthropic key and choose the engine. Everything is personalized to <b>your business</b> either way —
        the key just upgrades the analysis from the local engine to Claude.
      </div>

      {/* ── Engine + key ─────────────────────────────────────────────── */}
      <div className="set-card">
        <div className="set-h"><KeyRound size={15} /> AI engine</div>

        <div className="field">
          <label>Engine</label>
          <div className="seg">
            <button className={provider === "local" ? "on" : ""} onClick={() => setProvider("local")}>
              <Cpu size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} /> Local engine
            </button>
            <button className={provider === "anthropic" ? "on" : ""} onClick={() => setProvider("anthropic")}>
              <Sparkles size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} /> Claude
            </button>
          </div>
          <div className="set-hint">
            {provider === "local"
              ? "Free, instant, runs with zero keys. Great for trying the product."
              : "Claude reads bill text and writes the briefs. Needs a funded Anthropic key — falls back to the local engine automatically if Claude is unavailable."}
          </div>
        </div>

        <div className="field">
          <label>Anthropic API key</label>
          <input
            type="password"
            className="key-input"
            placeholder={settings?.hasAnthropicKey ? "•••••••••• (leave blank to keep current)" : "sk-ant-…"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="set-hint">
            <span className={settings?.hasAnthropicKey ? "key-set" : ""}>{keyLine}</span>
            {settings?.hasAnthropicKey && settings.keySource === "settings" && (
              <button className="link-btn" onClick={clearKey} disabled={saving}>Remove</button>
            )}
          </div>
        </div>

        <div className="field">
          <label>Claude model</label>
          <div className="model-grid">
            {MODELS.map((m) => (
              <button
                key={m.id}
                className={"model-opt" + (model === m.id ? " on" : "")}
                onClick={() => setModel(m.id)}
              >
                <span className="model-name">{m.label}</span>
                <span className="model-note">{m.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="set-actions">
          <button className="btn btn-blue" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save settings
          </button>
          <button className="btn ghost" onClick={runTest} disabled={testing}>
            {testing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Test connection
          </button>
        </div>

        {test && (
          <div className={"test-result " + (test.ok ? "ok" : "bad")}>
            {test.ok ? <Check size={15} /> : <X size={15} />}
            <span>
              {test.ok
                ? `Connected to ${test.model}. Claude is ready.`
                : test.hint || "Connection failed."}
            </span>
          </div>
        )}
      </div>

      {/* ── Data sources status (read-only) ──────────────────────────── */}
      <div className="set-card">
        <div className="set-h">Connected data &amp; delivery</div>
        <div className="set-status">
          <StatusRow ok={settings?.status.database} icon={<Database size={14} />} label="Database (Postgres)" on="Connected" off="Not configured" />
          <StatusRow ok={settings?.status.congressKey} icon={<Landmark size={14} />} label="Congress.gov API" on="Key set" off="No key (Federal Register still works keyless)" />
          <StatusRow ok={settings?.status.openStatesKey} icon={<Building2 size={14} />} label="Open States (50-state bills)" on="Key set" off="No key" />
          <StatusRow ok={settings?.status.smtp} icon={<Mail size={14} />} label="Email delivery (SMTP)" on="Configured" off="Console-only (digests log instead of send)" />
        </div>
        <div className="set-hint">These are configured in <code>.env</code>. Everything works on local fallbacks without them.</div>
      </div>
    </main>
  );
}

function StatusRow({ ok, icon, label, on, off }: { ok: boolean | undefined; icon: React.ReactNode; label: string; on: string; off: string }) {
  return (
    <div className="status-row">
      <span className="status-ico">{icon}</span>
      <span className="status-label">{label}</span>
      <span className={"status-pill " + (ok ? "yes" : "no")}>{ok ? on : off}</span>
    </div>
  );
}
