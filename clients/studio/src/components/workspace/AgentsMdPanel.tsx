"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";

interface WriteResult { writtenPath: string; charsAdded: number; charsRemoved: number; }

export default function AgentsMdPanel() {
  const repo = useStore((s) => s.repo);
  const emitToast = useStore((s) => s.emitToast);
  const [schemaSection, setSchemaSection] = useState<string | null>(null);
  const [userSection, setUserSection] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [writing, setWriting] = useState(false);

  const load = useCallback(async () => {
    if (!repo.rootPath) return;
    setLoading(true);
    try {
      const res = await fetchApi("/api/agents-md/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: repo.rootPath, includeUserSection: true }),
      });
      const data = await res.json();
      setExists(data.exists ?? !!data.schemaSection);
      setSchemaSection(data.schemaSection ?? null);
      setUserSection(data.userSection ?? null);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, [repo.rootPath]);

  useEffect(() => { load(); }, [load]);

  const handleWrite = useCallback(async () => {
    if (!repo.rootPath) return;
    setWriting(true);
    try {
      const res = await fetchApi("/api/agents-md/write-facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: repo.rootPath }),
      });
      const data = await res.json() as WriteResult;
      setWriteResult(data);
      emitToast(`facts written to ${data.writtenPath}`);
      load();
    } catch (err) {
      emitToast(`write failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setWriting(false); }
  }, [repo.rootPath, emitToast, load]);

  if (!repo.rootPath) {
    return (
      <div className="p-6 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-faint leading-none mb-3 inline-block">smart_toy</span>
        <p className="text-sm text-on-surface-variant">Open a real repo to use AGENTS.md</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-5 py-4 border-b border-outline-variant/60">
        <p className="text-xs font-medium text-on-surface-muted mb-2">AGENTS.md round-trip</p>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Schema writes computed architectural facts into a fenced section of your AGENTS.md. AI agents read this section to understand the codebase.
        </p>
      </div>

      {loading && (
        <div className="px-5 py-6 text-center">
          <p className="text-xs text-on-surface-muted">Loading...</p>
        </div>
      )}

      {!loading && !exists && (
        <div className="px-5 py-6 text-center">
          <span className="material-symbols-outlined text-[24px] text-on-surface-faint leading-none mb-2 inline-block">note_add</span>
          <p className="text-sm text-on-surface-variant">No AGENTS.md found</p>
          <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
            Click "Write facts" below to create one.
          </p>
        </div>
      )}

      {schemaSection && (
        <div className="px-5 py-3 border-b border-outline-variant/60">
          <p className="text-xs font-medium text-schema-accent mb-2">
            Schema section · {schemaSection.length} chars
          </p>
          <pre className="font-[JetBrains_Mono] text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap break-words bg-surface-dim border border-outline-variant/60 p-3 max-h-[300px] overflow-y-auto">
            {schemaSection}
          </pre>
        </div>
      )}

      {userSection && (
        <div className="px-5 py-3 border-b border-outline-variant/60">
          <button onClick={() => setShowUser((v) => !v)} className="text-xs text-on-surface-muted hover:text-white transition-colors">
            {showUser ? "Hide" : "Show"} user section ({userSection.length} chars)
          </button>
          {showUser && (
            <pre className="mt-2 font-[JetBrains_Mono] text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap break-words bg-surface-dim border border-outline-variant/60 p-3 max-h-[200px] overflow-y-auto">
              {userSection}
            </pre>
          )}
        </div>
      )}

      <div className="px-5 py-4">
        <button
          onClick={handleWrite} disabled={writing}
          className="w-full px-3 py-2.5 rounded-md border border-schema-accent/40 text-xs text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 transition-colors disabled:opacity-50"
        >
          {writing ? "Writing..." : "Write facts"}
        </button>
        {writeResult && (
          <p className="mt-2 text-xs text-phase-pass">
            ✓ {writeResult.writtenPath} · +{writeResult.charsAdded} / -{writeResult.charsRemoved} chars
          </p>
        )}
        <button onClick={load} className="mt-2 text-xs text-on-surface-muted hover:text-white transition-colors">
          Refresh
        </button>
      </div>
    </div>
  );
}
