// CI for agent changes. Providers share one result shape so the receipt, the agent's
// fix-up loop and the UI don't care where the build ran.
//   local  (default): build + test + SBOM + vulnerable-package scan in the agent's worktree.
//   craci  (SCHEMA_CI=craci): the PR branch runs `.github/workflows/schema-ci.yml` on CRACI
//          runners (`runs-on: craci`); results are read back from GitHub check runs.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { saveJson, loadJson } from "./ledger.ts";

export interface CiStep { name: string; ok: boolean; seconds: number; log: string }
export interface SbomPackage { name: string; version: string }
export interface Vulnerability { package: string; version: string; severity: string; advisory: string; preExisting?: boolean }
export interface CiResult {
  scanAnswered?: boolean;
  provider: string; headSha: string; at: string; passed: boolean; steps: CiStep[];
  sbom: { format: "CycloneDX"; packages: SbomPackage[]; path: string } | null;
  vulnerabilities: Vulnerability[];
  egress: { enforced: boolean; note: string };
  url?: string;
}
export interface CiTarget { worktree: string; headSha: string; filesChanged: string[]; branch: string; baseSha?: string; repo?: string }
export interface CiProvider { id: string; name: string; run(t: CiTarget, onStep: (s: CiStep) => void): Promise<CiResult> }

const DOTNET_ROOT = process.env.DOTNET_ROOT ?? join(homedir(), ".dotnet");

function sh(cwd: string, cmd: string, timeoutMs: number): Promise<{ code: number; out: string; seconds: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env, DOTNET_ROOT, PATH: `${DOTNET_ROOT}:${process.env.PATH ?? ""}`, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
    });
    let out = "";
    const keep = (b: Buffer) => { out += b.toString(); if (out.length > 400_000) out = out.slice(-200_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { child.kill("SIGKILL"); out += `\n[timed out after ${timeoutMs / 1000}s]`; }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out, seconds: Math.round((Date.now() - t0) / 1000) }); });
  });
}

/** Test projects touched by the change; falls back to the source-generator tests. */
function testProjects(files: string[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    const m = /^(tests\/[^/]+)\//.exec(f);
    if (m && !/Resources$/.test(m[1]!)) set.add(m[1]!);
  }
  return set.size ? [...set] : ["tests/MessagePack.SourceGenerator.Tests"];
}

const tail = (s: string, n = 60) => s.split("\n").slice(-n).join("\n");

export interface AffectedTests { projects: string[]; classes: string[]; filter: string | null }

/** Only the tests that reach the change: walk the head graph from changed source files back to test methods. */
export async function affectedTests(t: CiTarget): Promise<AffectedTests> {
  const projects = testProjects(t.filesChanged);
  if (!t.repo) return { projects, classes: [], filter: null };
  const { headGraph } = await import("./git.ts");
  const g = await headGraph(t.repo, t.headSha);
  const changed = new Set(t.filesChanged);
  const byKey = new Map(g.nodes.map((n) => [n.key, n] as const));
  const rev = new Map<string, string[]>();
  for (const e of g.edges) if (e.relation !== "declares") (rev.get(e.target) ?? rev.set(e.target, []).get(e.target)!).push(e.source);
  const owner = new Map<string, string>();
  for (const e of g.edges) if (e.relation === "declares") owner.set(e.target, e.source);
  let frontier = g.nodes.filter((n) => changed.has(n.file) && !n.isTest).map((n) => n.key);
  const seen = new Set(frontier);
  const classes = new Set<string>();
  // Test classes edited by the change always run.
  for (const n of g.nodes) if (changed.has(n.file) && n.isTest && (n.csKind === "class" || n.csKind === "record")) classes.add(n.name.replace(/`\d+$/, ""));
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const next: string[] = [];
    for (const k of frontier) for (const s of rev.get(k) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      const n = byKey.get(s);
      if (n?.isTest && n.csKind === "method") {
        const cls = byKey.get(owner.get(s) ?? "");
        if (cls && projects.some((p) => cls.file.startsWith(p + "/"))) classes.add(cls.name.replace(/`\d+$/, ""));
      } else next.push(s);
    }
    frontier = next.slice(0, 4000);
  }
  const list = [...classes].sort();
  const filter = list.length && list.length <= 40 ? list.map((c) => `FullyQualifiedName~${c}`).join("|") : null;
  return { projects, classes: list, filter };
}

