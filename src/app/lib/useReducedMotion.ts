"use client";

/**
 * Reactive prefers-reduced-motion: unlike a one-shot matchMedia() read, this
 * re-renders when the user toggles the OS setting mid-session, so JS-driven
 * intervals (card auto-cycle, process carousel) actually stop - the global
 * CSS kill switch only covers animations/transitions, not timers.
 */
import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
