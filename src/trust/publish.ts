// Receipt building, PR publishing and the per-PR live page.
// Shared by the manual actions, the automatic post-run path, and the PR watcher.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildReceipt, type Receipt } from "./receipt.ts";
import { git } from "./git.ts";
import { loadRun, type AgentRun } from "./agent.ts";
import { receiptDigest, receiptMarkdown } from "./markdown.ts";
import { JUNCTION_DIR, loadJson, logDecision, saveJson, saveText } from "./ledger.ts";

export const PR_REPO = process.env.SCHEMA_TRUST_PR_REPO ?? "Ijtihed/junction26-messagepack-csharp";
export const PR_REMOTE = process.env.SCHEMA_TRUST_PR_REMOTE ?? "copy";
export const PAGE_BASE = (process.env.SCHEMA_PAGE_BASE ?? "http://localhost:5175").replace(/\/$/, "");

export type FullReceipt = Receipt & { digest?: string; agent?: Record<string, unknown> };
export interface PrRecord { receiptId: string; url: string; number: number; branch: string; headSha: string; digest: string; openedAt: string; slug: string; pageUrl: string }
export interface PageRevision { receiptId: string; headSha: string; at: string; reason: string }
export interface PageRecord {
  slug: string; prNumber: number; prUrl: string; branch: string; repo: string; requirementId: string; baseSha: string;
  runId?: string; state: string; checkedAt: string; revisions: PageRevision[];
}

const receiptFile = (id: string) => `receipts/${id.replace(/[^A-Za-z0-9@._-]/g, "_")}.json`;
export const loadReceipt = (id: string) => loadJson<FullReceipt>(receiptFile(id));
export const loadPage = (slug: string) => loadJson<PageRecord>(`pages/${slug}.json`);
const savePage = (p: PageRecord) => saveJson(`pages/${p.slug}.json`, p);

export function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((res, rej) => execFile("gh", args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(out))));
}

export async function buildAndSaveReceipt(opts: { repo: string; requirementId: string; base?: string | undefined; head?: string | undefined; branch?: string | undefined; run?: AgentRun | null }): Promise<FullReceipt> {
  const run = opts.run ?? null;
  const receipt = await buildReceipt({
    repo: opts.repo, requirementId: opts.requirementId,
    base: run?.baseSha ?? opts.base, head: opts.head ?? run?.headSha, branch: opts.branch ?? run?.branch,
  }) as FullReceipt;
  // Later revisions of an agent PR keep the run: its decisions and open questions still need an owner.
  if (run) {
    receipt.agent = {
      runId: run.runId, model: run.model, agentVersion: run.agentVersion, turns: run.turns, costUsd: run.costUsd,
      durationMs: run.durationMs, summary: run.summary, decisions: run.decisions, steps: run.steps.length,
    };
    for (const d of run.decisions.filter((x) => x.confidence === "unsure")) {
      receipt.refusals.push({
        question: `The agent was unsure: ${d.decision}. Is that acceptable?`,
        why: `Self-reported by the agent: ${d.why}`,
        evidence: d.evidence ? [{ label: "agent evidence", detail: d.evidence }] : [], routeTo: "change owner",
      });
    }
    for (const q of run.openQuestions) receipt.refusals.push({ question: q, why: "The agent left this for a human.", evidence: [], routeTo: "change owner" });
  }
  receipt.digest = receiptDigest(receipt);
  saveJson(receiptFile(receipt.id), receipt);
  logDecision({
    actor: "engine", action: "receipt", receiptId: receipt.id,
    detail: `score ${receipt.risk.score} → ${receipt.risk.tier}; ${receipt.claims.filter((c) => c.status === "verified").length}/${receipt.claims.length} claims verified; ${receipt.refusals.length} refusal(s)`,
  });
  return receipt;
}

function prBody(receipt: FullReceipt, page: PageRecord | null, slug: string): string {
  const run = page?.runId ? loadRun(page.runId) : null;
  return receiptMarkdown(receipt as never, {
    pageUrl: `${PAGE_BASE}/pr/${slug}`,
    steps: run?.steps.filter((s) => s.kind !== "thought").map((s) => `${s.kind}: ${s.title}`) ?? [],
    revisions: page?.revisions.length ?? 1,
  });
}

