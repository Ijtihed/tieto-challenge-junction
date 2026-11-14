"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";
import { fuzzyRank } from "@/lib/fuzzy";
import { ACTIONS, type ActionItem } from "@/lib/actions";
import { KIND_META } from "@/components/canvas/nodeKindMeta";
import type { GraphNode } from "@/lib/types";

type Row =
  | { kind: "action"; item: ActionItem }
  | { kind: "node"; item: GraphNode };

export default function SearchOverlay() {
  const open = useStore((s) => s.searchOpen);
  const setOpen = useStore((s) => s.setSearchOpen);
  const workingGraph = useStore((s) => s.workingGraph);
  const goToLevel = useStore((s) => s.goToLevel);
  const selectNode = useStore((s) => s.selectNode);

  const repoRootPath = useStore((s) => s.repo.rootPath ?? null);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [serverResults, setServerResults] = useState<GraphNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleActions = useMemo(() => {
    const state = useStore.getState();
    return ACTIONS.filter((a) => (a.visible ? a.visible(state) : true));
    // We deliberately do NOT subscribe to every state change for visibility —
    // open + state.* on each render is enough. The palette opens fresh.
  }, []);

  useEffect(() => {
    if (!repoRootPath || !query.trim() || query.trim().length < 2) {
      setServerResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchApi("/api/graph/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 20 }),
      })
        .then((r) => r.json())
        .then((d) => {
          const hits = (d.results ?? d.nodes ?? []).map((n: any) => ({
            id: n.id,
            name: n.name,
            kind: n.kind ?? "utility",
            file: n.filePath ?? n.file ?? "",
            meta: n.meta,
          }));
          setServerResults(hits);
        })
        .catch(() => setServerResults([]));
    }, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, repoRootPath]);

  const rows: Row[] = useMemo(() => {
    const trimmed = query.trim();

    const actionRanked = fuzzyRank<ActionItem>(trimmed, visibleActions, (a) => [
      a.label,
      ...a.tags,
      a.id,
    ]);
    const nodeRanked = fuzzyRank<GraphNode>(trimmed, workingGraph.nodes, (n) => [
      n.name,
      n.file,
      n.meta?.httpPath ? `${n.meta.httpMethod} ${n.meta.httpPath}` : "",
    ]);

    const out: Row[] = [];
    for (const a of actionRanked) out.push({ kind: "action", item: a.item });
    for (const n of nodeRanked) out.push({ kind: "node", item: n.item });

    // Merge server-side search results (deduplicated against local results)
    const localIds = new Set(out.filter((r) => r.kind === "node").map((r) => (r.item as GraphNode).id));
    for (const sr of serverResults) {
      if (!localIds.has(sr.id)) {
        out.push({ kind: "node", item: sr });
        localIds.add(sr.id);
      }
    }

    return out.slice(0, 60);
  }, [query, visibleActions, workingGraph.nodes, serverResults]);

  useEffect(() => {
    if (!open) return;
    setActiveIdx(0);
    setQuery("");
    // Capture the previously-focused element so we can restore on close.
    triggerRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      clearTimeout(t);
      const el = triggerRef.current;
      if (el && typeof el.focus === "function") {
        requestAnimationFrame(() => el.focus());
      }
    };
  }, [open]);

  const pickAction = useCallback(
    (action: ActionItem) => {
      const state = useStore.getState();
      action.run(state);
      setOpen(false);
    },
    [setOpen],
  );

  const pickNode = useCallback(
    (node: GraphNode) => {
      goToLevel(3);
      selectNode(node.id);
      setOpen(false);
    },
    [goToLevel, selectNode, setOpen],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        setActiveIdx((i) => Math.min(rows.length - 1, i + 1));
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        setActiveIdx((i) => Math.max(0, i - 1));
        e.preventDefault();
      } else if (e.key === "Enter") {
        const r = rows[activeIdx];
        if (!r) return;
        if (r.kind === "action") pickAction(r.item);
        else pickNode(r.item);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, activeIdx, setOpen, pickAction, pickNode]);

  if (!open) return null;

  // Group breakdown for the section header
  const actionCount = rows.filter((r) => r.kind === "action").length;
  const nodeCount = rows.length - actionCount;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-surface/80 backdrop-blur-sm pt-[12vh] px-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl border border-outline bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
          <span className="material-symbols-outlined text-[20px] text-neutral-400 leading-none">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="search actions, routes, files, functions..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-on-surface-muted outline-none"
            data-testid="search-input"
          />
          <span className="text-xs text-on-surface-faint">
            esc
          </span>
        </div>
        <ul
          className="max-h-[60vh] overflow-y-auto"
          role="listbox"
          data-testid="search-results"
        >
          {workingGraph.nodes.length === 0 && actionCount === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-neutral-400">
              <p className="mb-1">No graph loaded.</p>
              <p className="text-xs text-on-surface-muted">
                Open a repo from the home page first.
              </p>
            </li>
          ) : rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-neutral-400">
              No matches for{" "}
              <span className="text-neutral-200">
                &ldquo;{query.length > 30 ? `${query.slice(0, 30)}…` : query}&rdquo;
              </span>
            </li>
          ) : (
            (() => {
              const items: React.ReactNode[] = [];
              let lastKind: Row["kind"] | null = null;
              rows.forEach((r, i) => {
                if (r.kind !== lastKind) {
                  items.push(
                    <li
                      key={`hdr-${r.kind}`}
                      className="px-4 py-1.5 text-xs font-medium text-on-surface-faint bg-surface-dim sticky top-0"
                      data-testid={`search-section-${r.kind}`}
                    >
                      {r.kind === "action"
                        ? `Actions · ${actionCount}`
                        : `Nodes · ${nodeCount}`}
                    </li>,
                  );
                  lastKind = r.kind;
                }
                if (r.kind === "action") {
                  items.push(<ActionRow key={r.item.id} a={r.item} active={i === activeIdx} onClick={() => pickAction(r.item)} onHover={() => setActiveIdx(i)} />);
                } else {
                  items.push(<NodeRow key={r.item.id} n={r.item} active={i === activeIdx} onClick={() => pickNode(r.item)} onHover={() => setActiveIdx(i)} />);
                }
              });
              return items;
            })()
          )}
        </ul>
        <div className="border-t border-outline-variant px-4 py-2 flex items-center justify-between text-xs text-on-surface-faint">
          <span>↑↓ navigate · ↵ select</span>
          <span>{rows.length} match{rows.length === 1 ? "" : "es"}</span>
        </div>
      </div>
    </div>
  );
}

