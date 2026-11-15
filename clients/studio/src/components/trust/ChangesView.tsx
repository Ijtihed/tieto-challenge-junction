"use client";

import { useEffect, useMemo, useState } from "react";
import { callTool } from "@/mcp-client";

interface FileDiff { path: string; status: string; added: number; deleted: number; generated: boolean; patch: string | null }
interface DiffData { runId: string; baseSha: string; headSha: string; branch: string; prUrl?: string; files: FileDiff[] }

type Line = { kind: "hunk" | "add" | "del" | "ctx"; text: string; oldNo?: number; newNo?: number };

function parsePatch(patch: string): Line[] {
  const out: Line[] = [];
  let o = 0, n = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw);
      o = Number(m?.[1] ?? 0); n = Number(m?.[2] ?? 0);
      out.push({ kind: "hunk", text: raw.replace(/^@@[^@]*@@ ?/, "") });
    } else if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1), newNo: n++ });
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1), oldNo: o++ });
    else if (raw.startsWith(" ")) out.push({ kind: "ctx", text: raw.slice(1), oldNo: o++, newNo: n++ });
  }
  return out;
}

const STATUS: Record<string, string> = { A: "text-phase-pass", M: "text-phase-applying", D: "text-phase-fail", R: "text-kind-service" };

function Patch({ patch }: { patch: string }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  return (
    <div className="font-[JetBrains_Mono] text-[12.5px] leading-[1.7] min-w-max pb-6">
      {lines.map((l, i) => l.kind === "hunk" ? (
        <div key={i} className="px-5 py-1.5 my-1 text-on-surface-faint bg-[var(--ui-fill)] sticky top-0 backdrop-blur">{l.text || "next change"}</div>
      ) : (
        <div key={i} className={`flex ${l.kind === "add" ? "bg-phase-pass/[0.09]" : l.kind === "del" ? "bg-phase-fail/[0.09]" : ""}`}>
          <span className="w-12 shrink-0 text-right pr-2 text-on-surface-faint/70 select-none tabular-nums">{l.oldNo ?? ""}</span>
          <span className="w-12 shrink-0 text-right pr-2 text-on-surface-faint/70 select-none tabular-nums">{l.newNo ?? ""}</span>
          <span className={`w-6 shrink-0 text-center select-none ${l.kind === "add" ? "text-phase-pass" : l.kind === "del" ? "text-phase-fail" : "text-on-surface-faint"}`}>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
          <span className={`whitespace-pre pr-6 ${l.kind === "add" ? "text-[#c9f5dd]" : l.kind === "del" ? "text-[#ffd0cc]" : "text-on-surface-variant"}`}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Files the agent changed, with a full line-by-line diff of the selected file. */
export default function ChangesView({ runId, compact = false }: { runId: string; compact?: boolean }) {
  const [data, setData] = useState<DiffData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [showGenerated, setShowGenerated] = useState(false);

  useEffect(() => {
    setData(null); setError(null);
    callTool<DiffData>("agent.diff", { runId })
      .then((d) => { setData(d); setSel(d.files.find((f) => !f.generated)?.path ?? d.files[0]?.path ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [runId]);

  useEffect(() => {
    if (!data || !sel) return;
    const f = data.files.find((x) => x.path === sel);
    if (f && f.patch === null && extra[sel] === undefined) {
      callTool<{ patch: string }>("agent.diff", { runId, path: sel }).then((r) => setExtra((x) => ({ ...x, [sel]: r.patch.split("\n").slice(4).join("\n") }))).catch(() => undefined);
    }
  }, [data, sel, runId, extra]);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <p className="ui-title">The diff could not be loaded</p>
        <p className="ui-body mt-2 max-w-md">The server could not read the agent's commit.</p>
        <p className="ui-meta ui-code mt-3 text-phase-fail">{error}</p>
      </div>
    );
  }
  if (!data) return <div className="p-6 space-y-2" aria-busy="true">{[70, 55, 80, 40].map((w) => <div key={w} className="h-3 rounded-full bg-[var(--ui-fill)] schema-skeleton" style={{ width: `${w}%` }} />)}</div>;

  const authored = data.files.filter((f) => !f.generated);
  const generated = data.files.filter((f) => f.generated);
  const added = data.files.reduce((n, f) => n + f.added, 0);
  const deleted = data.files.reduce((n, f) => n + f.deleted, 0);
  const current = data.files.find((f) => f.path === sel);
  const patch = current ? current.patch ?? extra[current.path] ?? null : null;

  const row = (f: FileDiff) => (
    <button key={f.path} onClick={() => setSel(f.path)}
      aria-pressed={sel === f.path}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-left text-[0.8125rem] transition-colors ${sel === f.path ? "bg-[var(--ui-fill-hover)] text-on-surface" : "text-on-surface-variant hover:bg-[var(--ui-fill)]"}`}>
      <span className={`ui-code w-3 ${STATUS[f.status] ?? ""}`}>{f.status}</span>
      <span className="truncate flex-1" title={f.path}>{f.path.split("/").pop()}</span>
      <span className="ui-code text-phase-pass tabular-nums">+{f.added}</span>
      <span className={`ui-code tabular-nums ${f.deleted ? "text-phase-fail" : "text-on-surface-faint"}`}>−{f.deleted}</span>
    </button>
  );

  return (
    <div className={`flex ${compact ? "h-[520px]" : "h-full"} min-h-0`}>
      <div className="w-[300px] shrink-0 overflow-y-auto px-3 pb-4">
        <div className="px-3 pt-1 pb-3">
          <p className="text-[0.875rem] font-medium text-on-surface tabular-nums">
            {data.files.length} {data.files.length === 1 ? "file" : "files"} <span className="text-phase-pass ml-1.5">+{added}</span> <span className={deleted ? "text-phase-fail" : "text-on-surface-faint"}>−{deleted}</span>
          </p>
          <p className="ui-meta ui-code mt-1">{data.baseSha.slice(0, 8)}..{data.headSha.slice(0, 8)}</p>
        </div>
        <div className="space-y-0.5">{authored.map(row)}</div>
        {generated.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowGenerated(!showGenerated)} aria-expanded={showGenerated} className="w-full flex items-center gap-1.5 px-3 py-2 text-left ui-meta hover:text-on-surface transition-colors">
              <span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${showGenerated ? "rotate-90" : ""}`}>chevron_right</span>
              {generated.length} generated or snapshot files
            </button>
            {showGenerated && <div className="ui-fade space-y-0.5">{generated.map(row)}</div>}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col m-3 mt-0 ml-0 rounded-[14px] bg-surface overflow-hidden">
        {current && (
          <div className="px-5 h-11 shrink-0 flex items-center gap-3 border-b border-[var(--ui-hairline)]">
            <span className="ui-code text-on-surface-variant truncate">{current.path}</span>
            <span className="ml-auto ui-code text-phase-pass tabular-nums">+{current.added}</span>
            <span className={`ui-code tabular-nums ${current.deleted ? "text-phase-fail" : "text-on-surface-faint"}`}>−{current.deleted}</span>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {patch === null ? <div className="p-6 ui-meta">Loading the diff</div> : patch.trim() ? <Patch patch={patch} /> : <div className="p-6 ui-meta">No text changes. This file is binary or was only renamed.</div>}
        </div>
      </div>
    </div>
  );
}
