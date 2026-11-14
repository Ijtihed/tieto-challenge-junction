// Earned-trust review actions. The engine produces advice with evidence;
// only trust.signoff, called with a named owner, records a decision.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { buildReceipt, loadRequirement, short, type Receipt } from "../trust/receipt.ts";
import { headGraph, snapshot, git } from "../trust/git.ts";
import { startAgentRun, loadRun, recoverRuns } from "../trust/agent.ts";
import { receiptDigest, receiptMarkdown } from "../trust/markdown.ts";
import { repoMapFor } from "../trust/repomap.ts";
import { buildAndSaveReceipt, openPr, publishRun, refreshPage, loadPage, startPrWatcher, PR_REPO as PUB_REPO, type PrRecord as PubPr } from "../trust/publish.ts";

startPrWatcher();
void recoverRuns(async (r) => { const out = await publishRun(r); return out ? { receiptId: out.receiptId } : {}; });
import {
  JUNCTION_DIR, logDecision, readDecisions, readAreas, recordEscape, recordSignoffOutcome,
  saveJson, saveText, loadJson,
} from "../trust/ledger.ts";

type Result = { ok: true; data: unknown } | { ok: false; code: string; message: string };

const DEFAULT_REPO = process.env.SCHEMA_TRUST_REPO ?? join(homedir(), "junction26-messagepack-csharp");
const repoOf = (args: Record<string, unknown>) => (args.repoPath as string | undefined) || DEFAULT_REPO;
const fail = (code: string, message: string): Result => ({ ok: false, code, message });
const receiptFile = (id: string) => `receipts/${id.replace(/[^A-Za-z0-9@._-]/g, "_")}.json`;

function loadReceipt(id: string): Receipt | null {
  return loadJson<Receipt>(receiptFile(id));
}

export const trustListRequirements = {
  name: "trust.list_requirements" as const,
  description: "List requirement IDs available for review, with any receipts already built.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: {} },
  async handle(): Promise<Result> {
    const dir = join(JUNCTION_DIR, "requirements");
    const ids = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
    const receiptsDir = join(JUNCTION_DIR, "receipts");
    const receipts = existsSync(receiptsDir) ? readdirSync(receiptsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
    return {
      ok: true,
      data: {
        defaultRepo: DEFAULT_REPO,
        requirements: ids.map((id) => {
          const r = loadRequirement(id);
          return { id, title: r.title, kind: r.kind, branch: r.branch, receipts: receipts.filter((x) => x.startsWith(id + "@")) };
        }),
      },
    };
  },
};

export const trustReceipt = {
  name: "trust.receipt" as const,
  description: "Build an evidence receipt for an agent-written change: AST diff, blast radius, test reachability, claims, refusals, risk tier, read list. Advisory only; never approves.",
  sideEffect: "preflightable" as const,
  inputSchema: {
    type: "object",
    properties: {
      requirementId: { type: "string" },
      repoPath: { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      runId: { type: "string", description: "Agent run whose commit to review" },
      cached: { type: "boolean", description: "Return the saved receipt if one exists" },
    },
    required: ["requirementId"],
  },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const requirementId = args.requirementId as string;
    try {
      if (args.cached) {
        const dir = join(JUNCTION_DIR, "receipts");
        const hit = existsSync(dir) ? readdirSync(dir).find((f) => f.startsWith(requirementId + "@")) : undefined;
        if (hit) return { ok: true, data: loadJson<Receipt>(`receipts/${hit}`) };
      }
      const run = args.runId ? loadRun(args.runId as string) : null;
      if (args.runId && (!run || run.status !== "done" || !run.headSha)) return fail("RUN_NOT_READY", "Agent run is not finished");
      const receipt = await buildAndSaveReceipt({ repo: repoOf(args), requirementId, base: args.base as string | undefined, head: args.head as string | undefined, run });
      return { ok: true, data: receipt };
    } catch (err) {
      return fail("RECEIPT_FAILED", err instanceof Error ? err.message : String(err));
    }
  },
};

/** Subgraph for the canvas: changed members, their callers, and the test paths that reach them. */
export const trustGraph = {
  name: "trust.graph" as const,
  description: "Evidence subgraph for a receipt: changed members, callers within N hops, and test paths.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" }, hops: { type: "number" } }, required: ["receiptId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const receipt = loadReceipt(args.receiptId as string);
    if (!receipt) return fail("NO_RECEIPT", "Build the receipt first");
    const hops = Math.min(3, Math.max(1, Number(args.hops ?? 1)));
    const g = await headGraph(receipt.repo, receipt.headSha);
    const byKey = new Map(g.nodes.map((n) => [n.key, n] as const));
    const rev = new Map<string, string[]>();
    for (const e of g.edges) if (e.relation !== "declares") (rev.get(e.target) ?? rev.set(e.target, []).get(e.target)!).push(e.source);

    const role = new Map<string, string>();
    for (const m of receipt.members) role.set(m.key, m.flags.length ? "flagged" : "changed");
    let frontier = receipt.members.map((m) => m.key).filter((k) => byKey.has(k));
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const k of frontier) for (const s of rev.get(k) ?? []) if (!role.has(s)) { role.set(s, byKey.get(s)?.isTest ? "test" : "caller"); next.push(s); }
      frontier = next.slice(0, 120);
    }
    const pathKeys = new Set<string>();
    for (const m of receipt.members) for (const t of m.tests.slice(0, 2)) for (const k of t.pathKeys) pathKeys.add(k);
    for (const k of pathKeys) if (!role.has(k)) role.set(k, byKey.get(k)?.isTest ? "test" : "path");

    const keys = new Set(role.keys());
    const nodes = [...keys].filter((k) => byKey.has(k)).map((k) => {
      const n = byKey.get(k)!;
      return { id: k, label: short(k), role: role.get(k), csKind: n.csKind, file: n.file, publicApi: n.publicApi };
    });
    const edges = g.edges
      .filter((e) => e.relation !== "declares" && keys.has(e.source) && keys.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, relation: e.relation, resolved: e.resolved }));
    return { ok: true, data: { nodes, edges } };
  },
};

