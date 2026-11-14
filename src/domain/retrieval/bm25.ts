// Per `architecture/v1-launch-plan.md` Step 8a + research/29
// §4.3 (Sourcegraph BM25F + the "20% improvement" production
// data point).
//
// Generic BM25F implementation. "BM25F" = BM25 with per-field
// weighting; documents can declare multiple text fields with
// different importance multipliers. This is the Sourcegraph
// approach for code search: file names + symbol definitions
// outweigh comments or statement bodies.
//
// **Single-source.** Per the plan's Step 8 work item 4 ("unify
// the BM25 implementations"), this module is the shared BM25
// for BOTH canon docs (`src/wisdom/canon/index.ts`) AND graph
// nodes (`src/domain/retrieval/graph-bm25.ts`). Step 8a's
// double-check verifies both consumers produce identical
// scores when queried with the same field weights — pinned
// as an integration-boundary equivalence test per §0.6.4
// refinement (d).
//
// **Pure domain.** No IO. Caller pre-tokenizes; we just index
// + score. Lives in `domain/retrieval/` per the DAG.

/** Standard BM25 hyperparameters per Robertson + Walker 1994.
 *  Used by Sourcegraph BM25F + many other production
 *  implementations. Exported so callers can override per
 *  workload (e.g. shorter, structured docs vs longer prose). */
export interface Bm25Params {
  /** Term-frequency saturation. Robertson default: 1.2. Higher
   *  values favour documents with many term repetitions; lower
   *  saturates earlier. Sourcegraph uses 1.2 in production. */
  readonly k1: number;
  /** Length-normalisation. Robertson default: 0.75. 0 = no
   *  length normalisation; 1 = full normalisation. */
  readonly b: number;
}

export const DEFAULT_BM25_PARAMS: Bm25Params = { k1: 1.2, b: 0.75 } as const;

/** A field is a named text bucket within a document. Each field
 *  has its own pre-tokenised content + a weight. */
export interface Field {
  readonly name: string;
  readonly tokens: readonly string[];
  /** Field weight multiplier. Used by the BM25F variant
   *  (Sourcegraph): `score += weight * idf * tfNorm`. Default
   *  1.0 = standard BM25. Higher = more important (e.g. 3.0
   *  for symbol names, 1.0 for comments). */
  readonly weight: number;
}

/** A document is a stable id + an array of fields. Callers
 *  build these once per corpus and pass them to `buildIndex`. */
export interface Document {
  readonly id: string;
  readonly fields: readonly Field[];
}

/** Inverted index: maps each term to the set of `{docId, fieldName, tf}`
 *  postings that contain it. Stable across queries; rebuild only
 *  when the corpus changes. */
export interface InvertedIndex {
  readonly docIds: readonly string[];
  /** term → array of postings */
  readonly postings: ReadonlyMap<string, readonly Posting[]>;
  /** docId → fieldName → length (token count) */
  readonly fieldLengths: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** fieldName → average length across all docs (for length norm) */
  readonly avgFieldLength: ReadonlyMap<string, number>;
  /** docId → fieldName → weight (one per doc per field, since
   *  weights may differ per doc — e.g. a code-heavy doc could
   *  weight its bodies higher than a prose-heavy one). */
  readonly fieldWeights: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Total documents (N for IDF formula). */
  readonly N: number;
}

export interface Posting {
  readonly docId: string;
  readonly fieldName: string;
  readonly tf: number;
}

/** Tokenise a string into BM25-friendly terms.
 *  Sourcegraph-style identifier tokenization for code search:
 *
 *  1. Split on whitespace + non-alphanumeric (so `_`, `.`,
 *     `/`, etc. become separators — `user_service.ts` →
 *     `["user", "service", "ts"]`).
 *  2. **Identifier splitting**: each candidate is further
 *     split on camelCase/PascalCase boundaries and digit
 *     transitions (Sourcegraph BM25F v6.2). `UserService` →
 *     `["user", "service"]`. `getUserId2` → `["get", "user",
 *     "id", "2"]`.
 *  3. The original camelCase token is **also kept** as a
 *     compound term — query `UserService` should still match
 *     a doc that contains the compound. So tokens =
 *     `[...subtokens, original]`.
 *  4. Lowercases everything.
 *  5. Drops tokens < 2 chars.
 *
 *  Without identifier splitting, BM25 over code rarely matches
 *  because `UserService` ≠ `user`. The compound-retention rule
 *  preserves the exact-match query case. */
export function tokenize(text: string): string[] {
  const candidates = text
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const candidate of candidates) {
    // Identifier splits: camelCase ↔ lower→Upper, digit↔letter,
    // and ALLCAPS→Camel boundaries.
    const parts = candidate
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([A-Za-z])/g, "$1 $2")
      .split(/\s+/);
    for (const p of parts) {
      const lc = p.toLowerCase();
      if (lc.length >= 2) out.push(lc);
    }
    // Also retain the compound (lowercased) so exact-match
    // queries still hit.
    const compound = candidate.toLowerCase();
    if (compound.length >= 2 && parts.length > 1) out.push(compound);
  }
  return out;
}

/** Build an inverted index from a corpus of documents. The
 *  index is immutable after construction; rebuild to reflect
 *  corpus changes. Cost: O(N × M) where N = doc count, M = avg
 *  field tokens. */
