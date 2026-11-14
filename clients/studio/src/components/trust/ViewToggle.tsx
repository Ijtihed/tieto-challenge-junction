"use client";

import { useTrust } from "@/state/trust";

export default function ViewToggle() {
  const view = useTrust((s) => s.view);
  const setView = useTrust((s) => s.setView);
  const btn = (id: "map" | "evidence", label: string, icon: string) => (
    <button
      onClick={() => setView(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border ${view === id ? "border-schema-accent text-white bg-surface-container-high" : "border-outline-variant text-on-surface-muted hover:text-white"}`}
    >
      <span className="material-symbols-outlined text-[15px]">{icon}</span>{label}
    </button>
  );
  return (
    <div className="absolute top-3 right-4 z-20 flex bg-surface-dim">
      {btn("map", "Repo map", "hub")}
      {btn("evidence", "Test evidence", "account_tree")}
    </div>
  );
}
