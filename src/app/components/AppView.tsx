"use client";

/**
 * /app - the dashboard (ported from the reference prototype): Overview
 * (US tile map + auto-cycling cards) · Bills · Alerts · Tracker, all driven by
 * REAL precomputed board data (the engine ran server-side). Switching
 * "Viewing as" swaps boards instantly - the signature recolor. "Add your
 * business" POSTs /api/profiles, so the response board came from the actual
 * pipeline; the digest POSTs /api/digest with APPROVED memos only (the
 * approval gate, spec §8). Custom profiles + per-profile marks persist to
 * localStorage (hydrated in an effect to avoid SSR mismatch).
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Bookmark, BookmarkCheck, BookOpen, Building2, CheckCircle2,
  ChevronDown, Circle, ClipboardCheck, Clock, Cpu, ExternalLink, Eye, History, Mail, MapPin,
  Copy, Download, FileText, PenLine, Plus, Quote, Scale, Search, ShieldAlert, ShoppingBag, Sparkles, ThumbsDown, ThumbsUp, UtensilsCrossed, X,
  type LucideIcon,
} from "lucide-react";
import type { BoardData, DashboardData, ProfileSummary, SurfacedCard } from "@/app/lib/board";
import {
  ACTION_LABEL, ATTR_SECTIONS, BIZ_TYPES, FOOD_ROLES, STAGE_LABEL, STAGE_ORDER, STATE_OPTIONS,
  band, categoryLabel, displayJurisdiction, displaySource, homeStates, sevStyle,
  type BandKey,
} from "@/app/lib/ui";
import { POSTAL_TO_NAME } from "@/app/lib/geo";
import { usePrefersReducedMotion } from "@/app/lib/useReducedMotion";
import { USMap } from "@/app/components/USMap";
import { MapCards } from "@/app/components/MapCards";
import { Toasts, useToasts } from "@/app/components/Toasts";
import { AgentSearch } from "@/app/components/AgentSearch";
import { SettingsPanel } from "@/app/components/SettingsPanel";

/* ---------- constants ---------- */

const PROFILES_KEY = "redline.customProfiles";
const MARKS_KEY = "redline.marks";

const BAND_ICON: Record<BandKey, LucideIcon> = {
  critical: ShieldAlert,
  high: AlertTriangle,
  monitor: Eye,
  low: Circle,
};

const TYPE_ICON: Record<string, LucideIcon> = {
  software: Building2,
  goods: ShoppingBag,
  food: UtensilsCrossed,
  hardware: Cpu,
};

type Tab = "overview" | "activity" | "search" | "bills" | "alerts" | "tracker" | "settings";
const TAB_LIST: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "search", label: "Search" },
  { id: "bills", label: "Bills" },
  { id: "alerts", label: "Alerts" },
  { id: "tracker", label: "Tracker" },
  { id: "settings", label: "Settings" },
];

/** Friendly relative date for the activity stream: "Today" / "Yesterday" / "Jun 5, 2026". */
function activityDate(iso: string): string {
  if (!iso) return "Undated";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startOfToday.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A plain-English summary of the law for EVERY item: the model/source summary
 *  when present, otherwise an honest restatement of the item's own metadata (no
 *  fabrication - never invents what the law does). Guarantees the brief is never
 *  blank even for sources (e.g. the Congress list endpoint) that ship no summary. */
function plainEnglishSummary(c: SurfacedCard): string {
  const fromMemo = c.memo?.what_it_does?.replace(/^per the source:\s*/i, "").trim();
  if (fromMemo) return fromMemo;
  if (c.summary && c.summary.trim()) return c.summary.trim();
  const kind =
    c.source === "congress"
      ? "federal bill"
      : c.source === "federal_register"
        ? "federal rule or notice"
        : c.source === "openstates"
          ? "state bill"
          : "regulatory item";
  const origin = c.agency
    ? `issued by ${c.agency}`
    : c.postal
      ? `before the ${POSTAL_TO_NAME[c.postal] ?? c.jurisdiction} legislature`
      : "in the U.S. Congress";
  const status = c.status ? ` Current status: ${c.status}.` : "";
  return `${c.identifier ? c.identifier + " is a" : "A"} ${kind} ${origin}.${status} The full, authoritative text is on the official source linked below.`;
}

/** Render source text with the code-verified citation snippets highlighted in
 *  place, so the substring-verification (rule #9) is literally visible: a mark =
 *  a passage the code confirmed exists in the source. Only verified snippets are
 *  highlighted; nothing the check didn't confirm is ever marked. */
