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
    <div className="font-[JetBrains_Mono] text-[12px] leading-[1.55]">
      {lines.map((l, i) => l.kind === "hunk" ? (
        <div key={i} className="px-3 py-1 bg-kind-service/10 text-kind-service/80 border-y border-outline-variant/40 sticky top-0">⋯ {l.text}</div>
      ) : (
        <div key={i} className={`flex ${l.kind === "add" ? "bg-phase-pass/10" : l.kind === "del" ? "bg-phase-fail/10" : ""}`}>
          <span className="w-12 shrink-0 text-right pr-2 text-on-surface-faint select-none">{l.oldNo ?? ""}</span>
          <span className="w-12 shrink-0 text-right pr-2 text-on-surface-faint select-none">{l.newNo ?? ""}</span>
          <span className={`w-5 shrink-0 text-center select-none ${l.kind === "add" ? "text-phase-pass" : l.kind === "del" ? "text-phase-fail" : "text-on-surface-faint"}`}>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
          <span className={`whitespace-pre pr-4 ${l.kind === "add" ? "text-[#bbf7d0]" : l.kind === "del" ? "text-[#fecaca]" : "text-neutral-300"}`}>{l.text}</span>
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

  if (error) return <div className="p-6 text-xs text-phase-fail">{error}</div>;
  if (!data) return <div className="p-6 text-xs text-on-surface-muted">Loading changes…</div>;

  const authored = data.files.filter((f) => !f.generated);
  const generated = data.files.filter((f) => f.generated);
  const added = data.files.reduce((n, f) => n + f.added, 0);
  const deleted = data.files.reduce((n, f) => n + f.deleted, 0);
  const current = data.files.find((f) => f.path === sel);
  const patch = current ? current.patch ?? extra[current.path] ?? null : null;

  const row = (f: FileDiff) => (
    <button key={f.path} onClick={() => setSel(f.path)}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] border-l-2 ${sel === f.path ? "border-schema-accent bg-surface-container-high text-white" : "border-transparent text-neutral-300 hover:bg-surface-container"}`}>
      <span className={`font-[JetBrains_Mono] w-3 ${STATUS[f.status] ?? ""}`}>{f.status}</span>
      <span className="truncate flex-1" title={f.path}>{f.path.split("/").pop()}</span>
      <span className="font-[JetBrains_Mono] text-[11px] text-phase-pass">+{f.added}</span>
      <span className="font-[JetBrains_Mono] text-[11px] text-phase-fail">−{f.deleted}</span>
    </button>
  );

  return (
    <div className={`flex ${compact ? "h-[520px]" : "h-full"} min-h-0 border border-outline-variant bg-surface`}>
      <div className="w-[300px] shrink-0 border-r border-outline-variant overflow-y-auto">
        <div className="px-3 py-2.5 border-b border-outline-variant text-xs text-neutral-200">
          {data.files.length} files · <span className="text-phase-pass">+{added}</span> <span className="text-phase-fail">−{deleted}</span>
          <div className="text-[10.5px] text-on-surface-muted font-[JetBrains_Mono] mt-0.5">{data.baseSha.slice(0, 8)}..{data.headSha.slice(0, 8)}</div>
        </div>
        <div className="py-1">{authored.map(row)}</div>
        {generated.length > 0 && (
          <div className="border-t border-outline-variant/60">
            <button onClick={() => setShowGenerated(!showGenerated)} className="w-full px-3 py-2 text-left text-[11px] text-on-surface-muted hover:text-white">
              {showGenerated ? "▾" : "▸"} {generated.length} generated / snapshot files
            </button>
            {showGenerated && <div className="pb-1">{generated.map(row)}</div>}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {current && (
          <div className="px-4 py-2.5 border-b border-outline-variant flex items-center gap-3 text-xs">
            <span className="font-[JetBrains_Mono] text-white truncate">{current.path}</span>
            <span className="ml-auto font-[JetBrains_Mono] text-phase-pass">+{current.added}</span>
            <span className="font-[JetBrains_Mono] text-phase-fail">−{current.deleted}</span>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {patch === null ? <div className="p-6 text-xs text-on-surface-muted">Loading diff…</div> : patch.trim() ? <Patch patch={patch} /> : <div className="p-6 text-xs text-on-surface-muted">No textual changes (binary or rename only).</div>}
        </div>
      </div>
    </div>
  );
}
