"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";

interface Skill { id: string; title: string; description: string; type: string; uri: string; }
interface CanonHit { uri: string; title: string; paradigm: string; score: number; excerpt: string; }

export default function WisdomPanel() {
  const emitToast = useStore((s) => s.emitToast);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsError, setSkillsError] = useState(false);
  const [canonQuery, setCanonQuery] = useState("");
  const [canonHits, setCanonHits] = useState<CanonHit[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<{ uri: string; body: string; metadata: Record<string, unknown> } | null>(null);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<"skills" | "canon">("skills");

  const loadSkills = useCallback(() => {
    setSkillsError(false);
    fetchApi("/api/skills/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => setSkillsError(true));
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const searchCanon = useCallback(async () => {
    if (!canonQuery.trim()) return;
    setSearching(true); setSelectedDoc(null);
    try {
      const res = await fetchApi("/api/canon/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: canonQuery, k: 10 }),
      });
      const data = await res.json();
      setCanonHits(data.hits ?? []);
    } catch (err) {
      emitToast(`search failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setSearching(false); }
  }, [canonQuery, emitToast]);

  const readDoc = useCallback(async (uri: string) => {
    try {
      const res = await fetchApi("/api/canon/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri }),
      });
      const data = await res.json();
      setSelectedDoc({ uri, body: data.body ?? "", metadata: data.metadata ?? {} });
    } catch (err) {
      emitToast(`read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [emitToast]);

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-outline-variant/60">
        {(["skills", "canon"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-4 py-2.5 text-sm transition-colors relative ${
              tab === t ? "text-white" : "text-on-surface-muted hover:text-white"
            }`}>
            {t === "skills" ? `Skills · ${skills.length}` : "Canon"}
            {tab === t && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-schema-accent" />}
          </button>
        ))}
      </div>

      {tab === "skills" && (
        <div className="p-4 space-y-2">
          {skills.length === 0 ? (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[24px] text-on-surface-faint leading-none mb-2 inline-block">
                {skillsError ? "error_outline" : "school"}
              </span>
              <p className="text-sm text-on-surface-variant">
                {skillsError ? "Could not load skills" : "No skills loaded"}
              </p>
              {skillsError && (
                <button onClick={loadSkills} className="mt-2 text-xs text-schema-accent hover:underline">
                  Retry
                </button>
              )}
            </div>
          ) : (
            skills.map((s) => (
              <div key={s.id} className="border border-outline-variant/60 p-3">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <p className="text-sm text-white">{s.title}</p>
                  <span className="text-xs text-on-surface-faint border border-outline-variant px-1.5 py-0.5">{s.type}</span>
                </div>
                <p className="text-xs text-on-surface-muted leading-relaxed">{s.description}</p>
                <p className="mt-1 font-[JetBrains_Mono] text-xs text-on-surface-faint">{s.uri}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "canon" && (
        <div className="flex flex-col">
          <div className="px-4 py-3 border-b border-outline-variant/60">
            <div className="flex gap-2">
              <input
                value={canonQuery} onChange={(e) => setCanonQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchCanon(); }}
                placeholder="search canon: OTP, CQRS, Jepsen..."
                className="flex-1 bg-surface border border-outline-variant px-3 py-2 text-sm text-white placeholder:text-on-surface-faint outline-none focus:border-neutral-500 transition-colors"
              />
              <button onClick={searchCanon} disabled={searching || !canonQuery.trim()}
                className="px-3 py-2 rounded-md border border-schema-accent/40 text-xs text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 transition-colors disabled:opacity-30">
                {searching ? "..." : "Search"}
              </button>
            </div>
          </div>

          {selectedDoc ? (
            <div className="p-4">
              <button onClick={() => setSelectedDoc(null)} className="text-xs text-on-surface-muted hover:text-white mb-3">Back</button>
              <pre className="font-[JetBrains_Mono] text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap break-words bg-surface-dim border border-outline-variant/60 p-3 max-h-[500px] overflow-y-auto">
                {selectedDoc.body}
              </pre>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {canonHits.length === 0 && !searching && (
                <div className="text-center py-6">
                  <p className="text-xs text-on-surface-muted">
                    Search the canon knowledge base for architectural wisdom.
                  </p>
                </div>
              )}
              {canonHits.map((h) => (
                <button key={h.uri} onClick={() => readDoc(h.uri)}
                  className="w-full text-left border border-outline-variant/60 hover:border-neutral-600 p-3 transition-colors">
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <p className="text-sm text-white truncate">{h.title}</p>
                    <span className="text-xs text-schema-accent shrink-0">{h.paradigm}</span>
                  </div>
                  <p className="text-xs text-on-surface-muted leading-relaxed line-clamp-2">{h.excerpt}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