function highlightSource(text: string, snippets: string[]): React.ReactNode[] {
  const clean = snippets.map((s) => s.trim()).filter((s) => s.length >= 8);
  if (!clean.length) return [text];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const s of clean) {
    const idx = lower.indexOf(s.toLowerCase());
    if (idx !== -1) ranges.push([idx, idx + s.length]);
  }
  if (!ranges.length) return [text];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach(([a, b], i) => {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(<mark className="clause-hl" key={i}>{text.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/** Who is moving this item - the honest "intel" line (issuing body / chamber),
 *  derived from real fields. No vote predictions, no invented committee math. */
function issuingBody(c: SurfacedCard): string {
  if (c.agency) return c.agency;
  if (c.source === "congress") return "U.S. Congress";
  if (c.source === "openstates") return `${c.postal ? POSTAL_TO_NAME[c.postal] ?? "State" : "State"} Legislature`;
  if (c.source === "federal_register") return "Federal agency";
  return displaySource(c);
}

type FeedbackLabel = "relevant" | "not_relevant";
type Disposition = "support" | "oppose" | "monitor";
interface ProfileMarks {
  tracked: string[];
  approved: string[];
  feedback?: Record<string, FeedbackLabel>;
  /** Your stance on an item (support / oppose / monitor) - a user label, not a prediction. */
  disposition?: Record<string, Disposition>;
}
type Marks = Record<string, ProfileMarks>;
const EMPTY_MARKS: ProfileMarks = { tracked: [], approved: [], feedback: {}, disposition: {} };

const DISPOSITIONS: { id: Disposition; label: string }[] = [
  { id: "support", label: "Support" },
  { id: "oppose", label: "Oppose" },
  { id: "monitor", label: "Monitor" },
];

/** One row of the "filtered out" expander - engine-judged rejects, merged from
 *  sub-3 surfaced items and Stage-0/A filtered items. */
interface LowRow {
  id: string;
  score: number;
  title: string;
  chip: string;
  justification: string;
}

/** The raw onboarding form, kept per custom profile so Edit can re-populate it. */
interface SavedForm {
  name: string;
  types: string[];
  states: string[];
  employees?: number;
  foodRole: string | null;
  context?: string;
  attrs: Record<string, boolean>;
}

interface StoredCustom {
  profiles: ProfileSummary[];
  boards: Record<string, BoardData>;
  forms?: Record<string, SavedForm>;
}

/* ---------- small hooks ---------- */

const reduced = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia) &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useCountUp(target: number, dur = 900): number {
  // Starts at 0 on server AND first client render (no hydration mismatch);
  // the effect snaps straight to `target` under prefers-reduced-motion.
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduced() || (typeof document !== "undefined" && document.hidden)) {
      setV(target);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const step = (t: number) => {
      if (t0 === null) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // rAF is suspended in background tabs - guarantee the final value lands.
    const safety = setTimeout(() => setV(target), dur + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [target, dur]);
  return v;
}

/* ---------- APP VIEW ---------- */

export function AppView({ data }: { data: DashboardData }) {
  const { toasts, toast } = useToasts();

  /* core state */
  const [activeId, setActiveId] = useState(data.profiles[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("overview");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [showLow, setShowLow] = useState(false);
  const [selState, setSelState] = useState<string | null>(null);
  const [hoverState, setHoverState] = useState<string | null>(null);
  const [spotId, setSpotId] = useState<string | null>(null);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [autoCycle, setAutoCycle] = useState(true);
  const [hoverPause, setHoverPause] = useState(false);
  const [freq, setFreq] = useState<"daily" | "weekly">("daily");
  const [customProfiles, setCustomProfiles] = useState<ProfileSummary[]>([]);
  const [customBoards, setCustomBoards] = useState<Record<string, BoardData>>({});
  const [customForms, setCustomForms] = useState<Record<string, SavedForm>>({});
  const [sendingDigest, setSendingDigest] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  /* "Add your business" modal state */
  const [modal, setModal] = useState(false);
  const [fName, setFName] = useState("");
  const [fTypes, setFTypes] = useState<string[]>([]);
  const [fAttrs, setFAttrs] = useState<Record<string, boolean>>({});
  const [fStates, setFStates] = useState<string[]>(["US"]);
  const [fEmployees, setFEmployees] = useState("");
  const [fFoodRole, setFFoodRole] = useState("");
  const [fContext, setFContext] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  /** Set when the modal is editing an existing custom profile (else create). */
  const [editingId, setEditingId] = useState<string | null>(null);

  /* hydrate persisted custom profiles + marks AFTER mount (no SSR mismatch) */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredCustom;
        if (parsed && Array.isArray(parsed.profiles) && parsed.boards && typeof parsed.boards === "object") {
          setCustomProfiles(parsed.profiles);
          setCustomBoards(parsed.boards);
          if (parsed.forms && typeof parsed.forms === "object") setCustomForms(parsed.forms);
        }
      }
    } catch {
      /* corrupted storage - start fresh */
    }
    try {
      const raw = localStorage.getItem(MARKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Marks;
        if (parsed && typeof parsed === "object") setMarks(parsed);
      }
    } catch {
      /* corrupted storage - start fresh */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify({ profiles: customProfiles, boards: customBoards, forms: customForms }));
    } catch {
      /* storage full / unavailable - non-fatal */
    }
  }, [hydrated, customProfiles, customBoards, customForms]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
    } catch {
      /* storage full / unavailable - non-fatal */
    }
  }, [hydrated, marks]);

  /* boards + profiles (built-in + custom) */
  const boards = useMemo(() => ({ ...data.boards, ...customBoards }), [data.boards, customBoards]);
  const profiles = useMemo(() => {
    // Dedupe: a persisted profile can come back from the server board on reload
    // AND still live in localStorage. Show it once, with the CLIENT copy winning
    // so in-session edits (rename, re-score) appear immediately and the exact-cased
    // label is preserved (the server board only re-reads on a full reload).
    const customIds = new Set(customProfiles.map((p) => p.id));
    return [...data.profiles.filter((p) => !customIds.has(p.id)), ...customProfiles];
  }, [data.profiles, customProfiles]);
  const fallbackBoard = data.boards[data.profiles[0]?.id ?? ""];
  const board: BoardData = boards[activeId] ?? fallbackBoard;
  const profile: ProfileSummary = profiles.find((p) => p.id === activeId) ?? profiles[0];

  /* per-profile marks */
  const profileMarks = marks[activeId] ?? EMPTY_MARKS;
  const tracked = useMemo(() => new Set(profileMarks.tracked), [profileMarks]);
  const approved = useMemo(() => new Set(profileMarks.approved), [profileMarks]);
  const feedback = profileMarks.feedback ?? {};
  const disposition = profileMarks.disposition ?? {};

  const toggleMark = useCallback(
    (kind: "tracked" | "approved", id: string, msg?: string) => {
      const has = (marks[activeId] ?? EMPTY_MARKS)[kind].includes(id);
      setMarks((prev) => {
        const cur = prev[activeId] ?? EMPTY_MARKS;
        const next = has ? cur[kind].filter((x) => x !== id) : [...cur[kind], id];
        return { ...prev, [activeId]: { ...cur, [kind]: next } };
      });
      if (!has && msg) toast(msg);
      // Best-effort durable sync: persists when this profile + item live in the DB
      // (the approval gate / tracked_items), no-op otherwise (demo/custom). Optimistic
      // UI above is the source of truth for the view.
      const url = kind === "approved" ? "/api/memos/approve" : "/api/track";
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeId, itemId: id, on: !has }),
      }).catch(() => {});
    },
    [marks, activeId, toast],
  );

  /** 👍/👎 relevance feedback (spec §8): records a label that feeds the eval set.
   *  Optimistic localStorage + best-effort durable write to relevance_feedback. */
  const sendFeedback = useCallback(
    (id: string, label: FeedbackLabel) => {
      const cur = (marks[activeId] ?? EMPTY_MARKS).feedback ?? {};
      const isSame = cur[id] === label;
      setMarks((prev) => {
        const m = prev[activeId] ?? EMPTY_MARKS;
        const fb = { ...(m.feedback ?? {}) };
        if (isSame) delete fb[id];
        else fb[id] = label;
        return { ...prev, [activeId]: { ...m, feedback: fb } };
      });
      if (!isSame) toast(label === "relevant" ? "Thanks - marked relevant" : "Thanks - marked not relevant");
      void fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeId, itemId: id, label, on: !isSame }),
      }).catch(() => {});
    },
    [marks, activeId, toast],
  );

  /** Set your stance on an item (support/oppose/monitor). Picking a stance also
   *  tracks the item (a stance implies a watchlist) and best-effort records the
   *  stance as the tracked_items note server-side. A user label, never a prediction. */
  const setDisposition = useCallback(
    (id: string, value: Disposition) => {
      const cur = (marks[activeId] ?? EMPTY_MARKS).disposition ?? {};
      const isSame = cur[id] === value;
      setMarks((prev) => {
        const m = prev[activeId] ?? EMPTY_MARKS;
        const d = { ...(m.disposition ?? {}) };
        const trackedList = m.tracked ?? [];
        if (isSame) delete d[id];
        else d[id] = value;
        // Selecting a stance auto-tracks; clearing it leaves tracking as-is.
        const nextTracked = !isSame && !trackedList.includes(id) ? [...trackedList, id] : trackedList;
        return { ...prev, [activeId]: { ...m, disposition: d, tracked: nextTracked } };
      });
      if (!isSame) toast(`Marked "${value}" for ${id.slice(0, 8)}`);
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeId, itemId: id, on: !isSame, note: isSame ? "" : value }),
      }).catch(() => {});
    },
    [marks, activeId, toast],
  );

  /* derived item lists */
  const surfaced = useMemo(
    () =>
      board.surfaced
        .filter((c) => c.score >= 3)
        .sort((a, b) => b.score - a.score || Number(b.isNew) - Number(a.isNew)),
    [board],
  );

  const low: LowRow[] = useMemo(() => {
    const fromSurfaced = board.surfaced
      .filter((c) => c.score < 3)
      .map((c) => ({
        id: c.id,
        score: c.score,
        title: c.title,
        chip: c.categories.length ? categoryLabel(c.categories[0]) : displaySource(c),
        justification: c.justification,
      }));
    const fromFiltered = board.filtered.map((c) => ({
      id: c.id,
      score: c.score,
      title: c.title,
      chip: c.categories.length ? categoryLabel(c.categories[0]) : displaySource({ agency: null, source: c.source }),
      justification: c.justification,
    }));
    return [...fromSurfaced, ...fromFiltered].sort((a, b) => b.score - a.score);
  }, [board]);

  /* Jurisdiction focus: clicking a state tile = that state + Federal (federal
   * rules apply everywhere, so they always fold in and the view is never empty). */
  const inFocus = useCallback(
    (postal: string | null) => !selState || postal === null || postal.toUpperCase() === selState,
    [selState],
  );
  const stateName = useCallback(
    (p: string) => POSTAL_TO_NAME[p] ?? POSTAL_TO_NAME[p.toLowerCase()] ?? POSTAL_TO_NAME[p.toUpperCase()] ?? p,
    [],
  );

  /* search + jurisdiction filter (bills tab) */
  const matchesQ = useCallback(
    (title: string) => !q || title.toLowerCase().includes(q.toLowerCase()),
    [q],
  );
  const feed = useMemo(
    () => surfaced.filter((c) => inFocus(c.postal) && matchesQ(c.title)),
    [surfaced, inFocus, matchesQ],
  );
  const lowFeed = useMemo(() => low.filter((c) => matchesQ(c.title)), [low, matchesQ]);

  /* overview: rail list (jurisdiction-focused) + the single highlighted item */
  const railList = useMemo(() => surfaced.filter((s) => inFocus(s.postal)), [surfaced, inFocus]);
  const federalCount = useMemo(() => surfaced.filter((s) => s.postal === null).length, [surfaced]);
  /* the item the floating cards describe: pinned by a rail click, else the
   * auto-cycle position (8s per item, paused on hover / by the toggle) */
  const CYCLE_MS = 8000;
  const activeItem: SurfacedCard | null = useMemo(() => {
    if (spotId) return railList.find((i) => i.id === spotId) ?? railList[0] ?? null;
    return railList.length ? railList[cycleIdx % railList.length] : null;
  }, [railList, spotId, cycleIdx]);
  const cyclePaused = Boolean(spotId) || !autoCycle || railList.length < 2;
  const prefersReduced = usePrefersReducedMotion();
  useEffect(() => {
    if (tab !== "overview" || cyclePaused || hoverPause || prefersReduced) return;
    const t = setInterval(() => setCycleIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(t);
  }, [tab, cyclePaused, hoverPause, prefersReduced]);
  /* activity feed: relevant items, newest action first (real last-action dates) */
  const activityList = useMemo(
    () =>
      surfaced
        .filter((s) => inFocus(s.postal) && s.lastActionDate)
        .slice()
        .sort((a, b) => (a.lastActionDate < b.lastActionDate ? 1 : a.lastActionDate > b.lastActionDate ? -1 : 0)),
    [surfaced, inFocus],
  );
  /* reset focus + highlight + cycle position when switching businesses */
  useEffect(() => {
    setSelState(null);
    setSpotId(null);
    setCycleIdx(0);
  }, [activeId]);

  /* memo slide-over */
  const open = useMemo(
    () => (openId ? board.surfaced.find((i) => i.id === openId) ?? null : null),
    [openId, board],
  );

  /* comment-letter drafter (Fed10 "draft your position paper"; draft-gated) */
  const [draft, setDraft] = useState<{ itemId: string; text: string; engine: string; notice?: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  useEffect(() => { setDraft(null); }, [openId]);
  const makeDraft = useCallback(async () => {
    if (!open || drafting) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeId,
          itemId: open.id,
          identifier: open.identifier,
          title: open.title,
          summary: open.summary,
          businessLabel: board.label,
        }),
      });
      const j = (await res.json().catch(() => null)) as { letter?: string; engine?: string; notice?: string } | null;
      if (j?.letter) setDraft({ itemId: open.id, text: j.letter, engine: j.engine ?? "local", notice: j.notice });
      else toast("Could not draft a letter");
    } catch {
      toast("Could not draft a letter");
    } finally {
      setDrafting(false);
    }
  }, [open, drafting, activeId, board.label, toast]);

  useEffect(() => {
    if (!openId && !modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close the topmost layer first: modal over slide-over.
      if (modal) setModal(false);
      else setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, modal]);

  /* stats (bills) */
  const counts = {
    critical: feed.filter((i) => i.score === 5).length,
    high: feed.filter((i) => i.score === 4).length,
    monitor: feed.filter((i) => i.score === 3).length,
    tracked: tracked.size,
  };
  const nC = useCountUp(counts.critical);
  const nH = useCountUp(counts.high);
  const nM = useCountUp(counts.monitor);
  const nT = useCountUp(counts.tracked);

  const pending = surfaced.filter((s) => !approved.has(s.id)).length;
  const approvedCards = useMemo(() => surfaced.filter((c) => approved.has(c.id)), [surfaced, approved]);

  /* digest - sends APPROVED items only (the approval gate) */
  const sendDigest = useCallback(async () => {
    if (sendingDigest) return;
    setSendingDigest(true);
    try {
      const res = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgLabel: board.label,
          items: approvedCards.map((c) => ({
            identifier: c.identifier,
            title: c.title,
            severity: c.severity,
            score: c.score,
            jurisdiction: displayJurisdiction(c.postal),
            whatItDoes: c.memo?.what_it_does ?? c.summary,
            recommendedAction: c.memo?.recommended_action ?? null,
            actionUrl: c.actionUrl,
            commentCloseDate: c.commentCloseDate,
          })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { transport?: string; error?: string } | null;
      if (res.ok) {
        toast(
          json?.transport === "smtp"
            ? "Digest sent via SMTP"
            : "Digest rendered - delivered to the server console (no SMTP_URL set)",
        );
      } else {
        toast(json?.error ?? "Digest failed - try again");
      }
    } catch {
      toast("Digest failed - network error");
    } finally {
      setSendingDigest(false);
    }
  }, [sendingDigest, board.label, approvedCards, toast]);

  /** Export the current scored board to CSV for sharing with team/counsel. Carries
   *  the same honesty as the UI: labeled impact estimate, source URL, memo status. */
  const exportCsv = useCallback(() => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "identifier", "title", "source", "jurisdiction", "categories", "score", "severity",
      "status", "stage", "summary", "why_relevant", "impact_estimate", "comment_close", "memo_status", "source_url",
    ];
    const lines = [header.join(",")];
    for (const r of feed) {
      lines.push(
        [
          r.identifier, r.title, displaySource(r), displayJurisdiction(r.postal),
          r.categories.map(categoryLabel).join("; "), r.score, r.severity, r.status,
          STAGE_LABEL[r.stage] ?? r.stage, plainEnglishSummary(r), r.justification,
          r.memo?.impact_estimate ?? "qualitative - not quantified",
          r.commentCloseDate ?? "", approved.has(r.id) ? "approved" : "draft", r.actionUrl ?? "",
        ].map(esc).join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `redline-${board.label.replace(/\s+/g, "-").toLowerCase()}-threats.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${feed.length} item${feed.length === 1 ? "" : "s"} to CSV`);
  }, [feed, approved, board.label, toast]);

  /* "Add your business" - the REAL engine re-scores the board server-side */
  const flip = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  /** Clear the modal form back to a blank "add" state. */
  const resetForm = useCallback(() => {
    setFName("");
    setFTypes([]);
    setFAttrs({});
    setFStates(["US"]);
    setFEmployees("");
    setFFoodRole("");
    setFContext("");
    setStateQuery("");
    setEditingId(null);
  }, []);

  /** Open the modal pre-filled to EDIT an existing custom profile. */
  const openEdit = useCallback(
    (id: string) => {
      const f = customForms[id];
      if (!f) {
        toast("This profile predates editing - remove and re-add it to edit.");
        return;
      }
      setFName(f.name);
      setFTypes(f.types);
      setFAttrs(f.attrs ?? {});
      setFStates(f.states?.length ? f.states : ["US"]);
      setFEmployees(typeof f.employees === "number" ? String(f.employees) : "");
      setFFoodRole(f.foodRole ?? "");
      setFContext(f.context ?? "");
      setStateQuery("");
      setEditingId(id);
      setModal(true);
    },
    [customForms, toast],
  );

  const createProfile = useCallback(async () => {
    if (creating) return;
    if (!fName.trim() || fTypes.length === 0) {
      toast("Give it a name and pick at least one business type");
      return;
    }
    setCreating(true);
    const savedForm: SavedForm = {
      name: fName.trim(),
      types: fTypes,
      states: fStates.length ? fStates : ["US"],
      employees: fEmployees.trim() === "" ? undefined : Number(fEmployees),
      foodRole: fFoodRole || null,
      context: fContext.trim() || undefined,
      attrs: {
        has_w2: Boolean(fAttrs.has_w2),
        contractors: Boolean(fAttrs.contractors),
        sells_physical_goods: Boolean(fAttrs.sells_physical_goods),
        subscription: Boolean(fAttrs.subscription),
        marketplace: Boolean(fAttrs.marketplace),
        imports: Boolean(fAttrs.imports),
        serves_food: Boolean(fAttrs.serves_food),
        online_data: Boolean(fAttrs.online_data),
        children_data: Boolean(fAttrs.children_data),
      },
    };
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...savedForm } : savedForm),
      });
      const json = (await res.json().catch(() => null)) as
        | { profile?: ProfileSummary; board?: BoardData; error?: string; live?: boolean }
        | null;
      if (res.ok && json?.profile && json.board) {
        const newProfile = json.profile;
        const newBoard = json.board;
        const rid = newProfile.id;
        if (editingId) {
          // Replace in place (keep switcher position); the id stays the same.
          setCustomProfiles((p) => p.map((c) => (c.id === editingId ? newProfile : c)));
        } else {
          setCustomProfiles((p) => [...p, newProfile]);
        }
        setCustomBoards((b) => ({ ...b, [rid]: newBoard }));
        setCustomForms((f) => ({ ...f, [rid]: savedForm }));
        setActiveId(rid);
        setOpenId(null);
        setModal(false);
        const wasEdit = Boolean(editingId);
        resetForm();
        toast(
          wasEdit
            ? "Profile updated - the board just re-scored for your changes"
            : json.live
              ? "Profile created - scored against live bills and rules for you"
              : "Profile created - the engine just re-scored the board for you",
        );
      } else {
        toast(json?.error ?? "Could not save the profile - try again");
      }
    } catch {
      toast("Could not save the profile - network error");
    } finally {
      setCreating(false);
    }
  }, [creating, editingId, fName, fTypes, fStates, fAttrs, fEmployees, fFoodRole, fContext, resetForm, toast]);

  /** Remove a custom (user-added) profile. Client state + localStorage update via
   *  the persist effect; best-effort server soft-delete for DB-persisted ones. */
  const removeProfile = useCallback(
    (id: string) => {
      const target = customProfiles.find((c) => c.id === id);
      if (!target) return; // seeded profiles are not removable
      if (typeof window !== "undefined" && !window.confirm(`Remove "${target.label}"? You can always add it again.`)) return;
      setCustomProfiles((p) => p.filter((c) => c.id !== id));
      setCustomBoards((b) => {
        const next = { ...b };
        delete next[id];
        return next;
      });
      setCustomForms((f) => {
        const next = { ...f };
        delete next[id];
        return next;
      });
      if (activeId === id) setActiveId(data.profiles[0]?.id ?? "");
      void fetch(`/api/profiles?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
      toast(`Removed ${target.label}`);
    },
    [customProfiles, activeId, data.profiles, toast],
  );

  const openBand = open ? band(open.score) : null;
  const OpenBandIcon = openBand ? BAND_ICON[openBand.key] : null;
  // Days until the public comment window closes (real, from comment_close_date).
  const commentDaysLeft =
    open?.commentCloseDate != null
      ? Math.ceil((new Date(open.commentCloseDate + "T00:00:00Z").getTime() - Date.now()) / 86_400_000)
      : null;

  return (
    <div className="rx">
      <div className="app-bg">
        <div className="window">
          {/* chrome */}
          <div className="chrome">
            <div className="tabs" role="tablist">
              {TAB_LIST.map(({ id, label }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={"tab" + (tab === id ? " on" : "")}
                  onClick={() => setTab(id)}
                >
                  {label}
                  {id === "alerts" && pending > 0 && <span className="tabcount">{pending}</span>}
                </button>
              ))}
            </div>
            <div className="sync">
              <Link className="sitelink" href="/">Site <ExternalLink size={11} /></Link>
            </div>
          </div>

          {/* brand + switcher */}
          <div className="brandbar">
            <span className="wordmark" style={{ fontSize: 17 }}>RED<span className="bar">|</span>LINE</span>
            <div className="switch" role="group" aria-label="Viewing as">
              <span className="lbl">Viewing as</span>
              {profiles.map((p) => {
                const isCustom = customProfiles.some((c) => c.id === p.id);
                const Ic = isCustom ? Sparkles : TYPE_ICON[p.businessTypes[0]] ?? Sparkles;
                return (
                  <button
                    key={p.id}
                    className={"pf" + (p.id === activeId ? " on" : "")}
                    onClick={() => { setActiveId(p.id); setOpenId(null); }}
                  >
                    <Ic size={15} />
                    <span><span className="nm">{p.label}</span><br /><span className="kd">{p.kind}</span></span>
                  </button>
                );
              })}
            </div>
            <button className="addpf" onClick={() => { resetForm(); setModal(true); }}><Plus size={14} /> Add your business</button>
            {customProfiles.some((c) => c.id === activeId) && (
              <>
                <button className="removepf" onClick={() => openEdit(activeId)} title="Edit this business">
                  <PenLine size={13} /> Edit
                </button>
                <button className="removepf" onClick={() => removeProfile(activeId)} title="Remove this business">
                  <X size={13} /> Remove
                </button>
              </>
            )}
          </div>

          {/* ───── OVERVIEW ───── */}
          {tab === "overview" && (
            <main className="main" key={"ov" + activeId}>
              <div className="h-app">Threat overview</div>
              <div className="sub-app">What is moving through government, scored for <b>{board.label}</b> - {board.meta}.</div>

              <div className="ov">
                <aside className="rail">
                  <div className="rail-h">Surfaced threats <span className="ct">{railList.length}</span></div>
                  <div className="rail-list">
                    {railList.map((it) => (
                      <button
                        key={it.id}
                        className={"titem" + (activeItem && activeItem.id === it.id ? " on" : "")}
                        onClick={() => setSpotId(spotId === it.id ? null : it.id)}
                        aria-pressed={activeItem?.id === it.id}
                      >
                        <span className="ti mono">
                          {it.identifier}
                          {it.isNew && <span className="chip new">NEW</span>}
                        </span>
                        <span className="tt">{it.title}</span>
                      </button>
                    ))}
                    {railList.length === 0 && (
                      <div className="empty">
                        {selState
                          ? `No ${stateName(selState)} or federal items surfaced for this business yet.`
                          : "Nothing surfaced for this business yet. Switch profiles to compare."}
                      </div>
                    )}
                  </div>
                  <div className="rail-f">
                    Watching Congress, the Federal Register, and state legislatures. Scored live against this business as items move.
                  </div>
                </aside>

                <div className="maparea">
                  <div className="map-top">
                    <span className="pill"><MapPin size={11} /> {selState ? `Focused: ${stateName(selState)} + Federal` : "All jurisdictions"}</span>
                    <span className="map-fed">Federal: {federalCount} flagged</span>
                    {hoverState ? (
                      (() => {
                        const h = board.mapByState[hoverState.toLowerCase()];
                        return (
                          <span className="map-hover-info">
                            <b>{stateName(hoverState)}</b>
                            {h
                              ? ` · ${h.count} threat${h.count > 1 ? "s" : ""} · top: ${h.top}`
                              : " · no state items yet"}
                          </span>
                        );
                      })()
                    ) : selState ? (
                      <button className="clearfocus" onClick={() => { setSelState(null); setSpotId(null); }} title="Show all jurisdictions again">
                        Clear focus <X size={12} />
                      </button>
                    ) : (
                      <span className="map-hint">Hover a state to preview · click to focus</span>
                    )}
                  </div>
                  <div className="mapstage">
                    <USMap
                      map={board.mapByState}
                      selected={selState}
                      active={activeItem?.postal ? activeItem.postal.toUpperCase() : null}
                      onSelect={(s) => { setSelState(s); setSpotId(null); setCycleIdx(0); }}
                      onHover={setHoverState}
                      home={homeStates(profile.jurisdictions)}
                    />
                    <MapCards
                      item={activeItem}
                      counter={`${railList.length ? ((railList.findIndex((i) => i.id === activeItem?.id) + railList.length) % railList.length) + 1 : 0} / ${railList.length}`}
                      cycleMs={CYCLE_MS}
                      cycleKey={`${activeItem?.id ?? "none"}-${cycleIdx}`}
                      paused={cyclePaused || hoverPause}
                      onTogglePause={() => {
                        if (spotId) { setSpotId(null); setAutoCycle(true); }
                        else setAutoCycle((v) => !v);
                      }}
                      onHoverChange={setHoverPause}
                    />
                  </div>
                  <div className="legend">
                    <span><span className="sw" style={{ background: "var(--map-hot)" }} />High threat</span>
                    <span><span className="sw" style={{ background: "var(--map-mid)" }} />Watching</span>
                    <span><span className="sw" style={{ background: "var(--map-empty)" }} />Clear</span>
                    <span><span className="sw" style={{ border: "1.5px dashed var(--critical)", background: "transparent" }} />Home state</span>
                  </div>
                  <div className="map-help">
                    {Object.keys(board.mapByState).length === 0
                      ? `No state-level threats surfaced for ${board.label} yet - states shade as scored items land. Watching ${
                          data.stateCoverage.length === 0
                            ? "the federal docket"
                            : data.stateCoverage.length > 8
                              ? `${data.stateCoverage.length} state legislatures plus the full federal docket`
                              : `${data.stateCoverage.join(", ")} plus the full federal docket`
                        }.`
                      : "Click any state to see what affects a business there: that state's bills plus all federal rules. Click again to clear."}
                  </div>
                </div>
              </div>
            </main>
          )}

          {/* ───── ACTIVITY (live feed) ───── */}
          {tab === "activity" && (
            <main className="main" key={"ac" + activeId}>
              <div className="h-app">Recent activity</div>
              <div className="sub-app">
                The latest moves on bills and rules relevant to <b>{board.label}</b>, newest first
                {selState ? ` (focused on ${stateName(selState)} + Federal)` : ""}.
              </div>
              <div className="feedstream">
                {activityList.length === 0 && (
                  <div className="empty">No dated activity for this business yet.</div>
                )}
                {activityList.map((it, i) => {
                  const b = band(it.score);
                  const showDate = i === 0 || activityList[i - 1].lastActionDate !== it.lastActionDate;
                  return (
                    <Fragment key={it.id}>
                      {showDate && <div className="feed-date">{activityDate(it.lastActionDate)}</div>}
                      <button className="event" onClick={() => setOpenId(it.id)} aria-label={`Open memo: ${it.title}`}>
                        <span className="ev-dot" style={{ background: `var(--${b.key})` }} />
                        <div className="ev-body">
                          <div className="ev-top">
                            <span className="mono ev-id">{it.identifier}</span>
                            <span className="ev-src">{displaySource(it)}</span>
                            {it.isNew && <span className="chip new">NEW</span>}
                            <span className="ev-sev" style={sevStyle(it.score >= 3 ? b.key : "safe")}>{b.label} · {it.score}/5</span>
                          </div>
                          <div className="ev-title">{it.title}</div>
                          <div className="ev-action">{it.provenance || it.status || STAGE_LABEL[it.stage] || "Update recorded"}</div>
                        </div>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
            </main>
          )}

          {/* ───── SEARCH (agentic) ───── */}
          {tab === "search" && (
            <main className="main" key={"se" + activeId}>
              <AgentSearch profileId={activeId} profileLabel={profile?.label ?? "your business"} />
            </main>
          )}

          {/* ───── SETTINGS (bring-your-own-key) ───── */}
          {tab === "settings" && <SettingsPanel onToast={(m) => toast(m)} />}

          {/* ───── BILLS ───── */}
          {tab === "bills" && (
            <main className="main" key={"bl" + activeId}>
              <div className="h-app">Bills & rules</div>
              <div className="sub-app">Every monitored item, scored for <b>{board.label}</b>. Click any card for the memo.</div>

              <div className="stats">
                {([
                  ["critical", nC, "Critical"],
                  ["high", nH, "High"],
                  ["monitor", nM, "Monitoring"],
                  ["safe", nT, "Tracked"],
                ] as [string, number, string][]).map(([k, n, l]) => (
                  <div className="stat" key={k}>
                    <span className="rail2" style={{ background: `var(--${k})` }} />
                    <div className="n" style={{ color: `var(--${k})` }}>{String(n).padStart(2, "0")}</div>
                    <div className="l">{l}</div>
                  </div>
                ))}
              </div>

              <div className="searchbar">
                <Search size={15} color="var(--muted)" />
                <input placeholder="Search rules…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rules" />
              </div>

              <div className="seclabel" style={{ marginTop: 18 }}>
                Relevant to you<span className="ln" />
                <button className="export-btn" onClick={exportCsv} disabled={feed.length === 0} title="Download this board as CSV">
                  <Download size={13} /> Export CSV
                </button>
              </div>
              <div className="feed">
                {feed.map((r, i) => {
                  const b = band(r.score);
                  const isTracked = tracked.has(r.id);
                  return (
                    <div
                      className="card"
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      style={{ animationDelay: `${i * 45}ms`, cursor: "pointer" }}
                      onClick={() => setOpenId(r.id)}
                      onKeyDown={(e) => {
                        // Only open from the card itself - not from the nested Track button.
                        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                          e.preventDefault();
                          setOpenId(r.id);
                        }
                      }}
                      aria-label={`Open memo: ${r.title}`}
                    >
                      <div className="stamp" style={sevStyle(b.key)}>
                        <span className="sc">{r.score}</span><span className="sl">{b.label}</span>
                      </div>
                      <div className="cbody">
                        <div className="ctitle">{r.title}</div>
                        {(() => {
                          const sum = r.memo?.what_it_does?.replace(/^per the source:\s*/i, "").trim() || r.summary?.trim();
                          return sum ? <div className="csummary">{sum}</div> : null;
                        })()}
                        <div className="cmeta">
                          <span className="chip id">{r.identifier}</span>
                          <span className="chip">{displaySource(r)}</span>
                          {r.categories.map((c) => <span className="chip" key={c}>{categoryLabel(c)}</span>)}
                          {(STAGE_LABEL[r.stage] ?? r.stage) && (
                            <span className="chip" style={{ background: "var(--surface)", color: "var(--muted)" }}>{STAGE_LABEL[r.stage] ?? r.stage}</span>
                          )}
                          {r.isNew && <span className="chip new">NEW</span>}
                          {r.sample && <span className="chip sample">SAMPLE</span>}
                        </div>
                        <div className="why">{r.justification}</div>
                      </div>
                      <div className="cright">
                        <button
                          type="button"
                          className={"trackbtn" + (isTracked ? " on" : "")}
                          onClick={(e) => { e.stopPropagation(); toggleMark("tracked", r.id, "Tracking " + r.identifier); }}
                        >
                          {isTracked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                          {isTracked ? "Tracked" : "Track"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {feed.length === 0 && <div className="empty">Nothing matches that search for {board.label}.</div>}
              </div>

              {lowFeed.length > 0 && (
                <>
                  <button className="filtbtn" onClick={() => setShowLow((v) => !v)}>
                    <ChevronDown size={15} style={{ transform: showLow ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                    {showLow ? "Hide" : "Show"} {lowFeed.length} filtered out as low relevance to {board.label}
                  </button>
                  {showLow && lowFeed.map((r) => (
                    <div className="filtrow" key={r.id}>
                      <span className="mono" style={{ fontSize: 13 }}>{r.score}</span>
                      <span className="t">{r.title}</span>
                      <span className="chip">{r.chip}</span>
                      <span style={{ fontSize: 11.5 }}>{r.justification}</span>
                    </div>
                  ))}
                </>
              )}
            </main>
          )}

          {/* ───── ALERTS ───── */}
          {tab === "alerts" && (
            <main className="main" key={"al" + activeId}>
              <div className="h-app">Alerts & review</div>
              <div className="sub-app">Drafted memos wait here - nothing goes out until you approve it.</div>

              <div className="seclabel" style={{ marginTop: 20 }}>Review queue<span className="ln" /></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {surfaced.map((r, i) => (
                  <div className="revrow" key={r.id} style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="rt">
                      <div className="rtt">{r.title}</div>
                      <div className="rtm">{r.identifier} · {displaySource(r)}</div>
                    </div>
                    <span className={"state " + (approved.has(r.id) ? "appr" : "draft")}>
                      {approved.has(r.id) ? "Approved" : "Draft"}
                    </span>
                    <button
                      className="approve"
                      onClick={() => toggleMark("approved", r.id, "Memo approved - will appear in the next digest")}
                    >
                      {approved.has(r.id) ? "Undo" : "Approve memo"}
                    </button>
                  </div>
                ))}
                {surfaced.length === 0 && <div className="empty">No memos to review for {board.label}.</div>}
              </div>

              <div className="digest">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Mail size={17} color="var(--ink-soft)" />
                  <b style={{ fontSize: 15 }}>Digest</b>
                  <span className="chip" style={{ marginLeft: "auto" }}>
                    {approvedCards.length} approved item{approvedCards.length === 1 ? "" : "s"} queued
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6, margin: "10px 0 0" }}>
                  Approved memos and status changes on tracked items, delivered on your schedule. Without SMTP configured, digests print to the server console.
                </p>
                <div className="seg" role="group" aria-label="Digest frequency">
                  {(["daily", "weekly"] as const).map((f) => (
                    <button key={f} className={freq === f ? "on" : ""} onClick={() => setFreq(f)}>
                      {f === "daily" ? "Daily" : "Weekly"}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <button className="approve" onClick={sendDigest} disabled={sendingDigest} style={sendingDigest ? { opacity: 0.6, cursor: "default" } : undefined}>
                    {sendingDigest ? "Sending…" : "Send test digest"}
                  </button>
                </div>
              </div>
            </main>
          )}

          {/* ───── TRACKER ───── */}
          {tab === "tracker" && (
            <main className="main" key={"tr" + activeId}>
              <div className="h-app">Tracker</div>
              <div className="sub-app">Items you follow, by where they are in the process.</div>
              <div className="board">
                {STAGE_ORDER.map((stage) => {
                  const itemsIn = surfaced.filter((r) => tracked.has(r.id) && r.stage === stage);
                  return (
                    <div className="col" key={stage}>
                      <div className="coltop">{STAGE_LABEL[stage] ?? stage}<span className="ct">{itemsIn.length}</span></div>
                      {itemsIn.map((r) => (
                        <button className="bcard" key={r.id} onClick={() => setOpenId(r.id)}>
                          <div className="bt">{r.title}</div>
                          <div className="bm">
                            {r.identifier}
                            {disposition[r.id] && <span className={"disp-badge " + disposition[r.id]} style={{ marginLeft: 7 }}>{disposition[r.id]}</span>}
                          </div>
                        </button>
                      ))}
                      {itemsIn.length === 0 && <div className="empty" style={{ padding: "16px 4px" }}>-</div>}
                    </div>
                  );
                })}
              </div>
              {tracked.size === 0 && <div className="empty">Track a rule from Bills and it lands here on its stage.</div>}
            </main>
          )}
        </div>

        {/* memo slide-over */}
        {open && openBand && OpenBandIcon && (
          <>
            <div className="scrim" onClick={() => setOpenId(null)} />
            <aside className="panel" role="dialog" aria-modal="true" aria-label="Regulation memo">
              <div className="phead">
                <button className="pclose" onClick={() => setOpenId(null)} aria-label="Close"><X size={16} /></button>
                <div className="cmeta" style={{ marginTop: 0, marginBottom: 11 }}>
                  <span className="chip id">{open.identifier}</span>
                  <span className="chip">{displaySource(open)}</span>
                  <span className="chip"><MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />{displayJurisdiction(open.postal)}</span>
                  {open.sample && <span className="chip sample">SAMPLE</span>}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", lineHeight: 1.32 }}>{open.title}</div>
                <div className="brief-issuer">
                  {issuingBody(open)}
                  {open.sponsors.length > 0 && <span> · Sponsored by {open.sponsors.join(", ")}</span>}
                </div>
                <div style={{ marginTop: 12 }}>
                  <span className="pill" style={sevStyle(openBand.key)}>
                    <OpenBandIcon size={14} /> {openBand.label} · {open.score}/5 for {board.label}
                  </span>
                </div>
              </div>
              <div className="pbody">
                {/* PLAIN ENGLISH - what the rule actually requires, in reader terms */}
                <div className="memo">
                  <h4><BookOpen size={12} /> Plain English</h4>
                  <p>{plainEnglishSummary(open)}</p>
                </div>

                {/* WHY THIS MATTERS - the per-you analysis, with the risk pill */}
                <div className="memo">
                  <h4>
                    Why this matters to you
                    <span className="risk-pill" style={sevStyle(open.score >= 3 ? openBand.key : "safe")}>
                      <OpenBandIcon size={11} /> {openBand.label} risk
                    </span>
                  </h4>
                  <p>{open.justification}</p>
                </div>

                {/* IMPACT + TIMELINE - two-up, like Fed10. Impact is a LABELED estimate
                    or an honest "qualitative only" (never a fabricated figure, spec §15). */}
                <div className="brief-grid">
                  <div className="brief-stat">
                    <span className="bs-label">Impact</span>
                    <span className="bs-value">
                      {open.memo?.impact_estimate ?? "Qualitative - not quantified for this item"}
                    </span>
                  </div>
                  <div className="brief-stat">
                    <span className="bs-label">Timeline</span>
                    <span className="bs-value">
                      {open.commentCloseDate && commentDaysLeft !== null && commentDaysLeft >= 0
                        ? `Comment closes ${open.commentCloseDate} · ${commentDaysLeft} day${commentDaysLeft === 1 ? "" : "s"} left`
                        : open.lastActionDate
                          ? `Last action ${open.lastActionDate}`
                          : STAGE_LABEL[open.stage] ?? "Monitoring"}
                    </span>
                  </div>
                </div>

                {/* AFFECTED AREAS - taxonomy tags */}
                {open.categories.length > 0 && (
                  <div className="memo">
                    <h4>Affected areas</h4>
                    <div className="brief-tags">
                      {open.categories.map((c) => (
                        <span className="chip" key={c}>{categoryLabel(c)}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="memo"><h4>Status &amp; next steps</h4><p>{open.memo?.status_and_next_steps ?? open.status}</p></div>

                {(open.commentCloseDate || open.lastActionDate) && (
                  <div className="memo">
                    <h4><Clock size={12} /> Key dates</h4>
                    <ul className="keydates">
                      {open.commentCloseDate && (
                        <li className={commentDaysLeft !== null && commentDaysLeft >= 0 && commentDaysLeft <= 30 ? "urgent" : ""}>
                          <b>Public comment window</b>
                          <span>
                            closes {open.commentCloseDate}
                            {commentDaysLeft !== null && commentDaysLeft >= 0
                              ? ` · ${commentDaysLeft} day${commentDaysLeft === 1 ? "" : "s"} left to comment`
                              : commentDaysLeft !== null
                                ? " · window closed"
                                : ""}
                          </span>
                        </li>
                      )}
                      {open.lastActionDate && (
                        <li>
                          <b>Last updated</b>
                          <span>{open.lastActionDate}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="memo">
                  <h4>Recommended action</h4>
                  <span className="pill" style={{ marginTop: 2 }}>
                    {ACTION_LABEL[open.memo?.recommended_action ?? "monitor"] ?? "Monitor"}
                    {open.memo?.recommended_action_note ? " · " + open.memo.recommended_action_note : ""}
                  </span>
                  {open.actionUrl && (
                    <a className="source-link" href={open.actionUrl} target="_blank" rel="noreferrer">
                      {open.commentCloseDate
                        ? "Read the full rule and submit a comment on the official portal"
                        : "Read the full text on the official source"}
                      <ExternalLink size={12} />
                    </a>
                  )}
                  <div className="draft-row">
                    <button className="draft-btn" onClick={makeDraft} disabled={drafting}>
                      <PenLine size={13} /> {drafting ? "Drafting…" : draft?.itemId === open.id ? "Re-draft comment letter" : "Draft a comment letter"}
                    </button>
                  </div>
                  {draft?.itemId === open.id && (
                    <div className="draft-box">
                      <div className="draft-head">
                        <span className="chip sample">DRAFT · {draft.engine === "claude" ? "written by Claude" : "template"}</span>
                        <button
                          className="link-btn"
                          onClick={() => { void navigator.clipboard?.writeText(draft.text); toast("Draft copied"); }}
                        >
                          <Copy size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />Copy
                        </button>
                      </div>
                      {draft.notice && <div className="draft-notice">{draft.notice}</div>}
                      <textarea className="draft-text" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={12} />
                      <div className="fb-hint">Review, edit, and submit it yourself on the official portal - RedLine never sends anything for you.</div>
                    </div>
                  )}
                </div>

                {/* HISTORICAL PRECEDENT - sourced provenance framing, not invented */}
                {open.provenance && (
                  <div className="memo">
                    <h4><History size={12} /> Historical precedent</h4>
                    <p>{open.provenance}</p>
                  </div>
                )}

                {/* SOURCE TEXT - the actual text with code-verified passages highlighted */}
                {(() => {
                  const src = (open.fullText || open.summary || "").trim();
                  if (!src) return null;
                  const verified = (open.memo?.citations ?? []).filter((c) => c.verified).map((c) => c.snippet);
                  const excerpt = src.length > 2200 ? src.slice(0, 2200).trimEnd() + "…" : src;
                  return (
                    <div className="memo">
                      <h4>
                        <FileText size={12} /> Source text
                        {verified.length > 0 && <span className="hl-note">cited passages highlighted</span>}
                      </h4>
                      <div className="clause-text">
                        {verified.length > 0 ? highlightSource(excerpt, verified) : excerpt}
                      </div>
                    </div>
                  );
                })()}

                {/* AFFECTED SECTIONS & SOURCES - code-verified citations only */}
                <div className="memo">
                  <h4><Scale size={12} /> Affected sections &amp; sources</h4>
                  {open.memo && open.memo.citations.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {open.memo.citations.map((c, i) => (
                        <div className="cite" key={i}>
                          <Quote size={14} color="var(--monitor)" style={{ flex: "0 0 auto", marginTop: 2 }} />
                          <div>
                            <div className="loc">{c.locator ?? open.identifier}</div>
                            <div className="sn">{c.snippet}</div>
                            {c.verified === true && (
                              <span className="ok"><CheckCircle2 size={11} /> citation verified in source</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: "var(--muted)" }}>
                      A cited memo is drafted for higher-priority items. The official source linked above has the full, authoritative text.
                    </p>
                  )}
                </div>

                {/* YOUR POSITION - support / oppose / monitor (a stance, not a prediction) */}
                <div className="memo fb-block">
                  <h4>Your position</h4>
                  <div className="fb-row">
                    {DISPOSITIONS.map((d) => (
                      <button
                        key={d.id}
                        className={"disp-btn disp-" + d.id + (disposition[open.id] === d.id ? " on" : "")}
                        onClick={() => setDisposition(open.id, d.id)}
                        aria-pressed={disposition[open.id] === d.id}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <div className="fb-hint">Tagging a stance tracks the item and labels it on the Tracker.</div>
                </div>

                {/* RELEVANCE FEEDBACK - 👍/👎 trains the filter (spec §8 feedback loop) */}
                <div className="memo fb-block">
                  <h4>Was this relevant to {board.label}?</h4>
                  <div className="fb-row">
                    <button
                      className={"fb-btn" + (feedback[open.id] === "relevant" ? " up" : "")}
                      onClick={() => sendFeedback(open.id, "relevant")}
                      aria-pressed={feedback[open.id] === "relevant"}
                    >
                      <ThumbsUp size={14} /> Relevant
                    </button>
                    <button
                      className={"fb-btn" + (feedback[open.id] === "not_relevant" ? " down" : "")}
                      onClick={() => sendFeedback(open.id, "not_relevant")}
                      aria-pressed={feedback[open.id] === "not_relevant"}
                    >
                      <ThumbsDown size={14} /> Not relevant
                    </button>
                  </div>
                  <div className="fb-hint">Your feedback tunes what RedLine surfaces for you.</div>
                </div>
              </div>
              <div className="pfoot">
                <button
                  className={"pbtn" + (tracked.has(open.id) ? " done" : "")}
                  onClick={() => toggleMark("tracked", open.id, "Tracking " + open.identifier)}
                >
                  {tracked.has(open.id) ? <><BookmarkCheck size={15} /> Tracked</> : <><Bookmark size={15} /> Track</>}
                </button>
                <button
                  className={"pbtn primary" + (approved.has(open.id) ? " done" : "")}
                  onClick={() => toggleMark("approved", open.id, "Memo approved - will appear in the next digest")}
                >
                  {approved.has(open.id) ? <><CheckCircle2 size={15} /> Approved</> : <><ClipboardCheck size={15} /> Approve memo</>}
                </button>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* "Add your business" / "Edit business" modal */}
      {modal && (
        <div className="modal">
          <div className="scrim" onClick={() => { setModal(false); resetForm(); }} />
          <div className="mbox" role="dialog" aria-modal="true" aria-label={editingId ? "Edit business" : "Add your business"} style={{ position: "relative", zIndex: 95 }}>
            <div className="mhead">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {editingId ? <PenLine size={18} color="var(--accent)" /> : <Sparkles size={18} color="var(--accent)" />}
                <b style={{ fontSize: 17 }}>{editingId ? "Edit business" : "Add your business"}</b>
                <button className="pclose" style={{ position: "static", marginLeft: "auto" }} onClick={() => { setModal(false); resetForm(); }} aria-label="Close"><X size={15} /></button>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0", lineHeight: 1.55 }}>
                {editingId
                  ? "Update what you do and where - the engine re-scores the board against live bills and rules the moment you save."
                  : "Tell us what you do and where. Every answer becomes a real scoring input - the engine re-scores the board against live bills and rules the moment you save. Only the name and one business type are required; the rest sharpens what surfaces."}
              </p>
            </div>
            <div className="mbody">
              <div className="field">
                <label htmlFor="bizname">Business name</label>
                <input id="bizname" type="text" placeholder="e.g. Driftwood Coffee Co." value={fName} onChange={(e) => setFName(e.target.value)} />
              </div>
              <div className="field">
                <label>What do you do? <span className="opt-hint">pick all that apply</span></label>
                <div className="optgrid">
                  {BIZ_TYPES.map((b) => {
                    const Ic = TYPE_ICON[b.id] ?? Sparkles;
                    return (
                      <button key={b.id} className={"opt" + (fTypes.includes(b.id) ? " on" : "")} onClick={() => flip(fTypes, setFTypes, b.id)} aria-pressed={fTypes.includes(b.id)}>
                        <Ic size={14} /> {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field">
                <label htmlFor="emp">Roughly how many people work here? <span className="opt-hint">optional</span></label>
                <input id="emp" type="number" min={0} inputMode="numeric" placeholder="e.g. 25" value={fEmployees} onChange={(e) => setFEmployees(e.target.value)} />
              </div>

              {ATTR_SECTIONS.map((sec) => (
                <div className="field" key={sec.title}>
                  <label>{sec.title}</label>
                  <div className="optgrid">
                    {sec.toggles.map((t) => (
                      <button
                        key={t.id}
                        className={"opt" + (fAttrs[t.id] ? " on" : "")}
                        onClick={() => setFAttrs((x) => ({ ...x, [t.id]: !x[t.id] }))}
                        aria-pressed={!!fAttrs[t.id]}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="field">
                <label>Food operations</label>
                <div className="optgrid">
                  <button
                    className={"opt" + (fAttrs.serves_food || fTypes.includes("food") ? " on" : "")}
                    onClick={() => setFAttrs((x) => ({ ...x, serves_food: !x.serves_food }))}
                    aria-pressed={!!fAttrs.serves_food}
                  >
                    We handle food in any way
                  </button>
                </div>
                {(fAttrs.serves_food || fTypes.includes("food")) && (
                  <div className="optgrid" style={{ marginTop: 8 }}>
                    {FOOD_ROLES.map((r) => (
                      <button
                        key={r.id}
                        className={"opt" + (fFoodRole === r.id ? " on" : "")}
                        onClick={() => setFFoodRole(fFoodRole === r.id ? "" : r.id)}
                        aria-pressed={fFoodRole === r.id}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="field">
                <label>Where do you operate? <span className="opt-hint">federal is always on</span></label>
                <div className="optgrid"><span className="opt fed-fixed">US Federal (always on)</span></div>
                <input
                  className="state-search"
                  type="text"
                  placeholder="Filter states by name or code…"
                  value={stateQuery}
                  onChange={(e) => setStateQuery(e.target.value)}
                  aria-label="Filter states"
                />
                <div className="optgrid statesgrid">
                  {STATE_OPTIONS.filter(
                    (s) =>
                      !stateQuery ||
                      s.includes(stateQuery.toUpperCase()) ||
                      (POSTAL_TO_NAME[s.toLowerCase()] ?? "").toLowerCase().includes(stateQuery.toLowerCase()),
                  ).map((s) => (
                    <button
                      key={s}
                      className={"opt state-opt" + (fStates.includes(s) ? " on" : "")}
                      onClick={() => flip(fStates, setFStates, s)}
                      title={POSTAL_TO_NAME[s.toLowerCase()] ?? s}
                      aria-pressed={fStates.includes(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {fStates.filter((s) => s !== "US").length > 0 && (
                  <div className="state-count">
                    {fStates.filter((s) => s !== "US").length} state{fStates.filter((s) => s !== "US").length > 1 ? "s" : ""} selected
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="bizctx">
                  In your own words - what helps, hurts, or blindsides you? <span className="opt-hint">optional, but this is the secret sauce</span>
                </label>
                <textarea
                  id="bizctx"
                  className="ctx-input"
                  rows={3}
                  maxLength={600}
                  placeholder="e.g. We rely on auto-renewing annual contracts and store 5 years of customer analytics. Anything touching subscription cancellation rules, data-retention limits, or contractor classification is existential for us."
                  value={fContext}
                  onChange={(e) => setFContext(e.target.value)}
                />
                <div className="set-hint">
                  Your words feed the scoring directly - RedLine weighs every bill against this, so the board is built around <b>you</b>.
                  <span style={{ marginLeft: "auto" }}>{fContext.length}/600</span>
                </div>
              </div>

              <button
                className="btn"
                style={{ justifyContent: "center", ...(creating ? { opacity: 0.6, cursor: "default" } : null) }}
                onClick={createProfile}
                disabled={creating}
              >
                {creating ? "Scoring your board…" : editingId ? <>Save changes &amp; re-score <ArrowRight size={15} /></> : <>Create profile &amp; score against live data <ArrowRight size={15} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
