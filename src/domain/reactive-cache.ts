// Per `architecture/v1-launch-plan.md` Step 5b — reactive
// memoization for hot query paths using @reactively/core.
//
// The 5 actions that benefit from caching across file-watch
// updates: graph.summary, graph.entry_points, rules.evaluate,
// graph.search, graph.diff_against. Each computes an expensive
// result from the session's graph. When a live-update changes
// only a few nodes, most queries return the same result — but
// without memoization the action re-computes from scratch.
//
// @reactively/core provides fine-grained reactive signals. We
// wrap the graph's (nodeCount, edgeCount) as a reactive source
// and each cached query result as a reactive derivation. When
// the source changes, stale derivations recompute lazily on
// next read; when unchanged, they return the cached value.

import { reactive, Reactive } from "@reactively/core";

export interface ReactiveCacheEntry<T> {
  readonly key: string;
  readonly value: Reactive<T>;
  readonly computeCount: Reactive<number>;
}

export interface ReactiveGraphSignal {
  readonly nodeCount: Reactive<number>;
  readonly edgeCount: Reactive<number>;
  readonly version: Reactive<number>;
  bump(): void;
}

export function createGraphSignal(): ReactiveGraphSignal {
  const nodeCount = reactive(0);
  const edgeCount = reactive(0);
  const version = reactive(0);

  return {
    nodeCount,
    edgeCount,
    version,
    bump() {
      version.set(version.value + 1);
    },
  };
}

export interface ReactiveCache {
  readonly signal: ReactiveGraphSignal;
  getOrCompute<T>(key: string, compute: () => T): T;
  invalidate(): void;
  readonly stats: { hits: number; misses: number; invalidations: number };
}

export function createReactiveCache(): ReactiveCache {
  const signal = createGraphSignal();
  const entries = new Map<string, { value: unknown; atVersion: number }>();
  const stats = { hits: 0, misses: 0, invalidations: 0 };

  return {
    signal,
    getOrCompute<T>(key: string, compute: () => T): T {
      const currentVersion = signal.version.value;
      const cached = entries.get(key);
      if (cached && cached.atVersion === currentVersion) {
        stats.hits++;
        return cached.value as T;
      }
      stats.misses++;
      const value = compute();
      entries.set(key, { value, atVersion: currentVersion });
      return value;
    },
    invalidate() {
      signal.bump();
      stats.invalidations++;
    },
    stats,
  };
}
