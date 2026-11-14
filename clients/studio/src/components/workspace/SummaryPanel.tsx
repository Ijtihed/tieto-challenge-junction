"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";
import { LEVEL_META } from "@/lib/aggregate";
import { KIND_META } from "@/components/canvas/nodeKindMeta";
import type { NodeKind } from "@/lib/types";

interface WorkspaceInfo { languages?: string[]; extractors?: string[]; samplers?: { id: string; available: boolean }[]; }
interface IncrementalInfo { edbSize?: number; idbSize?: number; rulesCount?: number; version?: number; evalCount?: number; }

export default function SummaryPanel() {
  const summary = useStore((s) => s.summary);
  const readme = useStore((s) => s.readme);
  const workingGraph = useStore((s) => s.workingGraph);
  const level = useStore((s) => s.level);
  const setLevel = useStore((s) => s.setLevel);
  const repo = useStore((s) => s.repo);
  const emitToast = useStore((s) => s.emitToast);

  const [wsInfo, setWsInfo] = useState<WorkspaceInfo | null>(null);
  const [incrStats, setIncrStats] = useState<IncrementalInfo | null>(null);
  const [importState, setImportState] = useState<"idle" | "loading" | "done" | "error">("idle");
  useEffect(() => {
    if (!repo.rootPath) return;
    fetchApi("/api/workspace/describe", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json()).then(setWsInfo).catch(() => {});
    fetchApi("/api/samplers/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json()).then((d) => setWsInfo((prev) => ({ ...prev, samplers: d.samplers ?? [] }))).catch(() => {});
    fetchApi("/api/incremental/stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json()).then(setIncrStats).catch(() => {});
  }, [repo.rootPath]);

  const kindCounts: Record<string, number> = {};
  for (const n of workingGraph.nodes) {
    kindCounts[n.kind] = (kindCounts[n.kind] ?? 0) + 1;
  }
  const kinds = Object.keys(kindCounts) as NodeKind[];

  return (
    <div className="p-5 space-y-6">
      <div>
        <p className="text-xs font-medium text-neutral-500 mb-2">
          Overview
        </p>
        <p className="text-sm text-neutral-200 leading-relaxed">{summary}</p>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500 mb-3">
          Depth
        </p>
        <div className="space-y-2">
          {([1, 2, 3] as const).map((l) => {
            const meta = LEVEL_META[l];
            const active = l === level;
            return (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 border transition-colors text-left ${
                  active
                    ? "border-white bg-neutral-950"
                    : "border-outline-variant hover:border-neutral-600"
                }`}
              >
                <div>
                  <p
                    className={`text-sm ${
                      active ? "text-white" : "text-neutral-300"
                    }`}
                  >
                    L{l} · {meta.label}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {meta.subtitle}
                  </p>
                </div>
                {active && (
                  <span className="text-xs text-schema-accent">
                    showing
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-on-surface-muted leading-relaxed">
          Click any node to drill in one level. Switch levels here or in the top bar.
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500 mb-3">
          Stats
        </p>
        <div className="space-y-1.5">
          {kinds.map((k) => {
            const meta = (KIND_META[k] ?? KIND_META.utility!);
            return (
              <div
                key={k}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-outline-variant/40"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full ${meta.accent}`} />
                  <span className={`text-sm ${meta.color}`}>
                    {meta.label}
                  </span>
                </div>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {kindCounts[k]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {wsInfo && (
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-2">
            Workspace
          </p>
          {wsInfo.languages && wsInfo.languages.length > 0 && (
            <p className="text-xs text-neutral-300 mb-1">
              Languages: {wsInfo.languages.join(", ")}
            </p>
          )}
          {wsInfo.extractors && wsInfo.extractors.length > 0 && (
            <p className="text-xs text-neutral-400 mb-1">
              Extractors: {wsInfo.extractors.join(", ")}
            </p>
          )}
          {wsInfo.samplers && wsInfo.samplers.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-neutral-500 mb-1">Samplers</p>
              {wsInfo.samplers.map((s) => (
                <p key={s.id} className={`font-[JetBrains_Mono] text-xs ${s.available ? "text-phase-pass" : "text-neutral-600"}`}>
                  {s.available ? "✓" : "✗"} {s.id}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {incrStats && (
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-2">
            Datalog engine
          </p>
          <div className="grid grid-cols-2 gap-px bg-outline-variant/60 border border-outline-variant/60">
            {incrStats.edbSize != null && (
              <div className="bg-surface px-3 py-2">
                <p className="text-xs text-neutral-500">EDB facts</p>
                <p className="text-sm text-white mt-0.5 tabular-nums">{incrStats.edbSize}</p>
              </div>
            )}
            {incrStats.idbSize != null && (
              <div className="bg-surface px-3 py-2">
                <p className="text-xs text-neutral-500">IDB derived</p>
                <p className="text-sm text-white mt-0.5 tabular-nums">{incrStats.idbSize}</p>
              </div>
            )}
            {incrStats.rulesCount != null && (
              <div className="bg-surface px-3 py-2">
                <p className="text-xs text-neutral-500">Rules loaded</p>
                <p className="text-sm text-white mt-0.5 tabular-nums">{incrStats.rulesCount}</p>
              </div>
            )}
            {incrStats.evalCount != null && (
              <div className="bg-surface px-3 py-2">
                <p className="text-xs text-neutral-500">Evaluations</p>
                <p className="text-sm text-white mt-0.5 tabular-nums">{incrStats.evalCount}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {repo.rootPath && (
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-2">
            Import external index
          </p>
          <ScipImportForm
            state={importState}
            onImport={async (filePath: string) => {
              setImportState("loading");
              try {
                const res = await fetchApi("/api/graph/import", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ format: "scip", filePath }),
                });
                if (res.ok) {
                  setImportState("done");
                  emitToast("SCIP index imported");
                } else {
                  setImportState("error");
                  emitToast("import failed");
                }
              } catch {
                setImportState("error");
                emitToast("import failed");
              }
            }}
          />
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-neutral-500 mb-2">
          README
        </p>
        <pre className="font-[JetBrains_Mono] text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap border border-outline-variant/60 bg-surface-dim p-3">
          {readme}
        </pre>
      </div>
    </div>
  );
}

function ScipImportForm({
  state,
  onImport,
}: {
  state: "idle" | "loading" | "done" | "error";
  onImport: (filePath: string) => void;
}) {
  const [filePath, setFilePath] = useState("");
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={filePath}
        onChange={(e) => setFilePath(e.target.value)}
        placeholder="path/to/index.scip"
        className="flex-1 bg-transparent border border-outline px-2 py-1.5 font-[JetBrains_Mono] text-xs text-white placeholder:text-on-surface-faint outline-none focus:border-schema-accent"
      />
      <button
        onClick={() => filePath.trim() && onImport(filePath.trim())}
        disabled={state === "loading" || !filePath.trim()}
        className="px-3 py-1.5 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors disabled:opacity-40"
      >
        {state === "loading" ? "Importing..." : state === "done" ? "Done ✓" : "Import SCIP"}
      </button>
    </div>
  );
}
