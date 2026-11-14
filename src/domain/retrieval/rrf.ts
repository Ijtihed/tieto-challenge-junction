// Per `architecture/v1-launch-plan.md` Step 8a + research/29
// §4.2 (Reciprocal Rank Fusion).
//
// RRF formula: RRF_score(d) = Σ 1/(k + rank(d))   [k=60 standard]
//
// k=60 is the textbook constant (Cormack, Clarke, Büttcher 2009);
// research/29 §4.2 confirms it as the production default. Per
// research/29 §4.4 + Sourcegraph: hybrid retrieval via RRF
// outperforms single-method retrieval by 1-9% NDCG.
//
// **Pure function, no IO.** Caller supplies the ranked lists
// from the BM25 + graph-traversal retrievers; this module
// fuses them. Independent of the source rankings — same
// formula works for any number of ranked lists.

/** Default RRF k. Cormack et al. 2009 + Sourcegraph production. */
export const DEFAULT_RRF_K = 60;

/** A single ranked list from one retriever (BM25, graph
 *  traversal, vector, etc.). Order is significant — index 0
 *  is rank 1. The score field is informational only; RRF only
 *  uses the rank position. */
export interface RankedList {
  readonly name: string;
  readonly items: readonly { readonly docId: string; readonly score: number }[];
}

/** A fused result from RRF. `rrfScore` = sum of `1/(k + rank)`
 *  across all input lists where this doc appeared. `sources`
 *  records which retrievers contributed. */
export interface RrfResult {
  readonly docId: string;
  readonly rrfScore: number;
  readonly sources: ReadonlyMap<string, { readonly rank: number; readonly score: number }>;
}

export interface RrfOptions {
  /** Hyperparameter for the RRF formula. Default 60. */
  readonly k?: number;
  /** Max results returned. Default Infinity (all fused docs). */
  readonly topK?: number;
}

/** Fuse N ranked lists into one ranking via Reciprocal Rank
 *  Fusion. */
export function fuseRrf(
  lists: readonly RankedList[],
  options: RrfOptions = {},
): RrfResult[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const topK = options.topK ?? Infinity;

  // For each docId, accumulate rrfScore + sources.
  const accumulator = new Map<
    string,
    { rrfScore: number; sources: Map<string, { rank: number; score: number }> }
  >();

  for (const list of lists) {
    for (let i = 0; i < list.items.length; i++) {
      const item = list.items[i]!;
      const rank = i + 1; // RRF ranks are 1-based
      const contribution = 1 / (k + rank);

      let entry = accumulator.get(item.docId);
      if (!entry) {
        entry = { rrfScore: 0, sources: new Map() };
        accumulator.set(item.docId, entry);
      }
      entry.rrfScore += contribution;
      entry.sources.set(list.name, { rank, score: item.score });
    }
  }

  const results: RrfResult[] = [];
  for (const [docId, entry] of accumulator) {
    results.push({
      docId,
      rrfScore: entry.rrfScore,
      sources: entry.sources,
    });
  }
  results.sort(
    (a, b) =>
      b.rrfScore - a.rrfScore || a.docId.localeCompare(b.docId),
  );
  return Number.isFinite(topK) ? results.slice(0, topK) : results;
}
