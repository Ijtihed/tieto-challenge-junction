"use client";

import { useState, useCallback } from "react";
import { useStore } from "@/state/store";

const THEMES = [
  { value: "dark" as const, icon: "dark_mode", label: "Dark" },
  { value: "system" as const, icon: "computer", label: "System" },
  { value: "light" as const, icon: "light_mode", label: "Light" },
];

interface ToggleItem {
  label: string;
  description: string;
  get: (s: ReturnType<typeof useStore.getState>) => boolean;
  set: (s: ReturnType<typeof useStore.getState>, v: boolean) => void;
}

const DISPLAY_TOGGLES: ToggleItem[] = [
  {
    label: "Show imports",
    description: "Include import / require edges",
    get: (s) => s.showImports,
    set: (s, v) => s.setShowImports(v),
  },
  {
    label: "Show coverage",
    description: "Overlay test coverage data on nodes",
    get: (s) => s.showCoverage,
    set: (s, v) => s.setShowCoverage(v),
  },
];

export default function SettingsPanel() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  return (
    <div className="flex flex-col overflow-y-auto py-2">

      {/* Theme — segmented control */}
      <Section label="Theme">
        <div className="grid grid-cols-3 gap-1.5">
          {THEMES.map((opt) => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                title={opt.label}
                className={`
                  flex flex-col items-center gap-1.5 py-2.5 rounded-md border text-xs transition-colors
                  ${active
                    ? "border-white/20 bg-white/[0.08] text-white"
                    : "border-outline-variant text-on-surface-faint hover:text-on-surface-variant hover:bg-white/[0.03]"
                  }
                `}
              >
                <span
                  className="material-symbols-outlined text-[17px] leading-none"
                  style={{ fontVariationSettings: "'wght' 200, 'opsz' 20" }}
                >
                  {opt.icon}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* API keys for LLM planning */}
      <Section label="AI Planning (BYOK)">
        <div className="space-y-3">
          <ApiKeyField
            label="Anthropic"
            storageKey="schema:anthropicKey"
            placeholder="sk-ant-..."
          />
          <ApiKeyField
            label="OpenAI"
            storageKey="schema:openaiKey"
            placeholder="sk-..."
          />
          <ApiKeyField
            label="Gemini"
            storageKey="schema:geminiKey"
            placeholder="AI..."
          />
          <p className="text-[10px] text-on-surface-faint leading-relaxed mt-1">
            Keys are stored in your browser only and sent to the vendor API
            when you submit a plan. Schema never stores or logs them.
          </p>
        </div>
      </Section>

      {/* Display toggles */}
      <Section label="Display">
        <div className="flex flex-col">
          {DISPLAY_TOGGLES.map((t, i) => (
            <ToggleRow key={t.label} item={t} divider={i < DISPLAY_TOGGLES.length - 1} />
          ))}
        </div>
      </Section>

      <p className="px-5 text-[11px] text-on-surface-faint leading-relaxed mt-2">
        Switch between Architecture, Modules, and Functions views using the
        dropdown in the top bar (or <kbd className="font-[JetBrains_Mono] text-[10px] px-1 py-0.5 rounded bg-surface-container border border-outline-variant">⌘1</kbd>–<kbd className="font-[JetBrains_Mono] text-[10px] px-1 py-0.5 rounded bg-surface-container border border-outline-variant">⌘3</kbd>).
      </p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-5 pt-3 pb-4 border-b border-outline-variant/60 last:border-0">
      <p className="text-[10px] font-[JetBrains_Mono] tracking-[0.18em] uppercase text-on-surface-faint mb-3">
        {label}
      </p>
      {children}
    </section>
  );
}

function ToggleRow({ item, divider }: { item: ToggleItem; divider: boolean }) {
  const value = useStore(item.get);
  return (
    <button
      type="button"
      onClick={() => item.set(useStore.getState(), !value)}
      className={`flex items-center justify-between gap-3 py-2.5 text-left ${
        divider ? "border-b border-outline-variant/30" : ""
      }`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-sm text-on-surface-variant leading-tight">{item.label}</span>
        <span className="text-xs text-on-surface-faint mt-0.5 leading-snug">{item.description}</span>
      </div>
      <Toggle checked={value} />
    </button>
  );
}

function ApiKeyField({ label, storageKey, placeholder }: { label: string; storageKey: string; placeholder: string }) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; }
  });
  const [saved, setSaved] = useState(false);

  const save = useCallback(() => {
    try {
      if (value.trim()) {
        localStorage.setItem(storageKey, value.trim());
      } else {
        localStorage.removeItem(storageKey);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {}
  }, [value, storageKey]);

  return (
    <div>
      <label className="text-xs text-on-surface-variant block mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder={placeholder}
          autoComplete="off"
          className="flex-1 h-8 px-2.5 bg-surface-container border border-outline-variant rounded font-[JetBrains_Mono] text-xs text-white placeholder:text-on-surface-faint outline-none focus:border-on-surface-variant transition-colors"
        />
        {saved && (
          <span className="flex items-center text-[11px] text-green-400 shrink-0">saved</span>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      className={`relative w-[34px] h-[18px] shrink-0 rounded-full transition-colors ${
        checked ? "bg-schema-accent" : "bg-surface-container border border-outline-variant"
      }`}
    >
      <span
        className={`absolute top-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform ${
          checked ? "translate-x-[17px]" : "translate-x-[2px]"
        }`}
      />
    </span>
  );
}
