// Per architecture/schema-v3.md §3.8 — canon corpus + BM25 search.
// Phase 9: in-memory BM25 (tantivy + USearch deferred to hardening).
// 60 docs across 4 paradigms, loaded from markdown files at startup.
//
// Step 8a: migrated to the shared BM25F implementation in
// `src/domain/retrieval/bm25.ts` per the plan's "unify the
// BM25 implementations" work item. The behavioural contract
// (k1=1.2, b=0.75, sum across terms with IDF + tf-norm) is
// preserved — the existing `searchCanon` regression tests
// continue to pass without changes.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildIndex,
  searchIndex,
  tokenize,
  type Document,
  type InvertedIndex,
} from "../../domain/retrieval/bm25.ts";

export interface CanonDoc {
  readonly id: string;
  readonly paradigm: "otp" | "stm" | "cqrs" | "distsys";
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly sourceUrl: string;
  readonly body: string;
}

export interface CanonChunk {
  readonly uri: string;
  readonly docId: string;
  readonly paradigm: string;
  readonly body: string;
  readonly metadata: { title: string; author: string; license: string; sourceUrl: string };
}

type Paradigm = CanonDoc["paradigm"];
const PARADIGMS: readonly Paradigm[] = ["otp", "stm", "cqrs", "distsys"];

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const m = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (m) meta[m[1]!] = m[2]!;
  }
  return { meta, body: match[2]!.trim() };
}

function loadDocs(): CanonDoc[] {
  const canonDir = resolve(import.meta.dirname!, ".");
  const docs: CanonDoc[] = [];
  for (const paradigm of PARADIGMS) {
    const dir = join(canonDir, paradigm);
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      docs.push({
        id: meta["id"] ?? file.replace(/\.md$/, ""),
        paradigm: (meta["paradigm"] as Paradigm) ?? paradigm,
        title: meta["title"] ?? file.replace(/\.md$/, ""),
        author: meta["author"] ?? "Schema team",
        license: meta["license"] ?? "MIT",
        sourceUrl: meta["sourceUrl"] ?? "",
        body,
      });
    }
  }
  return docs;
}

const DOCS: readonly CanonDoc[] = loadDocs();

/** Convert a CanonDoc to a Document for the shared BM25
 *  index. Two fields: `title` (weight 1.0) and `body` (weight
 *  1.0) — matches the pre-Step-8a behaviour where title +
 *  body were concatenated into a single bag. Future work could
 *  raise the title weight (Sourcegraph-style), but that would
 *  shift the existing canon-search rankings; keeping it flat
 *  preserves the regression-test contract. */
function canonDocToDocument(doc: CanonDoc): Document {
  return {
    id: doc.id,
    fields: [
      { name: "title", tokens: tokenize(doc.title), weight: 1.0 },
      { name: "body", tokens: tokenize(doc.body), weight: 1.0 },
    ],
  };
}

const CANON_INDEX: InvertedIndex = buildIndex(DOCS.map(canonDocToDocument));

export function searchCanon(
  paradigm: string | undefined,
  query: string,
  k: number = 8,
): { uri: string; score: number; snippet: string; title: string; sourceUrl: string; license: string }[] {
  // The shared BM25 doesn't have a per-paradigm filter built
  // in; we filter the results post-hoc. Acceptable because
  // (a) the canon corpus is tiny (60 docs) and (b) keeping
  // the shared index general (one index per workspace) avoids
  // duplicating storage. If the canon corpus ever grew large,
  // we'd build per-paradigm indices.
  const results = searchIndex(CANON_INDEX, query, k * 4);
  const out: ReturnType<typeof searchCanon> = [];
  for (const { docId, score } of results) {
    const doc = DOCS.find((d) => d.id === docId);
    if (!doc) continue;
    if (paradigm && doc.paradigm !== paradigm) continue;
    out.push({
      uri: `canon://${doc.paradigm}/${doc.id}#full`,
      score,
      snippet: doc.body.slice(0, 200) + "…",
      title: doc.title,
      sourceUrl: doc.sourceUrl,
      license: doc.license,
    });
    if (out.length >= k) break;
  }
  return out;
}

export function readCanonDoc(uri: string): CanonChunk | null {
  const match = uri.match(/^canon:\/\/(\w+)\/([^#]+)/);
  if (!match) return null;
  const paradigm = match[1]!;
  const docId = match[2]!;
  const doc = DOCS.find((d) => d.id === docId && d.paradigm === paradigm);
  if (!doc) return null;
  return {
    uri,
    docId: doc.id,
    paradigm: doc.paradigm,
    body: doc.body,
    metadata: { title: doc.title, author: doc.author, license: doc.license, sourceUrl: doc.sourceUrl },
  };
}

export { DOCS as CANON_DOCS };
