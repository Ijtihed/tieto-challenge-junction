// Builds an evidence receipt for one agent-written change.
// Every claim carries the evidence that decided it and which engine decided it.
// Anything the engine cannot decide from evidence is listed as a refusal and routed to the owner.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CsGraph, CsMemberChange, CsFileChange } from "../extractors/extractor-csharp/sidecar.ts";
import { astDiff, headGraph, lineDiff, revParse, type LineDiff } from "./git.ts";
import { JUNCTION_DIR, readAreas, loadJson, type AreaBook } from "./ledger.ts";
import { csNodeId } from "../extractors/extractor-csharp/index.ts";
import { loadCi } from "./ci.ts";
import { decide, decisionsKey, questionKey } from "./decisions.ts";
import { git } from "./git.ts";

export interface Requirement {
  id: string; title: string; source: string; branch: string; kind: string; intent: string;
  functional: string[]; nonFunctional: string[]; expectedScope: string[];
}

interface PolicyArea { id: string; name: string; paths: string[]; weight: number; why: string }
interface Policy {
  tiers: { id: string; maxScore: number; label: string; meaning: string }[];
  areas: PolicyArea[];
  silencingPatterns: { id: string; regex: string; why: string }[];
  earnedTrust: { cleanSignoffsToEarn: number; note: string };
}

export type FileClass = "source" | "test" | "generated" | "docs" | "template" | "build" | "other";
export type ClaimStatus = "verified" | "contradicted" | "partial" | "unverified" | "heuristic";
export type Engine = "roslyn-ast" | "schema-graph" | "git" | "policy" | "requirement" | "test-run" | "llm" | "gemini-decision";

export interface Evidence { label: string; ref?: string | undefined; detail?: string | undefined }
export interface Claim { id: string; text: string; status: ClaimStatus; decidedBy: Engine; evidence: Evidence[] }
export interface Refusal { question: string; why: string; evidence: Evidence[]; routeTo: string }
export interface RiskFactor { id: string; label: string; points: number; evidence: Evidence[] }

export interface TestPath { test: string; path: string[]; pathKeys: string[]; isNew: boolean }
export interface ReviewedMember {
  key: string; nodeId: string; name: string; csKind: string; file: string; changes: string[]; changedLines: number;
  publicApi: boolean; directCallers: number; transitiveCallers: number;
  tests: TestPath[]; flags: string[]; before?: CsMemberChange["before"]; after?: CsMemberChange["after"];
}
export interface ReviewedFile extends CsFileChange { cls: FileClass; inScope: boolean; areas: string[] }

export interface Receipt {
  id: string; generatedAt: string; engineVersion: string; branch: string;
  requirement: Requirement;
  repo: string; baseSha: string; headSha: string; graphStats: Record<string, number>;
  story: string[];
  summary: {
    files: number; added: number; deleted: number;
    byClass: Record<string, { files: number; lines: number }>;
    readLines: number; totalLines: number;
  };
  files: ReviewedFile[];
  members: ReviewedMember[];
  newTests: { key: string; file: string; reaches: string[] }[];
  claims: Claim[];
  refusals: Refusal[];
  risk: { score: number; factors: RiskFactor[]; baseTier: string; tier: string; tierLabel: string; tierMeaning: string; trustAdjustments: string[] };
  readList: { key: string; file: string; startLine: number; endLine: number; why: string[] }[];
  checked: { what: string; by: Engine }[];
  notChecked: { what: string; why: string }[];
  areas: string[];
}

const ENGINE_VERSION = "earned-trust/0.1";

export function loadRequirement(id: string): Requirement {
  return JSON.parse(readFileSync(join(JUNCTION_DIR, "requirements", `${id}.json`), "utf8")) as Requirement;
}

