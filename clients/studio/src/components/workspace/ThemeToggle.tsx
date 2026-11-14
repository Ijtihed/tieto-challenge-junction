"use client";

import { useStore } from "@/state/store";

const OPTIONS = [
  { value: "dark" as const, icon: "dark_mode", label: "Dark" },
  { value: "system" as const, icon: "computer", label: "System" },
  { value: "light" as const, icon: "light_mode", label: "Light" },
];

export default function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  return (
    <div
      data-testid="theme-toggle"
      role="radiogroup"
      aria-label="Theme"
      className="flex flex-col border-t border-outline-variant pt-2"
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            data-testid={`theme-${opt.value}`}
            data-active={active ? "true" : "false"}
            onClick={() => setTheme(opt.value)}
            title={`${opt.label} theme`}
            className={`
              w-full py-1.5 flex items-center justify-center transition-colors
              ${active ? "bg-white text-black" : "text-on-surface-faint hover:text-on-surface-variant"}
            `}
          >
            <span className="material-symbols-outlined text-[16px] leading-none">
              {opt.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}
