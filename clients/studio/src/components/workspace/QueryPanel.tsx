"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";

interface BundledQuery { id: string; name: string; description: string; datalog: string; }
interface QueryResult { columns: string[]; rows: string[][]; count: number; truncated: boolean; }

export default function QueryPanel() {
  const selectNode = useStore((s) => s.selectNode);
  const focusOnIds = useStore((s) => s.focusOnIds);
  const emitToast = useStore((s) => s.emitToast);

  const [bundled, setBundled] = useState<BundledQuery[]>([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi("/api/graph/list-queries", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => setBundled(d.queries ?? []))
      .catch(() => {});
  }, []);

  const run = useCallback(async (datalog?: string, bundledId?: string) => {
    setRunning(true); setError(null); setResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (bundledId) body.bundledQueryId = bundledId;
      else body.query = datalog ?? query;
      body.limit = 100;
      const res = await fetchApi("/api/graph/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      emitToast(`query failed: ${msg}`);
    } finally { setRunning(false); }
  }, [query, emitToast]);

  return (
    <div className="flex flex-col">
      {/* Bundled queries */}
      {bundled.length > 0 && (
        <div className="px-5 py-3 border-b border-outline-variant/60">
          <p className="text-xs font-medium text-on-surface-muted mb-2">Queries</p>
          <div className="space-y-1.5">
            {bundled.map((q) => (
              <button
                key={q.id}
                onClick={() => { setQuery(q.datalog ?? ""); run(q.datalog, q.id); }}
                className="w-full text-left px-3 py-2 border border-outline-variant/60 hover:border-neutral-600 transition-colors"
              >
                <p className="text-sm text-white">{q.name}</p>
                <p className="text-xs text-on-surface-muted mt-0.5">{q.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom query */}
      <div className="px-5 py-3 border-b border-outline-variant/60">
        <p className="text-xs font-medium text-on-surface-muted mb-2">Custom query</p>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={4}
          placeholder="calls(X, Y), kind(X, service), kind(Y, route_handler)."
          className="w-full bg-surface border border-outline-variant px-3 py-2 font-[JetBrains_Mono] text-sm text-white placeholder:text-on-surface-faint outline-none focus:border-neutral-500 transition-colors resize-none leading-relaxed"
        />
        <button
          onClick={() => run()} disabled={running || !(query ?? "").trim()}
          className="mt-2 w-full px-3 py-2 rounded-md border border-schema-accent/40 text-xs text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 transition-colors disabled:opacity-30"
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 border-b border-outline-variant/60">
          <p className="font-[JetBrains_Mono] text-xs text-phase-fail leading-relaxed">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="px-5 py-3">
          <p className="text-xs font-medium text-on-surface-muted mb-2">
            {result.count} result{result.count !== 1 ? "s" : ""}{result.truncated ? " (truncated)" : ""}
          </p>
          {result.columns.length > 0 && (
            <div className="overflow-x-auto border border-outline-variant/60">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-outline-variant/60">
                    {result.columns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-[JetBrains_Mono] text-xs text-on-surface-muted">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-outline-variant/40 hover:bg-neutral-950 cursor-pointer"
                      onClick={() => {
                        const nodeId = row[0];
                        if (nodeId) { selectNode(nodeId); focusOnIds([nodeId]); }
                      }}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 font-[JetBrains_Mono] text-xs text-neutral-300 truncate max-w-[200px]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!result && !error && bundled.length === 0 && (
        <div className="px-5 py-8 text-center">
          <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">database</span>
          <p className="text-sm text-on-surface-variant">Datalog queries</p>
          <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
            Run Datalog queries against the architecture graph. Find cycles, dependency patterns, and structural issues.
          </p>
        </div>
      )}
    </div>
  );
}