export async function openPr(receipt: FullReceipt, runId?: string): Promise<PrRecord> {
  const existing = loadJson<PrRecord>(`prs/${receipt.id}.json`);
  if (existing) return existing;
  const branch = receipt.branch.startsWith("agent/") ? receipt.branch : `review/${receipt.branch}`;
  const slug = randomBytes(5).toString("hex").slice(0, 8);
  await git(receipt.repo, "push", "-q", PR_REMOTE, `${receipt.headSha}:refs/heads/${branch}`);
  const bodyPath = saveText(`prs/${receipt.id}.md`, prBody(receipt, null, slug));
  const url = (await gh(["pr", "create", "-R", PR_REPO, "--base", "main", "--head", branch,
    "--title", `${receipt.requirement.id}: ${receipt.requirement.title}`, "--body-file", bodyPath], receipt.repo)).trim().split("\n").pop()!;
  const rec: PrRecord = {
    receiptId: receipt.id, url, number: Number(url.split("/").pop()), branch, headSha: receipt.headSha,
    digest: receipt.digest ?? "", openedAt: new Date().toISOString(), slug, pageUrl: `${PAGE_BASE}/pr/${slug}`,
  };
  saveJson(`prs/${receipt.id}.json`, rec);
  const page: PageRecord = {
    slug, prNumber: rec.number, prUrl: url, branch, repo: receipt.repo, requirementId: receipt.requirement.id,
    baseSha: receipt.baseSha, ...(runId ? { runId } : {}), state: "OPEN", checkedAt: rec.openedAt,
    revisions: [{ receiptId: receipt.id, headSha: receipt.headSha, at: rec.openedAt, reason: runId ? "agent run" : "opened from review" }],
  };
  savePage(page);
  logDecision({ actor: "engine", action: "pr:open", receiptId: receipt.id, detail: `${url} · page ${rec.pageUrl}` });
  return rec;
}

/** After an agent run: build the evidence receipt. The PR is opened only when a human asks for it. */
export async function publishRun(run: AgentRun): Promise<{ receiptId: string } | null> {
  if (run.status !== "done" || !run.headSha) return null;
  const repo = (await git(run.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim().replace(/\/\.git$/, "");
  const receipt = await buildAndSaveReceipt({ repo, requirementId: run.requirementId, run });
  return { receiptId: receipt.id };
}

/** Re-review when the PR head moves; keep the page and PR body in step. */
export async function refreshPage(slug: string): Promise<PageRecord | null> {
  const page = loadPage(slug);
  if (!page) return null;
  const live = JSON.parse(await gh(["pr", "view", String(page.prNumber), "-R", PR_REPO, "--json", "headRefOid,state"], page.repo)) as { headRefOid: string; state: string };
  page.state = live.state;
  page.checkedAt = new Date().toISOString();
  const latest = page.revisions[page.revisions.length - 1]!;
  if (live.headRefOid !== latest.headSha) {
    await git(page.repo, "fetch", "-q", PR_REMOTE, `refs/heads/${page.branch}`);
    const run = page.runId ? loadRun(page.runId) : null;
    const receipt = await buildAndSaveReceipt({ repo: page.repo, requirementId: page.requirementId, base: page.baseSha, head: live.headRefOid, branch: page.branch, run });
    page.revisions.push({ receiptId: receipt.id, headSha: live.headRefOid, at: page.checkedAt, reason: "new commits on the PR" });
    const bodyPath = saveText(`prs/${receipt.id}.md`, prBody(receipt, page, slug));
    // REST rather than `gh pr edit`, which fails on repos without classic Projects.
    await gh(["api", "-X", "PATCH", `repos/${PR_REPO}/pulls/${page.prNumber}`, "-F", `body=@${bodyPath}`], page.repo)
      .catch((e) => logDecision({ actor: "engine", action: "pr:body-update-failed", receiptId: receipt.id, detail: String(e).slice(0, 200) }));
    logDecision({ actor: "engine", action: "pr:re-reviewed", receiptId: receipt.id, detail: `head ${live.headRefOid.slice(0, 8)} → ${receipt.risk.tierLabel}` });
  }
  savePage(page);
  return page;
}

let watcher: ReturnType<typeof setInterval> | null = null;
export function startPrWatcher(intervalMs = 30_000): void {
  if (watcher) return;
  watcher = setInterval(() => {
    const dir = join(JUNCTION_DIR, "pages");
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p = loadPage(f.slice(0, -5));
      if (p && p.state === "OPEN") void refreshPage(p.slug).catch(() => undefined);
    }
  }, intervalMs);
  watcher.unref?.();
}