export const trustRunTests = {
  name: "trust.run_tests" as const,
  description: "Run the test classes that reach this change (dotnet test on the head commit) and record the result in the receipt's evidence.",
  sideEffect: "preflightable" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" }, project: { type: "string" } }, required: ["receiptId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const receipt = loadReceipt(args.receiptId as string);
    if (!receipt) return fail("NO_RECEIPT", "Build the receipt first");
    const testKeys = new Set<string>([...receipt.newTests.map((t) => t.key), ...receipt.members.flatMap((m) => m.tests.map((t) => t.test))]);
    const classes = [...new Set([...testKeys].map((k) => k.replace(/\(.*\)$/, "").split(".").slice(0, -1).pop()!).filter(Boolean))];
    if (!classes.length) return fail("NO_TESTS", "No tests reach this change");
    const testFile = receipt.newTests[0]?.file ?? receipt.members.flatMap((m) => m.tests)[0]?.test;
    const project = (args.project as string | undefined)
      ?? (receipt.newTests[0]?.file ?? "").split("/").slice(0, 2).join("/");
    if (!project) return fail("NO_PROJECT", `Could not infer test project (${testFile}); pass project`);
    const dir = await snapshot(receipt.repo, receipt.headSha);
    const filter = classes.map((c) => `FullyQualifiedName~${c}`).join("|");
    const dotnet = join(process.env.DOTNET_ROOT ?? join(homedir(), ".dotnet"), "dotnet");
    const started = Date.now();
    const out = await new Promise<{ code: number; text: string }>((resolveP) => {
      const child = spawn(dotnet, ["test", join(dir, project), "--filter", filter, "-f", "net8.0", "--nologo", "-v", "q", "--logger", "console;verbosity=normal"],
        { cwd: dir, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } });
      let text = "";
      child.stdout.on("data", (b: Buffer) => { text += b.toString(); });
      child.stderr.on("data", (b: Buffer) => { text += b.toString(); });
      child.on("close", (code) => resolveP({ code: code ?? 1, text }));
    });
    const num = (re: RegExp) => Number(re.exec(out.text)?.[1] ?? 0);
    const passed = num(/Passed:\s+(\d+)/);
    const failed = num(/Failed:\s+(\d+)/);
    const failures = [...out.text.matchAll(/^\s*Failed (\S+)/gm)].map((m) => m[1]!).slice(0, 20);
    const result = {
      at: new Date().toISOString(), filter, project, exitCode: out.code, passed, failed, failures,
      seconds: Math.round((Date.now() - started) / 1000),
      tail: out.text.split("\n").slice(-40).join("\n"),
    };
    saveJson(`test-runs/${receipt.headSha}.json`, result);
    logDecision({ actor: "engine", action: "run_tests", receiptId: receipt.id, detail: `${passed} passed, ${failed} failed (exit ${out.code}, ${result.seconds}s)` });
    return { ok: true, data: result };
  },
};