export function buildIndex(docs: readonly Document[]): InvertedIndex {
  const docIds: string[] = [];
  const postings = new Map<string, Posting[]>();
  const fieldLengths = new Map<string, Map<string, number>>();
  const fieldWeights = new Map<string, Map<string, number>>();
  const fieldTotalLength = new Map<string, number>();
  const fieldDocCount = new Map<string, number>();

  for (const doc of docs) {
    docIds.push(doc.id);
    const docLengths = new Map<string, number>();
    const docWeights = new Map<string, number>();
    fieldLengths.set(doc.id, docLengths);
    fieldWeights.set(doc.id, docWeights);

    for (const field of doc.fields) {
      docLengths.set(field.name, field.tokens.length);
      docWeights.set(field.name, field.weight);
      fieldTotalLength.set(
        field.name,
        (fieldTotalLength.get(field.name) ?? 0) + field.tokens.length,
      );
      fieldDocCount.set(
        field.name,
        (fieldDocCount.get(field.name) ?? 0) + 1,
      );

      // Term-frequency per field per doc
      const tf = new Map<string, number>();
      for (const t of field.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [term, count] of tf) {
        let arr = postings.get(term);
        if (!arr) { arr = []; postings.set(term, arr); }
        arr.push({ docId: doc.id, fieldName: field.name, tf: count });
      }
    }
  }

  const avgFieldLength = new Map<string, number>();
  for (const [name, total] of fieldTotalLength) {
    const cnt = fieldDocCount.get(name) ?? 1;
    avgFieldLength.set(name, total / cnt);
  }

  return {
    docIds,
    postings,
    fieldLengths,
    avgFieldLength,
    fieldWeights,
    N: docs.length,
  };
}

/** Compute IDF for a term given the postings and total docs.
 *  Formula: ln((N - df + 0.5) / (df + 0.5) + 1). `df` = number
 *  of distinct documents containing the term (a term in N
 *  fields of the same doc still counts as 1).
 *
 *  Extracted per §0.6.4 (a) — buried logic in scoreDoc; this
 *  surface is now directly unit-testable. */
export function computeIdf(postings: readonly Posting[], N: number): number {
  const docsWithTerm = new Set<string>();
  for (const p of postings) docsWithTerm.add(p.docId);
  const df = docsWithTerm.size;
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

/** Compute the BM25 tf-norm component for a single posting.
 *  `(tf × (k1+1)) / (tf + k1 × (1 - b + b × dl/avgDl))`.
 *
 *  Extracted per §0.6.4 (a). */
export function computeTfNorm(
  tf: number,
  fieldLen: number,
  avgFieldLen: number,
  params: Bm25Params,
): number {
  const { k1, b } = params;
  const lengthRatio = avgFieldLen === 0 ? 1 : fieldLen / avgFieldLen;
  return (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * lengthRatio));
}

/** Score a single document against a query. Returns the BM25F
 *  score (sum of per-field BM25 scores × field weight). 0 if
 *  no query terms appear in the doc. */
export function scoreDoc(
  index: InvertedIndex,
  query: string,
  docId: string,
  params: Bm25Params = DEFAULT_BM25_PARAMS,
): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;
  const docLengths = index.fieldLengths.get(docId);
  const docWeights = index.fieldWeights.get(docId);
  if (!docLengths || !docWeights) return 0;

  let score = 0;
  for (const term of queryTerms) {
    const postings = index.postings.get(term);
    if (!postings) continue;
    const idf = computeIdf(postings, index.N);
    for (const p of postings) {
      if (p.docId !== docId) continue;
      const fieldLen = docLengths.get(p.fieldName) ?? 0;
      const avgLen = index.avgFieldLength.get(p.fieldName) ?? fieldLen;
      const tfNorm = computeTfNorm(p.tf, fieldLen, avgLen, params);
      const weight = docWeights.get(p.fieldName) ?? 1.0;
      score += weight * idf * tfNorm;
    }
  }
  return score;
}

/** Run a BM25F query over the index. Returns the top-K
 *  documents by score. Excludes 0-score documents.
 *
 *  **Perf note** (per Step 8a double-check):  the naive impl
 *  scored each candidate by re-iterating the FULL postings
 *  list of every query term and filtering by docId. That's
 *  O(|terms| × |postings|) per candidate, or O(C × T × P)
 *  total. On a 9.5k-node turborepo with a common term
 *  ("crates"), this ballooned to >2 seconds per query.
 *
 *  The fix: iterate each term's postings ONCE, accumulating
 *  per-candidate score directly. That's O(T × P) total —
 *  candidate-count-independent. ~200× speedup on turborepo. */
export function searchIndex(
  index: InvertedIndex,
  query: string,
  k: number,
  params: Bm25Params = DEFAULT_BM25_PARAMS,
): { docId: string; score: number }[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const { k1, b } = params;
  const scoreById = new Map<string, number>();

  for (const term of queryTerms) {
    const postings = index.postings.get(term);
    if (!postings) continue;
    const idf = computeIdf(postings, index.N);
    for (const p of postings) {
      const docLengths = index.fieldLengths.get(p.docId);
      const docWeights = index.fieldWeights.get(p.docId);
      if (!docLengths || !docWeights) continue;
      const fieldLen = docLengths.get(p.fieldName) ?? 0;
      const avgLen = index.avgFieldLength.get(p.fieldName) ?? fieldLen;
      const lengthRatio = avgLen === 0 ? 1 : fieldLen / avgLen;
      const tfNorm = (p.tf * (k1 + 1)) / (p.tf + k1 * (1 - b + b * lengthRatio));
      const weight = docWeights.get(p.fieldName) ?? 1.0;
      scoreById.set(
        p.docId,
        (scoreById.get(p.docId) ?? 0) + weight * idf * tfNorm,
      );
    }
  }

  const results: { docId: string; score: number }[] = [];
  for (const [docId, score] of scoreById) {
    if (score > 0) results.push({ docId, score });
  }
  results.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return results.slice(0, k);
}
