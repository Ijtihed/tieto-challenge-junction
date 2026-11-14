import type { AgentRun, Receipt, RepoMap } from "@/state/trust";

export type ActKind = "read" | "search" | "edit" | "command" | "result";
export interface MapEvent { i: number; node: string; kind: ActKind; title: string }

/** Place any repo-relative path on the map (falls back to its module's bucket). */
export function nodeForFile(map: RepoMap, rawPath: string): string | null {
  const path = rawPath.replace(/^\.\//, "").replace(/^.*?agent-worktrees\/[^/]+\//, "");
  if (map.fileToNode[path]) return map.fileToNode[path]!;
  if (map.exclude.some((p) => path.startsWith(p))) return null;
  for (const id of map.matchOrder) {
    const g = map.groups.find((x) => x.id === id);
    if (!g) continue;
    if (g.rules.match ? new RegExp(g.rules.match).test(path) : g.rules.prefixes.some((p) => path.startsWith(p))) return `bucket:${g.id}`;
  }
  return null;
}

/** A member key "Ns.Type.Member(...)" resolves through the longest type prefix the map knows. */
export function nodeForMember(map: RepoMap, key: string): string | null {
  let k = key.replace(/\(.*\)$/, "");
  while (k.includes(".")) {
    if (map.typeToNode[k]) return map.typeToNode[k]!;
    k = k.slice(0, k.lastIndexOf("."));
  }
  return null;
}

function commandNode(map: RepoMap, cmd: string): string | null {
  const m = /(tests\/[\w.]+|src\/[\w.]+)/.exec(cmd);
  if (m) return nodeForFile(map, m[1] + "/");
  if (/dotnet test/.test(cmd)) return "bucket:gentests";
  if (/dotnet build/.test(cmd)) return "bucket:generator";
  return null;
}

export function eventsFromRun(map: RepoMap, run: AgentRun): MapEvent[] {
  const out: MapEvent[] = [];
  for (const s of run.steps) {
    let node: string | null = null;
    let kind: ActKind | null = null;
    if ((s.kind === "read" || s.kind === "edit") && s.file) { node = nodeForFile(map, s.file); kind = s.kind; }
    else if (s.kind === "search") { const m = / in (\S+)$/.exec(s.title); node = m ? nodeForFile(map, m[1]! + "/") : null; kind = "search"; }
    else if (s.kind === "command") { node = commandNode(map, s.title); kind = "command"; }
    if (node && kind) out.push({ i: out.length, node, kind, title: s.title });
  }
  return out;
}

/** Organisers' branches have no transcript: replay the change file by file. */
export function eventsFromReceipt(map: RepoMap, r: Receipt): MapEvent[] {
  const out: MapEvent[] = [];
  const order = (c: string) => ({ source: 0, template: 1, test: 2, docs: 3, generated: 4 } as Record<string, number>)[c] ?? 5;
  for (const f of [...r.files].sort((a, b) => order(a.cls) - order(b.cls))) {
    if (f.cls === "generated" || f.cls === "docs" || f.cls === "build") continue;
    const node = nodeForFile(map, f.path);
    if (node) out.push({ i: out.length, node, kind: "edit", title: `${f.status === "A" ? "Add" : "Edit"} ${f.path}` });
  }
  return out;
}

export interface FinalState { changed: Set<string>; flagged: Set<string>; added: Set<string>; lines: Map<string, number> }

export function finalState(map: RepoMap, r: Receipt | null): FinalState {
  const st: FinalState = { changed: new Set(), flagged: new Set(), added: new Set(), lines: new Map() };
  if (!r) return st;
  for (const m of r.members) {
    const n = nodeForMember(map, m.key) ?? nodeForFile(map, m.file);
    if (!n) continue;
    st.changed.add(n);
    if (m.flags.length) st.flagged.add(n);
    st.lines.set(n, (st.lines.get(n) ?? 0) + m.changedLines);
  }
  for (const f of r.files) {
    if (f.status !== "A" || f.cls === "generated") continue;
    const n = nodeForFile(map, f.path);
    if (n) st.added.add(n);
  }
  return st;
}
