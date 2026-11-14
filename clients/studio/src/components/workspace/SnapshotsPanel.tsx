"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/state/store";
import { fetchApi } from "@/lib/api";

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function SnapshotsPanel() {
  const snapshots = useStore((s) => s.snapshots);
  const saveSnapshot = useStore((s) => s.saveSnapshot);
  const restoreSnapshot = useStore((s) => s.restoreSnapshot);
  const deleteSnapshot = useStore((s) => s.deleteSnapshot);
  const [name, setName] = useState("");

  function onSave() {
    saveSnapshot(name || undefined);
    setName("");
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs font-medium text-neutral-500 mb-2">
          Save snapshot
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave();
            }
          }}
          placeholder="optional name..."
          className="w-full bg-transparent border border-outline-variant focus:border-neutral-500 transition-colors px-3 py-2 text-sm text-white placeholder:text-on-surface-muted outline-none"
        />
        <button
          onClick={onSave}
          data-testid="snapshot-save"
          className="mt-2 w-full px-3 py-2 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 text-xs transition-colors"
        >
          Save
        </button>
        <p className="mt-2 text-xs text-neutral-300 leading-relaxed">
          Snapshots capture the working graph at this moment. Restore later to
          jump back without affecting the undo stack.
        </p>
      </div>

      <div className="border-t border-outline-variant/60 pt-4">
        <p className="text-xs font-medium text-neutral-500 mb-2">
          Saved ({snapshots.length})
        </p>
        {snapshots.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-on-surface-muted leading-relaxed">
              No snapshots yet.
            </p>
            <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
              Snapshots are independent of undo, so you can branch
              experiments freely. Click{" "}
              <span className="text-schema-accent">Save</span> above
              to capture the current graph.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="snapshots-list">
            {snapshots.map((s) => (
              <li
                key={s.id}
                data-testid={`snapshot-item-${s.id}`}
                className="border border-outline-variant/60 bg-surface-dim p-3"
              >
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <p className="text-sm text-white truncate">
                    {s.name}
                  </p>
                  <span className="text-xs text-neutral-500 shrink-0">
                    {formatTime(s.at)}
                  </span>
                </div>
                <p className="text-xs text-neutral-300 mb-3">
                  {s.graph.nodes.length} nodes · {s.graph.edges.length} edges
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => restoreSnapshot(s.id)}
                    data-testid={`snapshot-restore-${s.id}`}
                    className="flex-1 px-3 py-1.5 border border-outline hover:border-schema-accent hover:text-schema-accent text-xs text-neutral-300 transition-colors"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => deleteSnapshot(s.id)}
                    data-testid={`snapshot-delete-${s.id}`}
                    className="px-3 py-1.5 border border-outline-variant hover:border-violation/60 hover:text-violation text-xs text-neutral-500 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Persistent snapshots (SQLite-backed via MCP) */}
      <PersistentSnapshots />
    </div>
  );
}

interface DbSnapshot { id: number; sha: string; label: string; createdAt: string; nodeCount: number; edgeCount: number; }

function PersistentSnapshots() {
  const repo = useStore((s) => s.repo);
  const emitToast = useStore((s) => s.emitToast);
  const [dbSnapshots, setDbSnapshots] = useState<DbSnapshot[]>([]);

  const load = useCallback(() => {
    if (!repo.rootPath) return;
    fetchApi("/api/graph/list-snapshots", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
      .then((d) => setDbSnapshots(d.snapshots ?? []))
      .catch(() => {});
  }, [repo.rootPath]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      await fetchApi("/api/graph/delete-snapshot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: id }),
      });
      emitToast("snapshot deleted");
      load();
    } catch (err) {
      emitToast(`delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [emitToast, load]);

  if (!repo.rootPath) return null;

  return (
    <div className="border-t border-outline-variant/60 pt-4">
      <p className="text-xs font-medium text-neutral-500 mb-2">
        Persistent (SQLite) · {dbSnapshots.length}
      </p>
      {dbSnapshots.length === 0 ? (
        <p className="text-xs text-on-surface-muted py-3">
          No persistent snapshots. These are created automatically on graph.diff_against with a SHA ref.
        </p>
      ) : (
        <ul className="space-y-2">
          {dbSnapshots.map((s) => (
            <li key={s.id} className="border border-outline-variant/60 bg-surface-dim p-3">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <p className="font-[JetBrains_Mono] text-sm text-white truncate">{s.label || s.sha.slice(0, 10)}</p>
                <span className="text-xs text-neutral-500 shrink-0">{s.createdAt}</span>
              </div>
              <p className="text-xs text-neutral-400">{s.nodeCount} nodes · {s.edgeCount} edges</p>
              <button onClick={() => handleDelete(s.id)}
                className="mt-2 text-xs text-neutral-500 hover:text-violation transition-colors">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={load} className="mt-2 text-xs text-on-surface-muted hover:text-white transition-colors">
        Refresh
      </button>
    </div>
  );
}
