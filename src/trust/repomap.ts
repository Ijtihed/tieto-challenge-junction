// Curated architecture map: ~80 well-known types grouped into hand-defined modules
// (junction/repo-map.json), with type-level links aggregated from the Roslyn graph.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CsGraph } from "../extractors/extractor-csharp/sidecar.ts";
import { JUNCTION_DIR } from "./ledger.ts";
import { headGraph, revParse } from "./git.ts";
import { computeGeometry, type MapGeometry } from "./maplayout.ts";

/** Ring order for the layout: neighbours on the ring are modules that talk to each other. */
const RING = ["attributes", "analyzers", "generator", "templates", "gentests", "runtests", "integrations", "internals", "wire", "formatters", "resolvers", "api"];

interface GroupDef { id: string; name: string; row: number; col: number; color: string; slots: number; about: string; prefixes?: string[]; match?: string }
interface MapDef { title: string; exclude: string[]; rows: { label: string }[]; groups: GroupDef[]; pinned: string[]; repoMatch?: string[]; matchOrder?: string[]; ring?: string[]; curated?: boolean }

/** Most specific rules first; the first group that claims a path wins. */
const MATCH_ORDER = ["attributes", "analyzers", "templates", "generator", "api", "wire", "resolvers", "formatters", "gentests", "runtests", "internals", "integrations"];

export interface MapNode { id: string; label: string; group: string; kind: string; file: string; members: number; usedBy: number; bucket?: boolean; count?: number }
export interface MapEdge { source: string; target: string; weight: number; description?: string; examples?: string[] }
export interface RepoMap {
  title: string; sha: string; rows: { label: string }[]; curated: boolean;
  groups: (Omit<GroupDef, "prefixes" | "match"> & { types: number; rules: { prefixes: string[]; match: string | null } })[];
  matchOrder: string[]; exclude: string[];
  nodes: MapNode[]; edges: MapEdge[];
  /** C# type key -> visible node id (types not shown map to their module's bucket). */
  typeToNode: Record<string, string>;
  /** repo-relative file -> visible node id. */
  fileToNode: Record<string, string>;
  geometry: MapGeometry;
}

const PALETTE = ["#8a9bb0",  "#b0927a",  "#a3a38a",  "#c4ad80",  "#7d9bbf",  "#8fa98f",  "#9cb08a",  "#7fa6a6",  "#8c8c8c",  "#8b97a8",  "#a593a8",  "#b88a85"];

/** Hand-built map for the submission repo; any other C# repo gets one generated from its project layout. */
function loadDef(repoName: string, graph: CsGraph): MapDef {
  const curated = JSON.parse(readFileSync(join(JUNCTION_DIR, "repo-map.json"), "utf8")) as MapDef;
  const names = curated.repoMatch ?? ["junction26-messagepack-csharp", "MessagePack-CSharp"];
  if (names.some((n) => repoName.toLowerCase() === n.toLowerCase())) return { ...curated, curated: true, matchOrder: MATCH_ORDER, ring: RING };
  return generatedDef(repoName, graph);
}

