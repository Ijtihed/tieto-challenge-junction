"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/state/store";
import SchemaLogo from "@/components/SchemaLogo";

const SHORTCUTS: { key: string; desc: string }[] = [
  { key: "1 / 2 / 3", desc: "switch depth: architecture / modules / detail" },
  { key: "⌘/Ctrl K", desc: "fuzzy search nodes by name / route / file" },
  { key: "/", desc: "focus the command bar" },
  { key: "i", desc: "open problems" },
  { key: "r", desc: "open rules" },
  { key: "h", desc: "open history" },
  { key: "s", desc: "open snapshots" },
  { key: "a", desc: "open overview" },
  { key: "⌫", desc: "go to home (top of drill path)" },
  { key: "⌘/Ctrl Z", desc: "undo last applied plan" },
  { key: "esc", desc: "discard plan / clear selection / close panels" },
  { key: "?", desc: "toggle this cheat sheet" },
];

export default function CheatSheet() {
  const open = useStore((s) => s.cheatSheetOpen);
  const setOpen = useStore((s) => s.setCheatSheetOpen);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Focus trap + return: capture the trigger when opening, restore on close.
  useEffect(() => {
    if (!open) return;
    triggerRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    return () => {
      const el = triggerRef.current;
      if (el && typeof el.focus === "function") {
        // Defer to next frame so the overlay has fully unmounted.
        requestAnimationFrame(() => el.focus());
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="cheat-sheet"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface/80 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="border border-outline-variant bg-surface w-[92vw] max-w-md p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <span className="flex items-center gap-2">
            <SchemaLogo className="w-5 h-5" />
            <h3 className="text-base text-white">Shortcuts</h3>
          </span>
          <button
            onClick={() => setOpen(false)}
            className="text-on-surface-muted hover:text-white text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between gap-4 py-2.5 border-b border-outline-variant/60 last:border-0"
            >
              <kbd className="font-[JetBrains_Mono] text-xs text-white border border-outline px-2.5 py-1 min-w-[3rem] text-center tracking-wider">
                {s.key}
              </kbd>
              <span className="text-sm text-on-surface-variant leading-relaxed text-right">
                {s.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