function loadPolicy(): Policy {
  return JSON.parse(readFileSync(join(JUNCTION_DIR, "policy.json"), "utf8")) as Policy;
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

const matchesAny = (path: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(path));

function classify(f: CsFileChange): FileClass {
  // A newly added generated file under tests is an expected-output fixture, not an edit to generated code.
  if (f.generated && f.status === "A" && f.isTest) return "test";
  if (f.generated) return "generated";
  if (/\.tt$/i.test(f.path)) return "template";
  if (/\.(md|txt)$/i.test(f.path)) return "docs";
  if (/\.(csproj|props|targets|sln|json|ya?ml|editorconfig)$/i.test(f.path)) return "build";
  if (f.isCs) return f.isTest ? "test" : "source";
  return "other";
}

function splitWords(s: string): string[] {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

const STOP = new Set(["the", "and", "for", "with", "when", "does", "not", "from", "that", "this", "are", "has", "its", "get", "gets", "all", "every", "same", "input"]);

interface GraphIndex {
  byKey: Map<string, CsGraph["nodes"][number]>;
  reverse: Map<string, Set<string>>;
}

function indexGraph(g: CsGraph): GraphIndex {
  const byKey = new Map(g.nodes.map((n) => [n.key, n] as const));
  const reverse = new Map<string, Set<string>>();
  for (const e of g.edges) {
    if (e.relation === "declares") continue;
    let s = reverse.get(e.target);
    if (!s) reverse.set(e.target, (s = new Set()));
    s.add(e.source);
  }
  return { byKey, reverse };
}

/** Reverse BFS from a changed member: who reaches it, and which tests do. */
function reach(idx: GraphIndex, key: string, maxDepth: number) {
  const parent = new Map<string, string | null>([[key, null]]);
  let frontier = [key];
  let within3 = 0;
  const tests: string[] = [];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const k of frontier) {
      for (const src of idx.reverse.get(k) ?? []) {
        if (parent.has(src)) continue;
        parent.set(src, k);
        next.push(src);
        if (depth <= 3) within3++;
        const n = idx.byKey.get(src);
        if (n?.isTest && n.csKind === "method") tests.push(src);
      }
    }
    frontier = next;
  }
  const pathOf = (t: string) => {
    const p: string[] = [];
    for (let k: string | null | undefined = t; k; k = parent.get(k)) p.push(k);
    return p;
  };
  return { direct: idx.reverse.get(key)?.size ?? 0, within3, tests, pathOf };
}

/** "Ns.Type.Member(A,B)" -> { type: "Ns.Type", member: "Member" } (handles ".ctor"). */
export function splitKey(key: string): { type: string; member: string } {
  const noParams = key.replace(/\(.*\)$/, "");
  const ctor = noParams.match(/^(.*)\.(\.c?ctor)$/);
  if (ctor) return { type: ctor[1]!, member: ctor[2]!.slice(1) };
  const i = noParams.lastIndexOf(".");
  return i < 0 ? { type: "", member: noParams } : { type: noParams.slice(0, i), member: noParams.slice(i + 1) };
}
const typeName = (key: string) => splitKey(key).type.split(".").pop() ?? "";
export const short = (key: string) => {
  const { type, member } = splitKey(key);
  const t = type.split(".").pop();
  return t ? `${t}.${member}` : member;
};

