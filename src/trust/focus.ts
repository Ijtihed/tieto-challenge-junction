// "Where to look" brief for the coding agent, built from Schema's graph before the agent starts.
// A cheap decision model picks the components; the graph expands them into files, connections and tests.
//   gemini (GEMINI_API_KEY set): Gemini Flash ranks the curated map's components for the issue.
//   graph  (always available):   identifiers in the issue are matched against symbol names in the
//                                Roslyn graph, then expanded along callers/callees and test paths.
import type { CsGraph } from "../extractors/extractor-csharp/sidecar.ts";
import type { Requirement } from "./receipt.ts";
import { headGraph, git } from "./git.ts";
import { buildRepoMap, type RepoMap } from "./repomap.ts";
import { decide, decisionsKey, questionKey } from "./decisions.ts";

export interface FocusFile { path: string; score: number; why: string[] }
export interface FocusBrief {
  strategy: "gemini-decision" | "graph";
  model?: string;
  components: { id: string; label: string; module: string; why: string }[];
  files: FocusFile[];
  connections: string[];
  tests: string[];
  skipModules: string[];
  ms: number;
}

const STOP = new Set(["the", "and", "for", "with", "this", "that", "when", "from", "into", "are", "was", "not", "has", "have", "true", "false", "null", "type", "types", "should", "would", "will", "also", "version", "used", "bug", "description", "steps", "expected", "actual", "behavior", "context", "additional"]);

/** Code-like tokens from the issue: identifiers in backticks, PascalCase words, attribute names, diagnostic ids. */
function identifiers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`]{2,80})`/g)) for (const t of m[1]!.split(/[^A-Za-z0-9_]+/)) if (t.length > 3) out.add(t);
  for (const m of text.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+)\b/g)) out.add(m[1]!);
  for (const m of text.matchAll(/\b(MsgPack\d{3}|CS\d{4}|AD\d{4})\b/g)) out.add(m[1]!);
  return [...out].filter((t) => !STOP.has(t.toLowerCase()));
}

const stem = (w: string) => w.toLowerCase().replace(/(ing|ed|es|s)$/, "");
const words = (t: string) => new Set(t.split(/[^A-Za-z]+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())).map(stem));

/** Files that mention the issue's identifiers literally (catches lookups by string name the graph cannot see). */
async function textMentions(repo: string, sha: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of ids.slice(0, 12)) {
    let listing = "";
    try { listing = await git(repo, "grep", "-l", "-w", id, sha, "--", "src/"); } catch { continue; }
    const files = listing.split("\n").filter(Boolean).map((l) => l.replace(`${sha}:`, ""));
    if (files.length > 25) continue;
    for (const f of files) out.set(f, [...(out.get(f) ?? []), id]);
  }
  return out;
}