export const trustSignoff = {
  name: "trust.signoff" as const,
  description: "Record a named owner's decision on a receipt: what was checked and by whom, what was not and why, and the residual risk accepted.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      receiptId: { type: "string" },
      owner: { type: "string", description: "Named human accountable for the change" },
      decision: { type: "string", enum: ["accept", "request-changes", "reject"] },
      checkedByOwner: { type: "array", items: { type: "string" } },
      refusalAnswers: { type: "object", description: "question -> owner's answer" },
      residualRisk: { type: "string" },
      notes: { type: "string" },
    },
    required: ["receiptId", "owner", "decision", "residualRisk"],
  },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const receipt = loadReceipt(args.receiptId as string);
    if (!receipt) return fail("NO_RECEIPT", "Build the receipt first");
    const owner = String(args.owner ?? "").trim();
    if (!owner) return fail("NO_OWNER", "A named owner is required; the engine cannot sign.");
    const decision = args.decision as string;
    const answers = (args.refusalAnswers ?? {}) as Record<string, string>;
    const unanswered = receipt.refusals.filter((r) => !answers[r.question]?.trim());
    if (decision === "accept" && unanswered.length) {
      return fail("UNANSWERED_REFUSALS", `Accepting requires an answer to every refused question (${unanswered.length} open).`);
    }
    const residualRisk = String(args.residualRisk ?? "").trim();
    if (!residualRisk) return fail("NO_RESIDUAL_RISK", "State the residual risk you accept.");

    const signoff = {
      receiptId: receipt.id, requirement: receipt.requirement.id, headSha: receipt.headSha, at: new Date().toISOString(),
      owner, decision, tier: receipt.risk.tier,
      checked: [
        ...receipt.checked.map((c) => ({ what: c.what, by: c.by })),
        ...((args.checkedByOwner as string[] | undefined) ?? []).map((w) => ({ what: w, by: `owner:${owner}` })),
      ],
      notChecked: receipt.notChecked,
      refusalAnswers: receipt.refusals.map((r) => ({ question: r.question, answer: answers[r.question] ?? "", by: owner })),
      residualRisk, notes: (args.notes as string | undefined) ?? "",
      claims: receipt.claims.map((c) => ({ id: c.id, status: c.status, decidedBy: c.decidedBy })),
    };
    saveJson(`signoffs/${receipt.id}.json`, signoff);
    saveText(`signoffs/${receipt.id}.md`, signoffMarkdown(receipt, signoff));
    recordSignoffOutcome(receipt.areas, decision);
    const pr = loadJson<PrRecord>(`prs/${receipt.id}.json`);
    if (pr) {
      const md = join(JUNCTION_DIR, `signoffs/${receipt.id}.md`);
      await gh(["pr", "comment", String(pr.number), "-R", PR_REPO, "--body-file", md], receipt.repo).catch(() => undefined);
    }
    logDecision({ actor: owner, action: `signoff:${decision}`, receiptId: receipt.id, detail: residualRisk });
    return { ok: true, data: signoff };
  },
};

function signoffMarkdown(r: Receipt, s: { owner: string; decision: string; at: string; checked: { what: string; by: string }[]; refusalAnswers: { question: string; answer: string }[]; residualRisk: string; notes: string }): string {
  const lines = [
    `# Sign-off: ${r.requirement.id} @ ${r.headSha.slice(0, 8)}`,
    "",
    `**Owner:** ${s.owner}  `,
    `**Decision:** ${s.decision}  `,
    `**Review tier:** ${r.risk.tierLabel} (score ${r.risk.score})  `,
    `**Signed:** ${s.at}`,
    "",
    "The AI review is advice with evidence. This decision is the owner's.",
    "",
    "## Checked, and by whom or what",
    ...s.checked.map((c) => `- ${c.what} (${c.by})`),
    "",
    "## Not checked, and why",
    ...r.notChecked.map((n) => `- ${n.what}: ${n.why}`),
    "",
    "## Questions the AI refused to decide",
    ...(s.refusalAnswers.length ? s.refusalAnswers.map((a) => `- **${a.question}**\n  ${a.answer || "(no answer)"}`) : ["- none"]),
    "",
    "## Residual risk accepted",
    s.residualRisk,
    ...(s.notes ? ["", "## Notes", s.notes] : []),
    "",
  ];
  return lines.join("\n");
}