function ActionRow({ a, active, onClick, onHover }: { a: ActionItem; active: boolean; onClick: () => void; onHover: () => void }) {
  return (
    <li role="option" aria-selected={active} data-testid={`search-action-${a.id}`}>
      <button
        onClick={onClick}
        onMouseEnter={onHover}
        className={`w-full text-left flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${
          active ? "bg-surface-container-high" : "hover:bg-surface-container"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="material-symbols-outlined text-[14px] text-schema-accent leading-none shrink-0">
            bolt
          </span>
          <span className="text-sm text-neutral-100 truncate">
            {a.label}
          </span>
        </div>
        {a.shortcut && (
          <kbd className="font-[JetBrains_Mono] text-xs text-neutral-500 border border-outline px-2 py-0.5 shrink-0">
            {a.shortcut}
          </kbd>
        )}
      </button>
    </li>
  );
}

function NodeRow({ n, active, onClick, onHover }: { n: GraphNode; active: boolean; onClick: () => void; onHover: () => void }) {
  const meta = (KIND_META[n.kind] ?? KIND_META.utility!);
  const label = n.meta?.httpPath ? `${n.meta.httpMethod} ${n.meta.httpPath}` : n.name;
  return (
    <li role="option" aria-selected={active}>
      <button
        onClick={onClick}
        onMouseEnter={onHover}
        className={`w-full text-left flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${
          active ? "bg-surface-container-high" : "hover:bg-surface-container"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.accent}`} />
          <div className="min-w-0">
            <p className="text-sm text-white truncate">
              {label}
            </p>
            <p className="font-[JetBrains_Mono] text-xs text-neutral-500 truncate">
              {n.file}
            </p>
          </div>
        </div>
        <span
          className={`text-xs shrink-0 ${meta.color}`}
        >
          {meta.label}
        </span>
      </button>
    </li>
  );
}