function graphFocus(g: CsGraph, map: RepoMap, req: Requirement & { issueBody?: string }, mentions: Map<string, string[]>): Omit<FocusBrief, "strategy" | "ms"> {
  const text = `${req.title}\n${req.intent}\n${req.functional.join("\n")}\n${req.issueBody ?? ""}`;
  const ids = identifiers(text);
  const byName = new Map<string, CsGraph["nodes"]>();
  for (const n of g.nodes) {
    if (n.generated || n.file.startsWith("benchmark/") || n.file.startsWith("sandbox/")) continue;
    (byName.get(n.name) ?? byName.set(n.name, []).get(n.name)!).push(n);
  }
  const fileScore = new Map<string, { score: number; why: Set<string> }>();
  const bump = (file: string, s: number, why: string) => {
    const f = fileScore.get(file) ?? fileScore.set(file, { score: 0, why: new Set() }).get(file)!;
    f.score += s; f.why.add(why);
  };
  const hits: CsGraph["nodes"] = [];
  for (const id of ids) {
    const named = byName.get(id) ?? [];
    // Rare names are strong signals; names declared in many places are weak.
    const w = named.length ? 6 / Math.min(6, named.length) : 0;
    for (const n of named) { bump(n.file, n.isTest ? w * 0.5 : w, `declares ${id}`); hits.push(n); }
  }
  // Expand one hop along calls/type references from the matched symbols.
  const keyOf = new Map(g.nodes.map((n) => [n.key, n] as const));
  const hitKeys = new Set(hits.map((h) => h.key));
  for (const e of g.edges) {
    if (e.relation === "declares") continue;
    const s = keyOf.get(e.source); const t = keyOf.get(e.target);
    if (!s || !t || s.file === t.file) continue;
    if (hitKeys.has(e.target) && !s.generated) bump(s.file, s.isTest ? 0.4 : 0.8, `uses ${t.name}`);
    if (hitKeys.has(e.source) && !t.generated) bump(t.file, 0.5, `used by ${s.name}`);
  }
  for (const [f, ids2] of mentions) bump(f, Math.min(4, ids2.length * 1.5), `mentions ${ids2.slice(0, 2).join(", ")}`);
  // Module relevance: the issue's words against each module's name and description.
  const issueWords = words(text);
  const moduleScore = map.groups.map((g2) => {
    const w = words(`${g2.name} ${g2.about}`);
    return { g: g2, score: [...w].filter((x) => issueWords.has(x)).length };
  }).sort((a, b) => b.score - a.score);
  for (const m of moduleScore.filter((x) => x.score >= 2).slice(0, 2)) {
    for (const n of map.nodes.filter((x) => x.group === m.g.id && !x.bucket)) bump(n.file, m.score * 0.9, `in ${m.g.name}`);
  }
  // Requirement scope paths are a weak prior.
  const scopeRe = req.expectedScope.map((g2) => new RegExp("^" + g2.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"));
  for (const [f, v] of fileScore) if (!scopeRe.some((r) => r.test(f))) v.score *= 0.4;

  const ranked = [...fileScore.entries()].sort((a, b) => b[1].score - a[1].score);
  const files = ranked.filter(([f]) => !f.startsWith("tests/")).slice(0, 8).map(([path, v]) => ({ path, score: Math.round(v.score * 10) / 10, why: [...v.why].slice(0, 4) }));
  const tests = ranked.filter(([f]) => f.startsWith("tests/")).slice(0, 4).map(([f]) => f);
  const comps = new Map<string, { id: string; label: string; module: string; why: string }>();
  for (const f of files) {
    const id = map.fileToNode[f.path];
    const n = id ? map.nodes.find((x) => x.id === id) : undefined;
    if (n && !comps.has(n.id)) comps.set(n.id, { id: n.id, label: n.label, module: map.groups.find((x) => x.id === n.group)?.name ?? n.group, why: f.why[0] ?? "" });
  }
  return { components: [...comps.values()], files, tests, ...expand(map, [...comps.keys()]) };
}

function expand(map: RepoMap, compIds: string[]): { connections: string[]; skipModules: string[] } {
  const set = new Set(compIds);
  const connections = map.edges.filter((e) => set.has(e.source) || set.has(e.target)).sort((a, b) => b.weight - a.weight).slice(0, 6).map((e) => e.description ?? `${e.source} → ${e.target}`);
  const touched = new Set(map.nodes.filter((n) => set.has(n.id)).map((n) => n.group));
  const skipModules = map.groups.filter((g) => !touched.has(g.id)).map((g) => g.name);
  return { connections, skipModules };
}

/** One yes/no question per component, answered in a single Decisions API pass with calibrated probabilities. */
async function decisionFocus(map: RepoMap, req: Requirement & { issueBody?: string }): Promise<{ picks: { id: string; p: number; confidence: number }[]; model: string; ms: number }> {
  const comps = map.nodes.filter((n) => !n.bucket);
  const qs: Record<string, { type: "noul"; instructions: string; criteria: { true_description: string; false_description: string } }> = {};
  const keyToId = new Map<string, string>();
  comps.forEach((n, i) => {
    const g = map.groups.find((x) => x.id === n.group);
    const k = questionKey(i, n.label);
    keyToId.set(k, n.id);
    qs[k] = {
      type: "noul",
      instructions: `Will resolving this issue require changing the C# type ${n.label} in ${n.file} (module "${g?.name}": ${g?.about})?`,
      criteria: { true_description: `${n.label} must be edited to fix or implement the issue.`, false_description: `${n.label} can stay unchanged.` },
    };
  });
  const input = [`Issue: ${req.title}`, req.intent, ...req.functional.map((f) => `- ${f}`), "", (req.issueBody ?? "").slice(0, 12_000)].join("\n");
  const r = await decide(input, qs);
  const picks = Object.entries(r.answers)
    .map(([k, a]) => ({ id: keyToId.get(k)!, p: a.type === "noul" ? a.noul : 0, confidence: a.confidence }))
    .filter((x) => x.id)
    .sort((a, b) => b.p - a.p);
  const sure = picks.filter((x) => x.p >= 0.5);
  return { picks: (sure.length ? sure : picks.slice(0, 4)).slice(0, 6), model: r.model, ms: r.ms };
}

export async function buildFocus(repo: string, sha: string, req: Requirement): Promise<FocusBrief> {
  const t0 = Date.now();
  const g = await headGraph(repo, sha);
  const map = buildRepoMap(g, sha, repo.replace(/\/$/, "").split("/").pop() ?? repo);
  const ids = identifiers(`${req.title}\n${req.intent}\n${req.functional.join("\n")}\n${(req as Requirement & { issueBody?: string }).issueBody ?? ""}`);
  const base = graphFocus(g, map, req, await textMentions(repo, sha, ids));
  if (decisionsKey()) {
    try {
      const d = await decisionFocus(map, req);
      if (d.picks.length) {
        const comps = d.picks.map((x) => {
          const n = map.nodes.find((m) => m.id === x.id)!;
          return { id: x.id, label: n.label, module: map.groups.find((g2) => g2.id === n.group)?.name ?? n.group, why: `p=${x.p.toFixed(2)}, confidence ${x.confidence.toFixed(2)}` };
        });
        const files = [
          ...comps.map((c) => ({ path: map.nodes.find((n) => n.id === c.id)!.file, score: 10, why: [`gemini-decision ${c.why}`] })),
          ...base.files.filter((f) => !comps.some((c) => map.nodes.find((n) => n.id === c.id)?.file === f.path)),
        ].slice(0, 8);
        return { strategy: "gemini-decision", model: d.model, components: comps, files, tests: base.tests, ...expand(map, comps.map((c) => c.id)), ms: Date.now() - t0 };
      }
    } catch { /* fall back to the graph ranker */ }
  }
  return { strategy: "graph", ...base, ms: Date.now() - t0 };
}

export function focusMarkdown(f: FocusBrief): string {
  return [
    `## Where to look (Schema graph, ${f.strategy}${f.model ? ` · ${f.model}` : ""})`,
    "Start here instead of searching the whole repo. Treat this as a hint, not a constraint.",
    "", "Files most likely involved:",
    ...f.files.map((x) => `- ${x.path}  (${x.why.join("; ")})`),
    ...(f.tests.length ? ["", "Related tests:", ...f.tests.map((t) => `- ${t}`)] : []),
    ...(f.connections.length ? ["", "Key connections:", ...f.connections.map((c) => `- ${c}`)] : []),
    ...(f.skipModules.length ? ["", `Probably unrelated (skip unless the evidence says otherwise): ${f.skipModules.join(", ")}.`] : []),
  ].join("\n");
}
