// Per `architecture/v1-launch-plan.md` Step 5b — L2 tree-sitter
// incremental parse cache.
//
// Caches the last `Parser.Tree` per file. When a file changes,
// the extractor can pass the old tree to `parser.parse(newContent,
// oldTree)` — tree-sitter only re-parses the changed ranges,
// which is O(delta) instead of O(file-size). On a 5,000-line file
// with a 10-line edit, this is typically 10-50× faster.
//
// Full-rebuild fallback (per doc 27 R9 + the rust-analyzer
// #19404 cautionary tale): if incremental parse fails or the
// tree is stale beyond recognition, the cache is evicted and a
// full parse is done. The fallback is always correct; the
// incremental path is an optimization with a safety net.

import type Parser from "tree-sitter";

export interface TreeCacheEntry {
  readonly tree: Parser.Tree;
  readonly contentHash: string;
  readonly updatedAt: number;
}

export interface TreeCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  incrementalParses: number;
  fullParseFallbacks: number;
}

const MAX_CACHE_SIZE = 2000;

export class TreeCache {
  private readonly cache = new Map<string, TreeCacheEntry>();
  readonly stats: TreeCacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    incrementalParses: 0,
    fullParseFallbacks: 0,
  };

  get(filePath: string): TreeCacheEntry | undefined {
    const entry = this.cache.get(filePath);
    if (entry) {
      this.stats.hits++;
      return entry;
    }
    this.stats.misses++;
    return undefined;
  }

  set(filePath: string, tree: Parser.Tree, contentHash: string): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
        this.stats.evictions++;
      }
    }
    this.cache.set(filePath, { tree, contentHash, updatedAt: Date.now() });
  }

  evict(filePath: string): boolean {
    const had = this.cache.delete(filePath);
    if (had) this.stats.evictions++;
    return had;
  }

  clear(): void {
    this.stats.evictions += this.cache.size;
    this.cache.clear();
  }

  get size(): number { return this.cache.size; }
}

export function createTreeCache(): TreeCache {
  return new TreeCache();
}