export const trustRecordEscape = {
  name: "trust.record_escape" as const,
  description: "Record a defect that got past review in an area. Withdraws earned trust there until it is re-earned.",
  sideEffect: "final" as const,
  inputSchema: { type: "object", properties: { area: { type: "string" }, receiptId: { type: "string" }, note: { type: "string" }, reporter: { type: "string" } }, required: ["area", "receiptId", "note"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const rec = recordEscape(args.area as string, args.receiptId as string, args.note as string);
    logDecision({ actor: (args.reporter as string) || "unknown", action: "escape", receiptId: args.receiptId as string, detail: `${args.area}: ${args.note}` });
    return { ok: true, data: rec };
  },
};

export const trustLedger = {
  name: "trust.ledger" as const,
  description: "Per-area track record and the decision log.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" } } },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const receiptId = args.receiptId as string | undefined;
    return {
      ok: true,
      data: {
        areas: readAreas(),
        decisions: readDecisions(receiptId).slice(-200),
        signoff: receiptId ? loadJson(`signoffs/${receiptId}.json`) : null,
      },
    };
  },
};

const PR_REPO = process.env.SCHEMA_TRUST_PR_REPO ?? "Ijtihed/junction26-messagepack-csharp";
const PR_REMOTE = process.env.SCHEMA_TRUST_PR_REMOTE ?? "copy";
interface PrRecord { receiptId: string; url: string; number: number; branch: string; headSha: string; digest: string; openedAt: string }

async function gh(args: string[], cwd: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((res, rej) => execFile("gh", args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(out))));
}

export const agentStart = {
  name: "agent.start" as const,
  description: "Start Claude Code headless in an isolated worktree to implement a requirement. Returns a runId to poll.",
  sideEffect: "final" as const,
  inputSchema: { type: "object", properties: { requirementId: { type: "string" }, prompt: { type: "string" }, repoPath: { type: "string" }, model: { type: "string" } }, required: ["requirementId", "prompt"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    try {
      const run = await startAgentRun({
        repo: repoOf(args), requirementId: args.requirementId as string, prompt: args.prompt as string, model: args.model as string | undefined,
        onDone: async (r) => {
          const out = await publishRun(r);
          return out ? { receiptId: out.receiptId } : {};
        },
      });
      return { ok: true, data: run };
    } catch (err) {
      return fail("AGENT_START_FAILED", err instanceof Error ? err.message : String(err));
    }
  },
};

export const agentStatus = {
  name: "agent.status" as const,
  description: "Steps, decisions and status of an agent run.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { runId: { type: "string" }, since: { type: "number" } }, required: ["runId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const run = loadRun(args.runId as string);
    return run ? { ok: true, data: run } : fail("NO_RUN", "Unknown run");
  },
};

export const agentList = {
  name: "agent.list" as const,
  description: "Agent runs recorded so far.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: {} },
  async handle(): Promise<Result> {
    const dir = join(JUNCTION_DIR, "agent-runs");
    const runs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => loadRun(f.slice(0, -5))).filter(Boolean) : [];
    return { ok: true, data: runs.map((r) => ({ runId: r!.runId, requirementId: r!.requirementId, status: r!.status, startedAt: r!.startedAt, branch: r!.branch, headSha: r!.headSha })).reverse() };
  },
};

export const prOpen = {
  name: "pr.open" as const,
  description: `Push the reviewed commit to ${PR_REPO} and open a PR whose body is the evidence receipt. Never approves.`,
  sideEffect: "final" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const receipt = loadReceipt(args.receiptId as string) as (Receipt & { digest?: string; agent?: never }) | null;
    if (!receipt) return fail("NO_RECEIPT", "Build the receipt first");
    try {
      const runId = (receipt as { agent?: { runId?: string } }).agent?.runId;
      const pr = await openPr(receipt as never, runId);
      // Record the PR on the agent run so the issue list and plan panel can link it.
      const r = runId ? loadRun(runId) : null;
      if (r) {
        r.prUrl = pr.url; r.pageUrl = pr.pageUrl; r.slug = pr.slug;
        saveJson(`agent-runs/${r.runId}.json`, r);
      }
      return { ok: true, data: pr };
    } catch (err) {
      return fail("PR_OPEN_FAILED", err instanceof Error ? err.message : String(err));
    }
  },
};