/** Packages the build actually resolved (from NuGet's assets files), as a CycloneDX-shaped SBOM. */
function readSbom(worktree: string, projects: string[]): SbomPackage[] {
  const seen = new Map<string, SbomPackage>();
  for (const p of projects) {
    // Projects keep NuGet assets either in <project>/obj or in a repo-level obj/<project>.
    const f = [join(worktree, p, "obj", "project.assets.json"), join(worktree, "obj", p, "project.assets.json")].find((x) => existsSync(x));
    if (!f) continue;
    const assets = JSON.parse(readFileSync(f, "utf8")) as { libraries?: Record<string, { type: string }> };
    for (const [k, v] of Object.entries(assets.libraries ?? {})) {
      if (v.type !== "package") continue;
      const [name, version] = k.split("/") as [string, string];
      seen.set(k, { name, version });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseVulnerable(out: string): Vulnerability[] {
  const vulns: Vulnerability[] = [];
  let last: { package: string; version: string } | null = null;
  for (const line of out.split("\n")) {
    const m = /^\s*>\s+(\S+)\s+(?:\S+\s+)?(\S+)\s+(Low|Moderate|High|Critical)\s+(\S+)/.exec(line);
    if (m) { last = { package: m[1]!, version: m[2]! }; vulns.push({ ...last, severity: m[3]!, advisory: m[4]! }); continue; }
    const cont = /^\s+(Low|Moderate|High|Critical)\s+(https?:\S+)/.exec(line);
    if (cont && last) vulns.push({ ...last, severity: cont[1]!, advisory: cont[2]! });
  }
  return vulns;
}

/** Vulnerabilities already present at the base commit (scanned once, cached per base). */
async function baselineVulns(t: CiTarget, projects: string[]): Promise<Set<string>> {
  if (!t.baseSha || !t.repo) return new Set();
  const cacheKey = `ci/baseline-${t.baseSha}.json`;
  const cached = loadJson<string[]>(cacheKey);
  if (cached) return new Set(cached);
  const { snapshot } = await import("./git.ts");
  const dir = await snapshot(t.repo, t.baseSha);
  let all: Vulnerability[] = [];
  for (const p of projects) {
    await sh(dir, `dotnet restore ${p} -v q`, 10 * 60_000);
    all = all.concat(parseVulnerable((await sh(dir, `dotnet list ${p} package --vulnerable --include-transitive`, 5 * 60_000)).out));
  }
  const keys = all.map((v) => `${v.package}@${v.version}#${v.advisory}`);
  saveJson(cacheKey, keys);
  return new Set(keys);
}

export const localCi: CiProvider = {
  id: "local",
  name: "Local runner",
  async run(t, onStep) {
    const affected = await affectedTests(t);
    const projects = affected.projects;
    onStep({ name: affected.filter ? `selected ${affected.classes.length} test classes that reach the change` : "running the full test project (no narrower selection)", ok: true, seconds: 0, log: affected.classes.join("\n") });
    const steps: CiStep[] = [];
    const step = (name: string, r: { code: number; out: string; seconds: number }, ok = r.code === 0) => {
      const s = { name, ok, seconds: r.seconds, log: tail(r.out) };
      steps.push(s); onStep(s); return s;
    };
    let passed = true;
    for (const p of projects) {
      const b = step(`build ${p}`, await sh(t.worktree, `dotnet build ${p} -c Debug -nologo -v q`, 15 * 60_000));
      if (!b.ok) { passed = false; break; }
      const tr = await sh(t.worktree, `dotnet test ${p} -c Debug --no-build -nologo -v q${affected.filter ? ` --filter "${affected.filter}"` : ""}`, 15 * 60_000);
      const s = step(`test ${p}`, tr);
      if (!s.ok) passed = false;
    }
    const packages = readSbom(t.worktree, projects);
    const sbomPath = `ci/${t.headSha}.sbom.cdx.json`;
    saveJson(sbomPath, {
      bomFormat: "CycloneDX", specVersion: "1.5", metadata: { timestamp: new Date().toISOString(), component: { type: "application", name: "MessagePack-CSharp", version: t.headSha } },
      components: packages.map((p) => ({ type: "library", name: p.name, version: p.version, purl: `pkg:nuget/${p.name}@${p.version}` })),
    });
    onStep({ name: `sbom: ${packages.length} packages recorded`, ok: packages.length > 0, seconds: 0, log: "" });
    let vulnerabilities: Vulnerability[] = [];
    let scanAnswered = true;
    for (const p of projects) {
      // A scan that can't reach the advisory feed says nothing; that is not the same as "no vulnerabilities".
      let v = { code: 1, out: "", seconds: 0 };
      for (let attempt = 0; attempt < 3; attempt++) {
        v = await sh(t.worktree, `dotnet list ${p} package --vulnerable --include-transitive`, 5 * 60_000);
        if (/has the following vulnerable packages|has no vulnerable packages/.test(v.out)) break;
      }
      if (!/has the following vulnerable packages|has no vulnerable packages/.test(v.out)) scanAnswered = false;
      vulnerabilities = vulnerabilities.concat(parseVulnerable(v.out));
    }
    const base = await baselineVulns(t, projects);
    for (const v of vulnerabilities) v.preExisting = base.has(`${v.package}@${v.version}#${v.advisory}`);
    const introduced = vulnerabilities.filter((v) => !v.preExisting);
    const vs = {
      name: scanAnswered ? `vulnerable packages: ${introduced.length} introduced, ${vulnerabilities.length - introduced.length} pre-existing` : "vulnerable packages: scan unavailable (advisory feed did not answer)",
      ok: introduced.length === 0, seconds: 0,
      log: vulnerabilities.map((v) => `${v.preExisting ? "pre-existing" : "INTRODUCED"} ${v.package} ${v.version} ${v.severity} ${v.advisory}`).join("\n"),
    };
    steps.push(vs); onStep(vs);
    return {
      scanAnswered,
      provider: "local", headSha: t.headSha, at: new Date().toISOString(), passed: passed && introduced.length === 0, steps,
      sbom: { format: "CycloneDX", packages, path: sbomPath }, vulnerabilities,
      egress: { enforced: false, note: "Local runner does not restrict network egress; CRACI enforces an egress policy at the runner." },
    };
  },
};

/** CRACI: the PR branch runs the schema-ci workflow on CRACI runners; we read the outcome from GitHub. */
export const craciCi: CiProvider = {
  id: "craci",
  name: "CRACI",
  async run(t, onStep) {
    const repo = process.env.SCHEMA_TRUST_PR_REPO ?? "Ijtihed/junction26-messagepack-csharp";
    const t0 = Date.now();
    // Hand CRACI only the change: the projects and test classes that reach it.
    const affected = await affectedTests(t);
    await sh(t.worktree, `git push -q ${process.env.SCHEMA_TRUST_PR_REMOTE ?? "copy"} HEAD:refs/heads/${t.branch}`, 120_000);
    await sh(t.worktree, `gh workflow run schema-ci.yml -R ${repo} --ref ${t.branch} -f projects="${affected.projects.join(" ")}" -f filter="${affected.filter ?? ""}"`, 60_000);
    onStep({ name: `CRACI dispatched for ${affected.classes.length || "all"} test classes`, ok: true, seconds: 0, log: affected.classes.join("\n") });
    for (;;) {
      const r = await sh(t.worktree, `gh run list -R ${repo} --branch ${t.branch} --workflow schema-ci.yml --json databaseId,headSha,status,conclusion,url -L 5`, 60_000);
      const runs = JSON.parse(r.out || "[]") as { databaseId: number; headSha: string; status: string; conclusion: string; url: string }[];
      const mine = runs.find((x) => x.headSha === t.headSha);
      if (mine?.status === "completed") {
        const ok = mine.conclusion === "success";
        const log = ok ? "" : tail((await sh(t.worktree, `gh run view ${mine.databaseId} -R ${repo} --log-failed`, 120_000)).out, 120);
        const s = { name: `CRACI workflow ${mine.conclusion}`, ok, seconds: Math.round((Date.now() - t0) / 1000), log };
        onStep(s);
        return { provider: "craci", headSha: t.headSha, at: new Date().toISOString(), passed: ok, steps: [s], sbom: null, vulnerabilities: [], egress: { enforced: true, note: "Egress policy enforced by CRACI runner; SBOM and CVE matches in the CRACI dashboard." }, url: mine.url };
      }
      if (Date.now() - t0 > 30 * 60_000) {
        const s = { name: "CRACI workflow did not finish in 30 min", ok: false, seconds: 1800, log: "" };
        onStep(s);
        return { provider: "craci", headSha: t.headSha, at: new Date().toISOString(), passed: false, steps: [s], sbom: null, vulnerabilities: [], egress: { enforced: true, note: "" } };
      }
      await new Promise((res) => setTimeout(res, 15_000));
    }
  },
};

export function ciProvider(): CiProvider {
  return process.env.SCHEMA_CI === "craci" ? craciCi : localCi;
}

export async function runCi(t: CiTarget, onStep: (s: CiStep) => void): Promise<CiResult> {
  const result = await ciProvider().run(t, onStep);
  saveJson(`ci/${t.headSha}.json`, result);
  return result;
}

export const loadCi = (headSha: string) => loadJson<CiResult>(`ci/${headSha}.json`);
