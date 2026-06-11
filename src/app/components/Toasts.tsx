"use client";

/** Toast stack + hook (ported from the reference prototype). */
import { useCallback, useState } from "react";
import { CheckCircle2 } from "lucide-react";

interface Toast {
  id: string;
  msg: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((msg: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);
  return { toasts, toast };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <CheckCircle2 size={15} color="#7BE3C3" />
          {t.msg}
        </div>
      ))}
    </div>
  );
}