export const prVerify = {
  name: "pr.verify" as const,
  description: "Check that the PR's head commit and body still match the saved receipt.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const receipt = loadReceipt(args.receiptId as string) as (Receipt & { digest?: string }) | null;
    const pr = loadJson<PrRecord>(`prs/${args.receiptId as string}.json`);
    if (!receipt || !pr) return fail("NO_PR", "No PR for this receipt");
    const live = JSON.parse(await gh(["pr", "view", String(pr.number), "-R", PR_REPO, "--json", "headRefOid,body,state,url,comments"], receipt.repo)) as { headRefOid: string; body: string; state: string; url: string; comments: { body: string }[] };
    const recomputed = receiptDigest(receipt);
    const checks = [
      { check: "Saved receipt is unmodified", ok: recomputed === receipt.digest, detail: recomputed.slice(0, 16) },
      { check: "PR head is the reviewed commit", ok: live.headRefOid === receipt.headSha, detail: `${live.headRefOid.slice(0, 8)} vs ${receipt.headSha.slice(0, 8)}` },
      { check: "PR body carries this receipt's digest", ok: live.body.includes(receipt.digest ?? "missing"), detail: "receipt-sha256 line" },
      { check: "A named owner signed off on the PR", ok: live.comments.some((c) => c.body.includes("Sign-off:")), detail: `${live.comments.length} comment(s)` },
    ];
    return { ok: true, data: { url: live.url, state: live.state, checks, verified: checks.every((c) => c.ok) } };
  },
};

export const repoMap = {
  name: "repo.map" as const,
  description: "Curated architecture map of the repo: ~80 key types in hand-defined modules, with links and file-to-node lookup for animating agent activity.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { repoPath: { type: "string" }, ref: { type: "string" } } },
  async handle(args: Record<string, unknown>): Promise<Result> {
    try {
      return { ok: true, data: await repoMapFor(repoOf(args), (args.ref as string | undefined) ?? "HEAD") };
    } catch (err) {
      return fail("MAP_FAILED", err instanceof Error ? err.message : String(err));
    }
  },
};

export const prPage = {
  name: "pr.page" as const,
  description: "Everything the live per-PR page shows: PR state, revisions, latest receipt, agent run, repo map at the base commit.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { slug: { type: "string" }, refresh: { type: "boolean" } }, required: ["slug"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const slug = String(args.slug ?? "");
    let page = loadPage(slug);
    if (!page) return fail("NO_PAGE", "Unknown review page");
    if (args.refresh) page = (await refreshPage(slug).catch(() => page)) ?? page;
    const latest = page.revisions[page.revisions.length - 1]!;
    const receipt = loadReceipt(latest.receiptId);
    const run = page.runId ? loadRun(page.runId) : null;
    const map = await repoMapFor(page.repo, page.baseSha);
    const pr = loadJson<PubPr>(`prs/${page.revisions[0]!.receiptId}.json`);
    return { ok: true, data: { page, receipt, run, map, pr, repo: PUB_REPO, signoff: loadJson(`signoffs/${latest.receiptId}.json`), decisions: readDecisions().filter((d) => page!.revisions.some((r) => r.receiptId === d.receiptId) || d.receiptId === page!.runId).slice(-80) } };
  },
};

export const prForReceipt = {
  name: "pr.get" as const,
  description: "PR record (with live page link) for a receipt, if one was opened.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    return { ok: true, data: loadJson<PubPr>(`prs/${args.receiptId as string}.json`) };
  },
};

interface ConnectorIssue { requirementId: string; tracker: string; key: string; status: string; priority: string; assignee: string; labels: string[]; reporter: string; updatedAt: string }
interface ConnectorFile { note: string; connectors: { id: string; name: string; workspace: string; transport: string; status: string }[]; issues: ConnectorIssue[] }

