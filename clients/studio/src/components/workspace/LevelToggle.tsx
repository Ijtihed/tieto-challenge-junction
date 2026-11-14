"use client";

// Per `research/25-95-percent-and-leveling.md` §7 + Step 3 of the
// launch plan: each level shows its user question as the subtitle
// (What is this codebase? / What are the main areas? / Where is
// X? / How does X work?). The L1 label is archetype-aware: it
// renders `Services` for web apps, `Modules` for libraries,
// `Commands` for CLI tools, etc. — driven by
// `useStore().workspaceArchetype`.

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/state/store";
import { LEVEL_META, type Level } from "@/lib/aggregate";
import { archetypeL1Label } from "@/lib/archetype";

const VISIBLE_LEVELS: Level[] = [1, 2, 3];

const KEYBINDING: Record<Level, string> = {
  0: "",
  1: "⌘1",
  2: "⌘2",
  3: "⌘3",
};

export default function LevelToggle() {
  const level = useStore((s) => s.level);
  const goToLevel = useStore((s) => s.goToLevel);
  const archetype = useStore((s) => s.workspaceArchetype);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const displayLevel = VISIBLE_LEVELS.includes(level as Level) ? level : 1;
  const baseMeta = LEVEL_META[displayLevel as Level];
  // Archetype-aware L1 label per doc 25 §8.
  const labelFor = (l: Level): string =>
    l === 1 ? archetypeL1Label(archetype?.primary) : LEVEL_META[l].label;
  const meta = { ...baseMeta, label: labelFor(displayLevel as Level) };

  return (
    <div ref={ref} className="relative" data-tutorial="level-toggle">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-md border border-outline-variant bg-surface/60 text-sm text-white hover:bg-surface-container/70 hover:border-outline transition-colors"
        title={`View: ${meta.label}`}
      >
        <span
          className="material-symbols-outlined text-[14px] leading-none text-on-surface-faint"
          style={{ fontVariationSettings: "'wght' 200, 'opsz' 20" }}
        >
          {meta.icon}
        </span>
        <span className="text-sm">{meta.label}</span>
        <span
          className="material-symbols-outlined text-[12px] text-on-surface-faint ml-0.5"
          style={{ fontVariationSettings: "'wght' 200, 'opsz' 20" }}
        >
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-outline-variant bg-surface-dim/95 backdrop-blur shadow-xl z-[200] py-1">
          {VISIBLE_LEVELS.map((l) => {
            const active = level === l;
            const m = LEVEL_META[l];
            const label = labelFor(l);
            return (
              <button
                key={l}
                data-tutorial-level={l}
                data-testid={`level-toggle-${m.id}`}
                onClick={() => { goToLevel(l); setOpen(false); }}
                className={`
                  mx-1 rounded-md text-left px-2.5 py-2 flex items-start gap-2.5 transition-colors w-[calc(100%-8px)]
                  ${active ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white hover:bg-white/[0.06]"}
                `}
              >
                <span
                  className={`material-symbols-outlined text-[15px] leading-none mt-0.5 shrink-0 ${active ? "text-schema-accent" : "text-on-surface-faint"}`}
                  style={{ fontVariationSettings: "'wght' 200, 'opsz' 20" }}
                >
                  {m.icon}
                </span>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-medium leading-none">{label}</span>
                  <span className="text-xs text-on-surface-faint mt-1.5 leading-snug">
                    {m.subtitle}
                  </span>
                </div>
                <kbd className="shrink-0 mt-0.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-[JetBrains_Mono] bg-surface-container border border-outline text-on-surface-muted rounded min-w-[32px]">
                  {KEYBINDING[l]}
                </kbd>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
