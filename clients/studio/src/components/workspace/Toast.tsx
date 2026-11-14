"use client";

import { useStore } from "@/state/store";

export default function Toast() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-stack"
      role="status"
      aria-live="polite"
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[110] flex flex-col-reverse items-center gap-2 pointer-events-none"
    >
      {toasts.map((t) => {
        const lower = t.msg.toLowerCase();
        const isError = lower.includes("failed") || lower.includes("error");
        const isSuccess =
          lower.includes("done") ||
          lower.includes("saved") ||
          lower.includes("restored") ||
          lower.includes("copied") ||
          lower.includes("written");
        const borderClass = isError
          ? "border-violation/40"
          : isSuccess
            ? "border-phase-pass/40"
            : "border-outline";
        return (
          <div
            key={t.id}
            data-testid="toast"
            data-toast-msg={t.msg}
            className={`border ${borderClass} bg-surface/95 backdrop-blur px-6 py-3 shadow-lg`}
          >
            <p className="text-sm text-white">
              {t.msg}
            </p>
          </div>
        );
      })}
    </div>
  );
}