function generatedDef(repoName: string, graph: CsGraph): MapDef {
  const exclude = ["benchmark/", "benchmarks/", "sandbox/", "samples/", "examples/"].filter((p) => graph.files.some((f) => f.startsWith(p)));
  const types = graph.nodes.filter((n) => TYPE_KINDS.has(n.csKind) && !exclude.some((p) => n.file.startsWith(p)) && !n.generated);
  // A module per project: src/<Project>/..., tests/<Project>/..., otherwise the top-level folder.
  const projectOf = (f: string) => {
    const parts = f.split("/");
    return (parts[0] === "src" || parts[0] === "tests" || parts[0] === "test") && parts.length > 2 ? `${parts[0]}/${parts[1]}/` : `${parts[0]}/`;
  };
  const byProject = new Map<string, typeof types>();
  for (const t of types) (byProject.get(projectOf(t.file)) ?? byProject.set(projectOf(t.file), []).get(projectOf(t.file))!).push(t);
  const ranked = [...byProject.entries()].sort((a, b) => b[1].length - a[1].length);
  const top = ranked.slice(0, 11);
  const total = types.length || 1;
  const groups: GroupDef[] = top.map(([prefix, ts], i) => {
    const ns = new Map<string, number>();
    for (const t of ts) { const n = t.key.split(".").slice(0, -1).join("."); ns.set(n, (ns.get(n) ?? 0) + 1); }
    const mainNs = [...ns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const isTest = /^tests?\//.test(prefix);
    return {
      id: `m${i}`, name: prefix.replace(/^(src|tests?)\//, "").replace(/\/$/, "") || prefix, row: isTest ? 2 : Math.min(1, Math.floor(i / 4)), col: i % 4,
      color: PALETTE[i % PALETTE.length]!, slots: Math.max(1, Math.min(6, Math.round((40 * ts.length) / total))),
      about: `${ts.length} types${mainNs ? ` · mostly ${mainNs}` : ""}${isTest ? " · tests" : ""}`, prefixes: [prefix],
    };
  });
  if (ranked.length > top.length) groups.push({ id: "other", name: "Other", row: 2, col: 3, color: "#71717a", slots: 4, about: `${ranked.slice(11).reduce((n, [, ts]) => n + ts.length, 0)} types in smaller folders`, prefixes: [""] });
  const order = [...groups].sort((a, b) => (b.prefixes?.[0]?.length ?? 0) - (a.prefixes?.[0]?.length ?? 0)).map((g) => g.id);
  return {
    title: repoName, exclude, curated: false, pinned: [], groups, matchOrder: order, ring: groups.map((g) => g.id),
    rows: [{ label: "Libraries" }, { label: "More libraries" }, { label: "Tests and other" }],
  };
}

export function groupOfPath(def: { groups: { id: string; prefixes?: string[]; match?: string | null }[]; matchOrder?: string[] }, path: string): string | null {
  for (const id of def.matchOrder ?? MATCH_ORDER) {
    const g = def.groups.find((x) => x.id === id);
    if (!g) continue;
    if (g.match && new RegExp(g.match).test(path)) return g.id;
    if (!g.match && g.prefixes?.some((p) => path.startsWith(p))) return g.id;
  }
  return null;
}

/** `Foo\`2` -> `Foo<T1, T2>`, `Foo\`1` -> `Foo<T>`. */
function displayName(key: string, name: string): string {
  const m = /`(\d+)$/.exec(key);
  if (!m) return name;
  const n = Number(m[1]);
  return `${name}<${n === 1 ? "T" : Array.from({ length: n }, (_, i) => `T${i + 1}`).join(", ")}>`;
}

const TYPE_KINDS = new Set(["class", "struct", "interface", "record", "record struct", "enum"]);

export function buildRepoMap(graph: CsGraph, sha: string, repoName = "junction26-messagepack-csharp"): RepoMap {
  const def = loadDef(repoName, graph);
  const excluded = (f: string) => def.exclude.some((p) => f.startsWith(p));
  const types = graph.nodes.filter((n) => TYPE_KINDS.has(n.csKind) && !excluded(n.file));
  const typeKeys = new Set(types.map((t) => t.key));

  // Every member belongs to its innermost declaring type (via `declares` edges).
  const ownerOf = new Map<string, string>();
  for (const e of graph.edges) if (e.relation === "declares" && typeKeys.has(e.source)) ownerOf.set(e.target, e.source);
  const outerType = (k: string): string | undefined => {
    let t = typeKeys.has(k) ? k : ownerOf.get(k);
    while (t && ownerOf.has(t) && typeKeys.has(ownerOf.get(t)!)) t = ownerOf.get(t)!;
    return t;
  };

  // Type-level usage counts.
  const usedBy = new Map<string, Set<string>>();
  const pairWeight = new Map<string, number>();
  const pairDetail = new Map<string, { rel: Map<string, number>; ex: Set<string> }>();
  const memberName = (k: string) => k.replace(/\(.*\)$/, "").split(".").slice(-2).join(".");
  for (const e of graph.edges) {
    if (e.relation === "declares") continue;
    const s = outerType(e.source); const t = outerType(e.target);
    if (!s || !t || s === t) continue;
    (usedBy.get(t) ?? usedBy.set(t, new Set()).get(t)!).add(s);
    const k = `${s}\u0000${t}`;
    pairWeight.set(k, (pairWeight.get(k) ?? 0) + 1);
    const d = pairDetail.get(k) ?? pairDetail.set(k, { rel: new Map(), ex: new Set() }).get(k)!;
    d.rel.set(e.relation, (d.rel.get(e.relation) ?? 0) + 1);
    if (d.ex.size < 6 && e.source !== s && e.target !== t) d.ex.add(`${memberName(e.source)} → ${memberName(e.target)}`);
  }
  const memberCount = new Map<string, number>();
  for (const [m, t] of ownerOf) if (!typeKeys.has(m)) memberCount.set(t, (memberCount.get(t) ?? 0) + 1);

  const topLevel = types.filter((t) => !ownerOf.has(t.key) || !typeKeys.has(ownerOf.get(t.key)!));
  const groupOfType = new Map<string, string>();
  for (const t of topLevel) { const g = groupOfPath(def, t.file); if (g) groupOfType.set(t.key, g); }

  const pinned = new Set(def.pinned);
  const nodes: MapNode[] = [];
  const visible = new Set<string>();
  const typeToNode: Record<string, string> = {};
  for (const g of def.groups) {
    const inGroup = topLevel.filter((t) => groupOfType.get(t.key) === g.id && (!t.generated || pinned.has(t.name)));
    const score = (k: string) => (usedBy.get(k)?.size ?? 0) * 3 + Math.min(40, memberCount.get(k) ?? 0);
    const ranked = [...inGroup].sort((a, b) => Number(pinned.has(b.name)) - Number(pinned.has(a.name)) || score(b.key) - score(a.key));
    const seen = new Set<string>();
    const shown = ranked.filter((t) => !seen.has(t.name) && seen.add(t.name)).slice(0, g.slots);
    for (const t of shown) {
      visible.add(t.key);
      nodes.push({
        id: t.key, label: displayName(t.key, t.name), group: g.id, kind: t.isTest ? "test" : t.csKind === "class" && t.name.endsWith("Attribute") ? "attribute" : t.csKind,
        file: t.file, members: memberCount.get(t.key) ?? 0, usedBy: usedBy.get(t.key)?.size ?? 0,
      });
    }
    const rest = inGroup.length - shown.length;
    const bucketId = `bucket:${g.id}`;
    nodes.push({ id: bucketId, label: rest > 0 ? `${rest} more types` : "other files", group: g.id, kind: "bucket", file: "", members: 0, usedBy: 0, bucket: true, count: rest });
    for (const t of inGroup) typeToNode[t.key] = visible.has(t.key) ? t.key : bucketId;
  }
  // Nested types and members resolve through their outermost type.
  for (const t of types) { const o = outerType(t.key); if (o && typeToNode[o]) typeToNode[t.key] = typeToNode[o]; }

  const edgeMap = new Map<string, number>();
  const edgeDetail = new Map<string, { rel: Map<string, number>; ex: Set<string> }>();
  for (const [k, w] of pairWeight) {
    const [s, t] = k.split("\u0000") as [string, string];
    const a = typeToNode[s]; const b = typeToNode[t];
    if (!a || !b || a === b) continue;
    const kk = `${a}\u0000${b}`;
    edgeMap.set(kk, (edgeMap.get(kk) ?? 0) + w);
    const src = pairDetail.get(k)!;
    const dst = edgeDetail.get(kk) ?? edgeDetail.set(kk, { rel: new Map(), ex: new Set() }).get(kk)!;
    for (const [r, c] of src.rel) dst.rel.set(r, (dst.rel.get(r) ?? 0) + c);
    for (const x of src.ex) if (dst.ex.size < 4) dst.ex.add(x);
  }
  const labelOf = new Map<string, string>();
  const VERB: Record<string, string> = { calls: "calls", dispatch: "is invoked through", references_type: "uses the type", reads_field: "reads members of", implements: "implements", extends: "extends" };
  const describe = (a: string, b: string, d?: { rel: Map<string, number>; ex: Set<string> }) => {
    if (!d) return "";
    const rels = [...d.rel.entries()].sort((x, y) => y[1] - x[1]);
    const total = rels.reduce((n, [, c]) => n + c, 0);
    const main = rels.map(([r, c]) => `${VERB[r] ?? r} (${c})`).join(", ");
    return `${labelOf.get(a) ?? a} → ${labelOf.get(b) ?? b}: ${total} code reference${total === 1 ? "" : "s"}; ${main}.`;
  };
  const edges = [...edgeMap.entries()]
    .map(([k, weight]) => { const [source, target] = k.split("\u0000") as [string, string]; return { source, target, weight, _k: k }; })
    .filter((e) => !e.source.startsWith("bucket:") && !e.target.startsWith("bucket:"))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 90)
    .map(({ _k, ...e }) => e);
  for (const n of nodes) labelOf.set(n.id, n.label);
  for (const e of edges) {
    const d = edgeDetail.get(`${e.source}\u0000${e.target}`);
    (e as MapEdge).description = describe(e.source, e.target, d);
    (e as MapEdge).examples = [...(d?.ex ?? [])];
  }

  // A file maps to its most important visible type; only files with none fall back to the bucket.
  const fileToNode: Record<string, string> = {};
  const rankOf = (k: string) => (usedBy.get(k)?.size ?? 0) * 3 + (memberCount.get(k) ?? 0);
  const fileBest = new Map<string, { node: string; rank: number }>();
  for (const t of types) {
    const n = typeToNode[t.key];
    if (!n) continue;
    const r = n.startsWith("bucket:") ? -1 : rankOf(n);
    const cur = fileBest.get(t.file);
    if (!cur || r > cur.rank) fileBest.set(t.file, { node: n, rank: r });
  }
  for (const [f, b] of fileBest) fileToNode[f] = b.node;
  for (const f of graph.files) {
    if (fileToNode[f] || excluded(f)) continue;
    const g = groupOfPath(def, f);
    if (g) fileToNode[f] = `bucket:${g}`;
  }

  return {
    title: def.title, sha, rows: def.rows, matchOrder: def.matchOrder ?? MATCH_ORDER, exclude: def.exclude, curated: !!def.curated,
    groups: def.groups.map(({ prefixes, match, ...g }) => ({ ...g, types: topLevel.filter((t) => groupOfType.get(t.key) === g.id).length, rules: { prefixes: prefixes ?? [], match: match ?? null } })),
    nodes, edges, typeToNode, fileToNode,
    geometry: computeGeometry(nodes, edges, (def.ring ?? RING).filter((g) => def.groups.some((x) => x.id === g))),
  };
}

export async function repoMapFor(repo: string, ref = "HEAD"): Promise<RepoMap> {
  const sha = await revParse(repo, ref);
  return buildRepoMap(await headGraph(repo, sha), sha, repo.replace(/\/$/, "").split("/").pop() ?? repo);
}