export async function buildReceipt(opts: { repo: string; requirementId: string; base?: string | undefined; head?: string | undefined; branch?: string | undefined }): Promise<Receipt> {
  const req = loadRequirement(opts.requirementId);
  const policy = loadPolicy();
  const headRef = opts.head ?? `origin/${req.branch}`;
  const headSha = await revParse(opts.repo, headRef);
  const baseSha = await revParse(opts.repo, opts.base ?? `${headSha}~1`);

  const [diff, graph, lines] = await Promise.all([
    astDiff(opts.repo, baseSha, headSha),
    headGraph(opts.repo, headSha),
    lineDiff(opts.repo, baseSha, headSha),
  ]);
  const idx = indexGraph(graph);

  // ---- files
  const files: ReviewedFile[] = diff.files.map((f) => ({
    ...f,
    cls: classify(f),
    inScope: f.generated || matchesAny(f.path, req.expectedScope),
    areas: policy.areas.filter((a) => matchesAny(f.path, a.paths)).map((a) => a.id),
  }));
  for (const f of files) {
    if (f.isCs && files.some((t) => t.path === f.path.replace(/\.cs$/i, ".tt"))) f.cls = "template";
  }
  const changedLinesIn = (file: string, before?: { startLine: number; endLine: number }, after?: { startLine: number; endLine: number }) => {
    const d = lines.get(file);
    if (!d) return 0;
    const inR = (n: number, r?: { startLine: number; endLine: number }) => !!r && n >= r.startLine && n <= r.endLine;
    return d.addedAt.filter((n) => inR(n, after)).length + d.removedAt.filter((n) => inR(n, before)).length;
  };
  const byClass: Receipt["summary"]["byClass"] = {};
  for (const f of files) {
    const c = (byClass[f.cls] ??= { files: 0, lines: 0 });
    c.files++; c.lines += f.added + f.deleted;
  }
  const totalLines = files.reduce((s, f) => s + f.added + f.deleted, 0);
  const touchedAreas = [...new Set(files.flatMap((f) => (f.cls === "source" || f.cls === "template" ? f.areas : [])))];
  const areaIds = touchedAreas.length ? touchedAreas : [...new Set(files.filter((f) => f.cls === "source").map((f) => f.path.split("/").slice(0, 2).join("/")))];

  // ---- members
  const newTestKeys = new Set(diff.members.filter((m) => m.isTest && m.csKind === "method" && m.changes.includes("added")).map((m) => m.key));
  const logic = diff.members.filter((m) => !m.isTest && !files.find((f) => f.path === m.file)?.generated);
  const members: ReviewedMember[] = logic.map((m) => {
    const r = idx.byKey.has(m.key) ? reach(idx, m.key, 10) : null;
    const tests = (r?.tests ?? [])
      .map((t) => { const keys = r!.pathOf(t); return { test: t, path: keys.map(short), pathKeys: keys, isNew: newTestKeys.has(t) }; })
      .sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.path.length - b.path.length)
      .slice(0, 5);
    const publicApi = m.publicApiBefore || m.publicApiAfter;
    const flags: string[] = [];
    if (publicApi && m.changes.some((c) => ["added", "removed", "signature", "accessibility", "attributes"].includes(c))) flags.push("public-api");
    if (!tests.length && m.changes.some((c) => c !== "trivia-only")) flags.push("untested");
    return {
      key: m.key, nodeId: csNodeId(m.key, opts.repo), name: m.name, csKind: m.csKind, file: m.file, changes: m.changes, publicApi,
      changedLines: changedLinesIn(m.file, m.before, m.after),
      directCallers: r?.direct ?? 0, transitiveCallers: r?.within3 ?? 0, tests, flags, before: m.before, after: m.after,
    };
  });
  const newTests = [...newTestKeys].map((k) => {
    const m = diff.members.find((x) => x.key === k)!;
    const reaches = members.filter((mm) => mm.tests.some((t) => t.test === k)).map((mm) => short(mm.key));
    return { key: k, file: m.file, reaches };
  });

  // ---- silencing patterns on added lines of authored code
  const silencing: { pattern: Policy["silencingPatterns"][number]; file: string; line: string; member?: string | undefined }[] = [];
  for (const f of files.filter((x) => x.cls === "source" || x.cls === "template")) {
    const added = lines.get(f.path)?.added ?? [];
    for (const p of policy.silencingPatterns) {
      const re = new RegExp(p.regex, "i");
      for (const l of added) {
        if (!re.test(l)) continue;
        const member = members.find((m) => m.file === f.path && m.after?.text.includes(l.trim()));
        silencing.push({ pattern: p, file: f.path, line: l.trim(), member: member?.key });
        if (member && !member.flags.includes("silencing")) member.flags.push("silencing");
      }
    }
  }

  // ---- generated-file uniformity
  // Each generated file's edit is reduced to a signature (its set of distinct changed lines).
  // Files sharing the dominant signature are cleared mechanically; the rest are outliers.
  const genFiles = files.filter((f) => f.cls === "generated");
  const sigOf = (d?: LineDiff) => {
    const norm = (xs: string[]) => [...new Set(xs.map((l) => l.trim()).filter(Boolean))].sort();
    return JSON.stringify([norm(d?.added ?? []).map((l) => "+" + l), norm(d?.removed ?? []).map((l) => "-" + l)].flat());
  };
  const sigGroups = new Map<string, ReviewedFile[]>();
  for (const f of genFiles) {
    const k = sigOf(lines.get(f.path));
    sigGroups.set(k, [...(sigGroups.get(k) ?? []), f]);
  }
  const ranked = [...sigGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  const dominant = ranked[0];
  const genOutliers = ranked.slice(1).flatMap(([, fs]) => fs);
  const genPatterns: string[] = dominant ? (JSON.parse(dominant[0]) as string[]) : [];
  const genUniform = genFiles.length > 0 && genOutliers.length === 0;

  // ---- T4 template pairing
  const templates = files.filter((f) => f.cls === "template");
  const unpaired = templates.filter((t) => !files.some((f) => f.path === t.path.replace(/\.tt$/i, ".cs")));

  // ---- requirement traceability (keyword overlap, reported as heuristic)
  const testNames = [...newTestKeys, ...diff.members.filter((m) => m.isTest).map((m) => m.key)];
  const trace = req.functional.map((fr) => {
    const words = new Set(splitWords(fr).filter((w) => !STOP.has(w)));
    let best = { key: "", score: 0 };
    for (const t of new Set(testNames)) {
      const tw = new Set(splitWords(t.split(".").slice(-2).join(" ")));
      const score = [...words].filter((w) => tw.has(w)).length;
      if (score > best.score) best = { key: t, score };
    }
    return { fr, best, p: undefined as number | undefined, confidence: undefined as number | undefined };
  });
  // With a Gemini key, the Decisions API judges each requirement line against the actual diff.
  let traceModel: string | null = null;
  if (decisionsKey() && trace.length) {
    try {
      const diffText = await git(opts.repo, "diff", baseSha, headSha, "--", "src", "tests", ":(exclude)*.g.cs");
      const input = [`Requirement ${req.id}: ${req.title}`, req.intent, "", "Diff:", diffText.slice(0, 400_000)].join("\n");
      const qs = Object.fromEntries(trace.map((t, i) => [questionKey(i, "req"), {
        type: "noul" as const,
        instructions: `Does this diff implement the requirement "${t.fr}", including a test that would catch a regression?`,
        criteria: { true_description: "The diff implements it and tests it.", false_description: "The diff does not implement it, or leaves it untested." },
      }]));
      const r = await decide(input, qs);
      trace.forEach((t, i) => {
        const a = r.answers[questionKey(i, "req")];
        if (a?.type === "noul") { t.p = a.noul; t.confidence = a.confidence; }
      });
      traceModel = r.model;
    } catch { /* keep the word-overlap trace */ }
  }

  // ---- test runs (recorded by trust.run_tests, if any)
  const run = loadJson<{ passed: number; failed: number; filter: string; at: string; failures: string[] }>(`test-runs/${headSha}.json`);

  // ---- claims
  const claims: Claim[] = [];
  const outOfScope = files.filter((f) => !f.inScope);
  claims.push({
    id: "scope", decidedBy: "requirement",
    text: `Every changed file is inside the expected scope of ${req.id}.`,
    status: outOfScope.length ? "contradicted" : "verified",
    evidence: outOfScope.length
      ? outOfScope.map((f) => ({ label: "outside scope", ref: f.path }))
      : [{ label: `${files.length} files match`, detail: req.expectedScope.join(", ") }],
  });
  const apiMembers = members.filter((m) => m.flags.includes("public-api"));
  claims.push({
    id: "public-api", decidedBy: "roslyn-ast",
    text: "No public API is added, removed or changed.",
    status: apiMembers.length ? "contradicted" : "verified",
    evidence: apiMembers.length
      ? apiMembers.map((m) => ({ label: m.changes.join("+"), ref: m.key, detail: m.after?.signature ?? m.before?.signature }))
      : [{ label: "accessibility of every changed member", detail: members.map((m) => `${short(m.key)}: ${m.after?.accessibility ?? m.before?.accessibility}`).join("; ") || "no members changed" }],
  });
  const behaviourMembers = members.filter((m) => m.changes.some((c) => c !== "trivia-only" && c !== "removed"));
  const untested = behaviourMembers.filter((m) => !m.tests.length);
  claims.push({
    id: "tests-reach", decidedBy: "schema-graph",
    text: "Every changed member is reached by at least one test in the call graph.",
    status: !behaviourMembers.length ? "verified" : untested.length === 0 ? "verified" : untested.length < behaviourMembers.length ? "partial" : "contradicted",
    evidence: [
      ...behaviourMembers.filter((m) => m.tests.length).map((m) => ({ label: "reached", ref: m.key, detail: m.tests[0]!.path.join(" → ") })),
      ...untested.map((m) => ({ label: "no test reaches", ref: m.key })),
    ],
  });
  claims.push({
    id: "adds-tests", decidedBy: "roslyn-ast",
    text: "The change adds tests for its own behaviour.",
    status: newTests.length === 0 ? "contradicted" : newTests.some((t) => t.reaches.length) ? "verified" : "partial",
    evidence: newTests.length
      ? newTests.map((t) => ({ label: t.reaches.length ? `reaches ${t.reaches.join(", ")}` : "reaches no changed member", ref: t.key }))
      : [{ label: "no test methods added" }],
  });
  if (genFiles.length) {
    claims.push({
      id: "generated-uniform", decidedBy: "git",
      text: `All ${genFiles.length} generated files differ only by the same mechanical edit.`,
      status: genUniform ? "verified" : genOutliers.length < genFiles.length / 2 ? "partial" : "contradicted",
      evidence: [
        { label: `${dominant?.[1].length ?? 0} of ${genFiles.length} files share this exact edit`, detail: genPatterns.slice(0, 6).join("\n") },
        ...genOutliers.slice(0, 10).map((f) => ({ label: "different edit", ref: f.path, detail: sigOf(lines.get(f.path)).slice(0, 400) })),
      ],
    });
  }
  if (templates.length) {
    claims.push({
      id: "templates-paired", decidedBy: "git",
      text: "Every edited T4 template (.tt) was regenerated into its compiled .cs.",
      status: unpaired.length ? "contradicted" : "verified",
      evidence: unpaired.length
        ? unpaired.map((t) => ({ label: "template changed, compiled .cs not", ref: t.path }))
        : templates.map((t) => ({ label: "paired", ref: t.path })),
    });
  }
  claims.push({
    id: "no-silencing", decidedBy: "policy",
    text: "No added code drops, suppresses or swallows anything.",
    status: silencing.length ? "contradicted" : "verified",
    evidence: silencing.length
      ? silencing.map((s) => ({ label: s.pattern.id, ref: s.member ?? s.file, detail: s.line }))
      : [{ label: "patterns checked", detail: policy.silencingPatterns.map((p) => p.id).join(", ") }],
  });
  for (const [i, t] of trace.entries()) {
    if (traceModel && t.p !== undefined) {
      claims.push({
        id: `req-${i + 1}`, decidedBy: "gemini-decision",
        text: `Requirement: "${t.fr}" is implemented and tested.`,
        // A calibrated model judgement is still a judgement: never "verified".
        status: t.p >= 0.8 && (t.confidence ?? 0) >= 0.6 ? "heuristic" : "unverified",
        evidence: [{ label: `${traceModel}: p=${t.p.toFixed(2)}, confidence ${(t.confidence ?? 0).toFixed(2)}` }, ...(t.best.score ? [{ label: "closest test by name", ref: t.best.key }] : [])],
      });
      continue;
    }
    claims.push({
      id: `req-${i + 1}`, decidedBy: "requirement",
      text: `Requirement: "${t.fr}" has a matching test.`,
      status: t.best.score >= 2 ? "heuristic" : "unverified",
      evidence: t.best.score ? [{ label: `best name match (${t.best.score} shared words)`, ref: t.best.key }] : [{ label: "no test name matches; owner must map this by hand" }],
    });
  }
  claims.push({
    id: "tests-pass", decidedBy: "test-run",
    text: "The tests that reach this change pass.",
    status: !run ? "unverified" : run.failed ? "contradicted" : "verified",
    evidence: run
      ? [{ label: `${run.passed} passed, ${run.failed} failed`, detail: `filter: ${run.filter} · ${run.at}` }, ...run.failures.map((f) => ({ label: "failed", ref: f }))]
      : [{ label: "not run yet", detail: "run trust.run_tests to record a result" }],
  });

  // ---- CI (local runner now; CRACI when SCHEMA_CI=craci)
  const ci = loadCi(headSha);
  claims.push({
    id: "ci", decidedBy: "test-run",
    text: `CI build and tests pass${ci ? ` (${ci.provider})` : ""}.`,
    status: !ci ? "unverified" : ci.steps.filter((x) => x.name.startsWith("build") || x.name.startsWith("test") || x.name.startsWith("CRACI")).every((x) => x.ok) ? "verified" : "contradicted",
    evidence: ci ? ci.steps.map((x) => ({ label: `${x.ok ? "passed" : "failed"}: ${x.name}${x.seconds ? ` (${x.seconds}s)` : ""}`, detail: x.ok ? undefined : x.log.slice(-1200) })) : [{ label: "no CI result for this commit yet" }],
  });
  if (ci?.sbom) {
    claims.push({
      id: "supply-chain", decidedBy: "test-run",
      text: "The change introduces no known-vulnerable packages.",
      status: ci.scanAnswered === false ? "unverified" : ci.vulnerabilities.some((v) => !v.preExisting) ? "contradicted" : "verified",
      evidence: [
        { label: `SBOM recorded: ${ci.sbom.packages.length} packages (${ci.sbom.format})`, ref: ci.sbom.path },
        ...ci.vulnerabilities.map((v) => ({ label: `${v.preExisting ? "pre-existing" : "INTRODUCED"} · ${v.severity}: ${v.package} ${v.version}`, detail: v.advisory })),
      ],
    });
  }

  // ---- refusals: questions the engine will not answer from evidence
  const refusals: Refusal[] = [];
  const bySilencedMember = new Map<string, typeof silencing>();
  for (const s of silencing) {
    const k = s.member ?? s.file;
    bySilencedMember.set(k, [...(bySilencedMember.get(k) ?? []), s]);
  }
  for (const [k, hits] of bySilencedMember) {
    refusals.push({
      question: `Is it intended that ${short(k)} now drops or suppresses something that used to happen?`,
      why: `${req.id} does not ask for anything to be dropped. Whether removing behaviour is acceptable is an intent decision, not something the code can prove.`,
      evidence: hits.map((h) => ({ label: h.pattern.why, ref: h.file, detail: h.line })),
      routeTo: "change owner",
    });
  }
  const securityTouched = files.some((f) => f.areas.includes("security") && (f.cls === "source" || f.cls === "template"));
  if (securityTouched && !(ci?.passed)) {
    refusals.push({
      question: "This change touches security-sensitive code (untrusted deserialization or dynamic code emission) without a passing CI build. Accept anyway?",
      why: "Security-area changes need a green CI run (CRACI adds an SBOM, egress policy and CVE checks) before the engine treats them as reviewable.",
      evidence: files.filter((f) => f.areas.includes("security")).map((f) => ({ label: "security area", ref: f.path })),
      routeTo: "change owner + security",
    });
  }
  if (apiMembers.length) {
    refusals.push({
      question: `Is the new or changed public API (${apiMembers.slice(0, 4).map((m) => short(m.key)).join(", ")}${apiMembers.length > 4 ? ", …" : ""}) the right shape to commit to?`,
      why: "Public names and signatures are a long-term promise to users. Naming, versioning and support cost are product decisions.",
      evidence: apiMembers.slice(0, 8).map((m) => ({ label: m.changes.join("+"), ref: m.key, detail: m.after?.signature })),
      routeTo: "change owner + maintainers",
    });
  }
  for (const t of trace.filter((x) => (traceModel && x.p !== undefined ? !(x.p >= 0.8 && (x.confidence ?? 0) >= 0.6) : x.best.score < 2))) {
    refusals.push({
      question: `Does the change satisfy "${t.fr}"?`,
      why: traceModel && t.p !== undefined
        ? `${traceModel} was not confident it does (p=${t.p.toFixed(2)}, confidence ${(t.confidence ?? 0).toFixed(2)}). A model's guess is not evidence; the owner decides.`
        : "No test can be traced to this requirement line. The engine will not infer it from code alone.",
      evidence: [], routeTo: "change owner",
    });
  }

  // ---- risk
  const factors: RiskFactor[] = [];
  if (apiMembers.length) factors.push({ id: "public-api", label: "Public API surface changes", points: 3, evidence: apiMembers.map((m) => ({ label: m.changes.join("+"), ref: m.key })) });
  for (const a of policy.areas.filter((a) => touchedAreas.includes(a.id))) {
    factors.push({ id: `area:${a.id}`, label: `Touches ${a.name}`, points: a.weight, evidence: [{ label: a.why }, ...files.filter((f) => f.areas.includes(a.id) && (f.cls === "source" || f.cls === "template")).slice(0, 6).map((f) => ({ label: "file", ref: f.path }))] });
  }
  const maxFanIn = Math.max(0, ...members.map((m) => m.directCallers));
  if (maxFanIn > 8) {
    const top = [...members].sort((a, b) => b.directCallers - a.directCallers)[0]!;
    factors.push({ id: "fan-in", label: `Changed member has ${maxFanIn} direct callers`, points: maxFanIn > 25 ? 2 : 1, evidence: [{ label: "highest fan-in", ref: top.key, detail: `${top.transitiveCallers} callers within 3 hops` }] });
  }
  if (untested.length) factors.push({ id: "untested", label: `${untested.length} changed member(s) not reached by any test`, points: 2, evidence: untested.map((m) => ({ label: "untested", ref: m.key })) });
  if (silencing.length) factors.push({ id: "silencing", label: "Adds code that drops or suppresses behaviour", points: 2, evidence: silencing.slice(0, 5).map((s) => ({ label: s.pattern.id, ref: s.file, detail: s.line })) });
  if (outOfScope.length) factors.push({ id: "scope", label: `${outOfScope.length} file(s) outside requirement scope`, points: Math.min(3, outOfScope.length), evidence: outOfScope.map((f) => ({ label: "out of scope", ref: f.path })) });
  if (unpaired.length) factors.push({ id: "template-mismatch", label: "Template edited without regenerating its .cs", points: 3, evidence: unpaired.map((t) => ({ label: "unpaired", ref: t.path })) });
  if (genOutliers.length) factors.push({ id: "generated-outliers", label: `${genOutliers.length} generated file(s) deviate from the common edit`, points: genOutliers.length > 3 ? 2 : 1, evidence: genOutliers.slice(0, 6).map((f) => ({ label: "outlier", ref: f.path })) });
  const authored = (byClass.source?.lines ?? 0) + (byClass.template?.lines ?? 0);
  if (authored > 100) factors.push({ id: "size", label: `${authored} authored lines changed (excl. tests/generated)`, points: authored > 300 ? 2 : 1, evidence: [] });
  if (ci && !ci.passed) factors.push({ id: "ci-failing", label: `CI failing on ${ci.provider}`, points: 10, evidence: ci.steps.filter((x) => !x.ok).map((x) => ({ label: x.name })) });
  const newVulns = ci?.vulnerabilities.filter((v) => !v.preExisting) ?? [];
  if (newVulns.length) factors.push({ id: "vulnerable-deps", label: `${newVulns.length} newly introduced vulnerable package(s)`, points: 4, evidence: newVulns.map((v) => ({ label: `${v.severity}: ${v.package} ${v.version}` })) });
  if (run?.failed) factors.push({ id: "tests-failing", label: `${run.failed} test(s) failing`, points: 10, evidence: run.failures.map((f) => ({ label: "failed", ref: f })) });

  const score = factors.reduce((s, f) => s + f.points, 0);
  const tierIdx = policy.tiers.findIndex((t) => score <= t.maxScore);
  let finalIdx = tierIdx;
  const adjustments: string[] = [];
  const book: AreaBook = readAreas();
  const n = policy.earnedTrust.cleanSignoffsToEarn;
  const withdrawn = areaIds.filter((a) => (book[a]?.escapes.length ?? 0) > 0 && (book[a]?.cleanStreak ?? 0) < n);
  if (withdrawn.length) {
    finalIdx = policy.tiers.length - 1;
    adjustments.push(`Trust withdrawn in ${withdrawn.join(", ")} after an escape; full read until ${n} clean sign-offs.`);
  } else if (areaIds.length && areaIds.every((a) => (book[a]?.cleanStreak ?? 0) >= n) && finalIdx > 0) {
    finalIdx--;
    adjustments.push(`Trust earned in ${areaIds.join(", ")} (${n}+ clean sign-offs, no escapes): one tier lighter.`);
  }
  const baseTier = policy.tiers[tierIdx]!;
  const tier = policy.tiers[finalIdx]!;

  // ---- what the owner must read
  // Changed members that call a flagged member inherit its reason ("wires in ...").
  const outEdges = new Map<string, Set<string>>();
  for (const e of graph.edges) if (e.relation !== "declares") (outEdges.get(e.source) ?? outEdges.set(e.source, new Set()).get(e.source)!).add(e.target);
  for (const m of members) {
    for (const f of members.filter((x) => x !== m && x.flags.includes("silencing"))) {
      if (outEdges.get(m.key)?.has(f.key) && !m.flags.includes(`wires-in:${short(f.key)}`)) m.flags.push(`wires-in:${short(f.key)}`);
    }
  }
  const readList = members
    .filter((m) => tier.id !== "light" || m.flags.length > 0 || m.publicApi || m.directCallers > 8)
    .filter((m) => m.changes.some((c) => c !== "trivia-only"))
    .sort((a, b) => b.flags.length - a.flags.length)
    .map((m) => ({
      key: m.key, file: m.file,
      startLine: m.after?.startLine ?? m.before?.startLine ?? 0,
      endLine: m.after?.endLine ?? m.before?.endLine ?? 0,
      why: [
        ...m.flags.map((f) => f.startsWith("wires-in:") ? `applies ${f.slice(9)} to every report` : ({ "public-api": "public API", untested: "no test reaches it", silencing: "drops/suppresses behaviour" } as Record<string, string>)[f] ?? f),
        ...(m.directCallers > 8 ? [`${m.directCallers} callers`] : []),
        ...(!m.flags.length ? [m.changes.includes("added") ? "new logic" : "changed logic"] : []),
      ],
    }));
  for (const t of unpaired) readList.push({ key: t.path, file: t.path, startLine: 1, endLine: 1, why: ["template not regenerated"] });
  if (tier.id !== "light") {
    for (const t of templates.filter((f) => /\.tt$/i.test(f.path))) readList.push({ key: t.path, file: t.path, startLine: 1, endLine: 1, why: ["template edit changes generated code"] });
  }
  for (const f of outOfScope) readList.push({ key: f.path, file: f.path, startLine: 1, endLine: 1, why: [`outside ${req.id} scope`] });
  if (tier.id === "light" && !readList.some((r) => members.some((m) => m.key === r.key))) {
    const top = [...members].filter((m) => m.changes.some((c) => c !== "trivia-only")).sort((a, b) => b.changedLines - a.changedLines)[0];
    if (top) readList.unshift({ key: top.key, file: top.file, startLine: top.after?.startLine ?? 0, endLine: top.after?.endLine ?? 0, why: ["spot check (light tier)"] });
  }
  for (const g of genOutliers) readList.push({ key: g.path, file: g.path, startLine: 1, endLine: 1, why: ["generated file deviates from the common edit"] });
  const readLines = readList.reduce((s, r) => {
    const m = members.find((x) => x.key === r.key);
    const f = files.find((x) => x.path === r.key);
    return s + (m ? m.changedLines : f ? f.added + f.deleted : 0);
  }, 0);

  // ---- story (deterministic; an LLM narrative can replace it, claims stay)
  const story: string[] = [];
  const TYPE_KINDS = new Set(["class", "interface", "struct", "record", "record struct", "enum"]);
  const typesTouched = [...new Set(members.map((m) => (TYPE_KINDS.has(m.csKind) ? m.name : typeName(m.key))))];
  story.push(`${req.id} (${req.kind}): ${req.title}.`);
  story.push(`The agent changed ${members.length} member(s) across ${typesTouched.length} type(s)${typesTouched.length ? ` (${typesTouched.slice(0, 4).join(", ")}${typesTouched.length > 4 ? ", …" : ""})` : ""}` +
    ` and added ${newTests.length} test(s).`);
  const kinds = Object.entries(byClass).map(([k, v]) => `${v.files} ${k}`).join(", ");
  story.push(`${files.length} files changed: ${kinds}.`);
  if (genFiles.length) story.push(`${dominant?.[1].length ?? 0} of ${genFiles.length} generated files carry the identical ${genPatterns.length}-line edit and are cleared mechanically${genOutliers.length ? `; ${genOutliers.length} deviate and go to the owner` : ""}.`);
  if (silencing.length) story.push(`It adds logic that drops or suppresses something (${silencing.length} hit(s)); the engine refuses to decide whether that is intended.`);
  if (apiMembers.length) story.push(`It changes public API (${apiMembers.length} member(s)).`);
  story.push(`Risk score ${score} → ${tier.label}${tier.id !== baseTier.id ? ` (base: ${baseTier.label})` : ""}. Owner reads ${readLines} of ${totalLines} changed lines.`);

  const checked: Receipt["checked"] = [
    { what: `Member-level AST diff of ${files.filter((f) => f.isCs).length} C# files (whitespace/comment-only edits separated)`, by: "roslyn-ast" },
    { what: `Call-graph reachability over ${graph.stats.nodes} symbols / ${graph.stats.edges} edges at ${headSha.slice(0, 8)}`, by: "schema-graph" },
    { what: `Scope against ${req.id} expected paths`, by: "requirement" },
    { what: `Silencing patterns on ${files.filter((f) => f.cls === "source" || f.cls === "template").length} authored files`, by: "policy" },
  ];
  if (genFiles.length) checked.push({ what: `Uniformity of ${genFiles.length} generated files`, by: "git" });
  if (run) checked.push({ what: `Test run (${run.filter})`, by: "test-run" });
  const notChecked: Receipt["notChecked"] = [
    ...(run ? [] : [{ what: "Test execution", why: "No test run recorded for this commit." }]),
    ...(ci && !ci.egress.enforced ? [{ what: "Network egress during the build", why: ci.egress.note }] : []),
    { what: "Performance", why: "No benchmark is run; MessagePack has BenchmarkDotNet suites, but not in the review loop." },
    { what: "Behaviour in trimmed / NativeAOT apps", why: "Requires a publish + run outside this engine." },
    { what: "Call edges through reflection or generated code not in the repo", why: "The static graph only sees source; name-resolved edges are marked lower confidence." },
    ...refusals.map((r) => ({ what: r.question, why: "Refused by the engine: " + r.why })),
  ];

  return {
    id: `${req.id}@${headSha.slice(0, 8)}`, generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
    branch: opts.branch ?? req.branch,
    requirement: req, repo: opts.repo, baseSha, headSha, graphStats: graph.stats,
    story,
    summary: { files: files.length, added: files.reduce((s, f) => s + f.added, 0), deleted: files.reduce((s, f) => s + f.deleted, 0), byClass, readLines, totalLines },
    files, members, newTests, claims, refusals,
    risk: { score, factors, baseTier: baseTier.id, tier: tier.id, tierLabel: tier.label, tierMeaning: tier.meaning, trustAdjustments: adjustments },
    readList, checked, notChecked, areas: areaIds,
  };
}
