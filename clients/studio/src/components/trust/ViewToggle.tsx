"use client";

import { useTrust } from "@/state/trust";

export default function ViewToggle() {
  const view = useTrust((s) => s.view);
  const setView = useTrust((s) => s.setView);
  const btn = (id: "map" | "evidence", label: string, icon: string) => (
    <button onClick={() => setView(id)} aria-pressed={view === id} className="!inline-flex items-center gap-1.5">
      <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'wght' 300" }}>{icon}</span>{label}
    </button>
  );
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 ui-seg !bg-[var(--ui-glass)] backdrop-blur-xl" role="group" aria-label="Canvas view">
      {btn("map", "Repo map", "hub")}
      {btn("evidence", "Test evidence", "account_tree")}
    </div>
  );
}
