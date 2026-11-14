"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import type { Level } from "@/lib/aggregate";

/**
 * Per-account canvas-position persistence hook.
 *
 * Loads `(repoKey, level)` positions from /api/positions on mount /
 * key change, and exposes a debounced setter that POSTs back. The
 * caller treats `overrides` as the authoritative source for layout —
 * we just hydrate it from the server and write back on user drags.
 *
 * Auth-disabled / 401 / network errors gracefully degrade to in-
 * memory only behaviour: the caller still gets the local override
 * map, drags still work, just nothing persists. This matches the
 * existing pre-auth behaviour exactly so the demo flow keeps
 * working without changes.
 *
 * Repo-level signature change → previous overrides are CLEARED
 * (matches the existing behaviour) and a fresh fetch is made.
 */
export interface OverridePoint {
  x: number;
  y: number;
}

interface Args {
  /** null when persistence shouldn't run (demo / fixture / not signed
   *  in / no repo loaded). The hook becomes a thin wrapper around
   *  local state in that case. */
  repoKey: string | null;
  level: Level;
  /** Bumped by the canvas when the working graph changes structurally —
   *  same trigger as the local `overrides` reset. Lets us re-fetch
   *  cleanly when, say, an op adds a new node. */
  structuralKey: string;
}

const DEBOUNCE_MS = 600;

export function usePersistedPositions({
  repoKey,
  level,
  structuralKey,
}: Args) {
  const [overrides, setOverridesState] = useState<
    Record<string, OverridePoint>
  >({});

  // Track the last (repoKey, level) we hydrated for so we don't
  // double-fetch.
  const hydratedKeyRef = useRef<string | null>(null);
  // Keep a ref to the current overrides for the flush handler
  // closure — saves us threading state into the timer.
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // Pending writes: ids that have been edited but not yet POSTed.
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);

  // Hydrate on key change.
  useEffect(() => {
    // Drop any in-flight flush when the key changes — the new key is
    // a different (repo, level) so writing the previous batch would
    // poison the new tab.
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    dirtyIdsRef.current.clear();

    const wantKey = `${repoKey ?? ""}::${level}::${structuralKey}`;
    if (hydratedKeyRef.current === wantKey) return;

    setOverridesState({});
    hydratedKeyRef.current = wantKey;

    if (!repoKey) return;

    let cancelled = false;
    void fetchApi(
      `/api/positions?repoKey=${encodeURIComponent(repoKey)}&level=${level}`,
    )
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          // 401 / 503 / db-error — silently fall back to local-only.
          return;
        }
        const json = (await r.json()) as {
          positions?: { nodeId: string; x: number; y: number }[];
        };
        if (cancelled) return;
        const next: Record<string, OverridePoint> = {};
        for (const p of json.positions ?? []) {
          next[p.nodeId] = { x: p.x, y: p.y };
        }
        setOverridesState(next);
      })
      .catch(() => {
        // network failure — local-only is fine.
      });

    return () => {
      cancelled = true;
    };
  }, [repoKey, level, structuralKey]);

  // Flush dirty IDs to /api/positions, then clear the dirty set.
  const flush = useCallback(async () => {
    flushTimerRef.current = null;
    if (!repoKey) {
      dirtyIdsRef.current.clear();
      return;
    }
    if (dirtyIdsRef.current.size === 0) return;
    const ids = [...dirtyIdsRef.current];
    dirtyIdsRef.current.clear();
    const positions = ids
      .map((id) => {
        const p = overridesRef.current[id];
        if (!p) return null;
        return { nodeId: id, x: p.x, y: p.y };
      })
      .filter((p): p is { nodeId: string; x: number; y: number } => !!p);
    if (positions.length === 0) return;
    try {
      await fetchApi("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoKey, level, positions }),
      });
    } catch {
      // Best-effort. We don't requeue on failure — if the next drag
      // touches the same node it'll re-mark it dirty. If the user
      // signed out / network died, falling back to local-only is the
      // right behaviour.
    }
  }, [repoKey, level]);

  // Wrapped setter the caller passes to React Flow's onNodesChange.
  // Marks ids dirty + schedules a debounced flush.
  const setOverrides = useCallback(
    (
      updater:
        | Record<string, OverridePoint>
        | ((
            prev: Record<string, OverridePoint>,
          ) => Record<string, OverridePoint>),
    ) => {
      setOverridesState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        // Diff the maps — anything whose value changed (or is new) is
        // dirty.
        for (const [id, p] of Object.entries(next)) {
          const before = prev[id];
          if (!before || before.x !== p.x || before.y !== p.y) {
            dirtyIdsRef.current.add(id);
          }
        }
        return next;
      });
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = window.setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  // Reset = clear local state AND DELETE on the server.
  const resetOverrides = useCallback(async () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    dirtyIdsRef.current.clear();
    setOverridesState({});
    if (!repoKey) return;
    try {
      await fetchApi(
        `/api/positions?repoKey=${encodeURIComponent(repoKey)}&level=${level}`,
        { method: "DELETE" },
      );
    } catch {
      // best-effort
    }
  }, [repoKey, level]);

  // Flush any pending writes on unmount so a quick navigate-away
  // doesn't drop the last drag.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      // Fire-and-forget — at unmount we can't await.
      void flush();
    };
  }, [flush]);

  return { overrides, setOverrides, resetOverrides };
}