/** Issues pulled from the tracker connectors (Linear, Jira), joined with requirements and agent runs. */
export const issuesList = {
  name: "issues.list" as const,
  description: "Issues from the connected trackers (Linear, Jira via MCP), with linked requirement, agent runs and PRs.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: {} },
  async handle(): Promise<Result> {
    const file = loadJson<ConnectorFile>("connectors/issues.json");
    if (!file) return fail("NO_CONNECTORS", "No tracker connectors configured");
    const runsDir = join(JUNCTION_DIR, "agent-runs");
    const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith(".json")).map((f) => loadRun(f.slice(0, -5))).filter(Boolean) : [];
    const issues = file.issues.map((i) => {
      const req = loadRequirement(i.requirementId);
      const mine = runs.filter((r) => r!.requirementId === i.requirementId)
        .map((r) => ({ runId: r!.runId, status: r!.status, startedAt: r!.startedAt, branch: r!.branch, prUrl: r!.prUrl, pageUrl: r!.pageUrl }))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return { ...i, title: req.title, kind: req.kind, source: req.source, branch: req.branch, intent: req.intent, runs: mine };
    });
    return { ok: true, data: { note: file.note, connectors: file.connectors, syncedAt: new Date().toISOString(), issues } };
  },
};

export const receiptGet = {
  name: "trust.receipt_get" as const,
  description: "A saved receipt by id.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const r = loadReceipt(args.receiptId as string);
    return r ? { ok: true, data: r } : fail("NO_RECEIPT", "Unknown receipt");
  },
};

export interface FileDiff { path: string; status: string; added: number; deleted: number; generated: boolean; patch: string | null }

/** Every file the agent changed, with its patch; generated snapshots are listed without patches unless asked. */
export const agentDiff = {
  name: "agent.diff" as const,
  description: "Per-file diff of an agent run (base..head) for the change viewer.",
  sideEffect: "none" as const,
  inputSchema: { type: "object", properties: { runId: { type: "string" }, path: { type: "string" } }, required: ["runId"] },
  async handle(args: Record<string, unknown>): Promise<Result> {
    const run = loadRun(args.runId as string);
    if (!run?.headSha) return fail("NO_COMMIT", "This run has no commit yet");
    const repo = (await git(run.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim().replace(/\/\.git$/, "");
    const range = [run.baseSha, run.headSha];
    if (args.path) {
      const patch = await git(repo, "-c", "core.quotepath=false", "diff", "--no-color", ...range, "--", args.path as string);
      return { ok: true, data: { path: args.path, patch } };
    }
    const status = new Map((await git(repo, "-c", "core.quotepath=false", "diff", "--name-status", ...range)).split("\n").filter(Boolean).map((l) => { const p = l.split("\t"); return [p[p.length - 1]!, p[0]!.slice(0, 1)] as const; }));
    const files: FileDiff[] = [];
    for (const line of (await git(repo, "-c", "core.quotepath=false", "diff", "--numstat", ...range)).split("\n").filter(Boolean)) {
      const [a, d, ...rest] = line.split("\t");
      const path = rest.join("\t");
      const generated = /\.g\.cs$|\/Resources\//.test(path);
      files.push({ path, status: status.get(path) ?? "M", added: Number(a) || 0, deleted: Number(d) || 0, generated, patch: null });
    }
    // Authored files first, then tests, then generated; patches for the first 40 non-generated files.
    const rank = (f: FileDiff) => (f.generated ? 2 : f.path.startsWith("tests/") ? 1 : 0);
    files.sort((x, y) => rank(x) - rank(y) || x.path.localeCompare(y.path));
    for (const f of files.filter((x) => !x.generated).slice(0, 40)) {
      f.patch = (await git(repo, "-c", "core.quotepath=false", "diff", "--no-color", ...range, "--", f.path)).split("\n").slice(4).join("\n");
    }
    return { ok: true, data: { runId: run.runId, baseSha: run.baseSha, headSha: run.headSha, branch: run.branch, prUrl: run.prUrl, files } };
  },
};

export const TRUST_ACTIONS = [agentDiff, receiptGet, issuesList, prPage, prForReceipt, repoMap, agentStart, agentStatus, agentList, prOpen, prVerify, trustListRequirements, trustReceipt, trustGraph, trustRunTests, trustSignoff, trustRecordEscape, trustLedger] as const;
