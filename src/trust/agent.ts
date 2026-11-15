// Runs Claude Code headless in an isolated git worktree to implement a requirement,
// records every step it takes, and commits the result with traceable trailers.
// The agent never pushes, never opens a PR, and never signs off.
import { spawn, execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadRequirement, type Requirement } from "./receipt.ts";
import { JUNCTION_DIR, logDecision } from "./ledger.ts";
import { cacheDir, revParse } from "./git.ts";
import { ciProvider, runCi } from "./ci.ts";
import { buildFocus, focusMarkdown, type FocusBrief } from "./focus.ts";

const exec = promisify(execFile);

export type StepKind = "thought" | "read" | "search" | "edit" | "command" | "result" | "note";
export interface AgentStep { i: number; at: string; kind: StepKind; title: string; detail?: string | undefined; file?: string | undefined }
export interface AgentDecision { decision: string; why: string; alternatives?: string; confidence: "sure" | "unsure"; evidence?: string }
export interface AgentRun {
  runId: string; requirementId: string; prompt: string; status: "running" | "done" | "failed";
  startedAt: string; finishedAt?: string; worktree: string; branch: string; baseSha: string; headSha?: string;
  model?: string; agentVersion?: string; turns?: number; costUsd?: number; durationMs?: number;
  steps: AgentStep[]; decisions: AgentDecision[]; openQuestions: string[]; summary?: string | undefined; error?: string;
  filesChanged?: string[];
  receiptId?: string; prUrl?: string; pageUrl?: string; slug?: string; publishError?: string;
  focus?: FocusBrief;
  sessionId?: string; ci?: { headSha: string; passed: boolean; provider: string; at: string }[];
}

const RUNS = () => join(JUNCTION_DIR, "agent-runs");
const runPath = (id: string) => join(RUNS(), `${id}.json`);

export function loadRun(runId: string): AgentRun | null {
  return existsSync(runPath(runId)) ? (JSON.parse(readFileSync(runPath(runId), "utf8")) as AgentRun) : null;
}

function saveRun(run: AgentRun): void {
  mkdirSync(RUNS(), { recursive: true });
  writeFileSync(runPath(run.runId), JSON.stringify(run, null, 2));
}

function buildPrompt(req: Requirement, userPrompt: string, focus?: FocusBrief): string {
  return [
    ...(focus ? [focusMarkdown(focus), ""] : []),
    `You are fixing ${req.id} in this repository (MessagePack-CSharp).`,
    `Developer's request: ${userPrompt}`,
    "",
    `Requirement: ${req.title}`,
    `Intent: ${req.intent}`,
    `Functional:\n${req.functional.map((f) => `- ${f}`).join("\n")}`,
    `Non-functional:\n${req.nonFunctional.map((f) => `- ${f}`).join("\n")}`,
    `Expected scope (stay inside these paths): ${req.expectedScope.join(", ")}`,
    "",
    "Upstream issue text:",
    "<issue>",
    (req as Requirement & { issueBody?: string }).issueBody ?? "(none)",
    "</issue>",
    "",
    "Rules:",
    "- Make the smallest change that satisfies the requirement. Do not refactor unrelated code.",
    "- Add or update tests that fail without your change.",
    "- Work fast. Read only the files you need. Build once, then run ONLY the tests you added or changed with `dotnet test --filter`; do not run the full test suite. Report the result honestly.",
    "- Do not commit, push or open pull requests; the harness does that.",
    "",
    "When you are done, end your final message with exactly one fenced block tagged `decisions`, containing JSON:",
    '{"summary": "one paragraph", "decisions": [{"decision": "...", "why": "...", "alternatives": "...", "confidence": "sure|unsure", "evidence": "file:line or test name"}], "openQuestions": ["things a human must decide"]}',
    "Mark a decision `unsure` whenever it changes behaviour the requirement does not explicitly ask for.",
  ].join("\n");
}

function short(s: string, n = 220): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

/** Turn one stream-json event into zero or more readable steps. */
function toSteps(ev: Record<string, unknown>, root: string): Omit<AgentStep, "i" | "at">[] {
  const rel = (p: unknown) => (typeof p === "string" ? p.replace(root + "/", "") : "");
  if (ev.type === "assistant") {
    const content = ((ev.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
    return content.flatMap((c): Omit<AgentStep, "i" | "at">[] => {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) return [{ kind: "thought" as const, title: short(c.text, 160), detail: c.text }];
      if (c.type !== "tool_use") return [];
      const input = (c.input ?? {}) as Record<string, unknown>;
      switch (c.name) {
        case "Read": return [{ kind: "read" as const, title: `Read ${rel(input.file_path)}`, file: rel(input.file_path) }];
        case "Grep": return [{ kind: "search" as const, title: `Search “${short(String(input.pattern ?? ""), 60)}”${input.path ? ` in ${rel(input.path)}` : ""}` }];
        case "Glob": return [{ kind: "search" as const, title: `Find files ${String(input.pattern ?? "")}` }];
        case "Edit": case "MultiEdit": return [{ kind: "edit" as const, title: `Edit ${rel(input.file_path)}`, file: rel(input.file_path), detail: input.old_string ? `- ${String(input.old_string)}\n+ ${String(input.new_string ?? "")}` : undefined }];
        case "Write": return [{ kind: "edit" as const, title: `Write ${rel(input.file_path)}`, file: rel(input.file_path) }];
        case "Bash": return [{ kind: "command" as const, title: `$ ${short(String(input.command ?? ""), 140)}`, detail: String(input.description ?? "") || undefined }];
        case "TodoWrite": return [{ kind: "note" as const, title: "Updated its task list", detail: JSON.stringify(input.todos ?? [], null, 1) }];
        default: return [{ kind: "note" as const, title: `${String(c.name)}` }];
      }
    });
  }
  if (ev.type === "user") {
    const content = ((ev.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
    return content.filter((c) => c.type === "tool_result" && c.is_error).map((c) => ({ kind: "note" as const, title: "Tool error", detail: short(JSON.stringify(c.content ?? ""), 600) }));
  }
  return [];
}

function parseDecisions(text: string): { summary?: string | undefined; decisions: AgentDecision[]; openQuestions: string[] } {
  const m = /```decisions\s*([\s\S]*?)```/.exec(text);
  if (!m) return { decisions: [], openQuestions: [] };
  try {
    const j = JSON.parse(m[1]!) as { summary?: string; decisions?: AgentDecision[]; openQuestions?: string[] };
    return { summary: j.summary, decisions: j.decisions ?? [], openQuestions: j.openQuestions ?? [] };
  } catch {
    return { decisions: [], openQuestions: ["The agent's decisions block was not valid JSON."] };
  }
}

const git = (cwd: string, ...args: string[]) => exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout);

export async function startAgentRun(opts: { repo: string; requirementId: string; prompt: string; model?: string | undefined; onDone?: (run: AgentRun) => Promise<Partial<AgentRun>> }): Promise<AgentRun> {
  const req = loadRequirement(opts.requirementId);
  const baseSha = await revParse(opts.repo, `origin/${req.branch}~1`).catch(() => revParse(opts.repo, "HEAD"));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const runId = `${req.id}-${stamp}`;
  const branch = `agent/${req.id.toLowerCase()}-${stamp}`;
  const worktree = join(cacheDir(opts.repo), "agent-worktrees", runId);
  mkdirSync(join(cacheDir(opts.repo), "agent-worktrees"), { recursive: true });
  await git(opts.repo, "worktree", "add", "-b", branch, worktree, baseSha);

  const run: AgentRun = {
    runId, requirementId: req.id, prompt: opts.prompt, status: "running", startedAt: new Date().toISOString(),
    worktree, branch, baseSha, steps: [], decisions: [], openQuestions: [],
  };
  saveRun(run);
  logDecision({ actor: `human`, action: "agent:start", receiptId: runId, detail: `"${opts.prompt}" on ${branch} from ${baseSha.slice(0, 8)}` });

  const dotnetRoot = process.env.DOTNET_ROOT ?? join(homedir(), ".dotnet");
  void pipeline(run, opts.prompt, opts.model, opts.onDone);
  return run;
}

const MAX_CI_FIXES = Number(process.env.SCHEMA_CI_RETRIES ?? 1);

/** One Claude Code turn in the run's worktree; resumes the same session when sessionId is set. */
function claudeTurn(run: AgentRun, prompt: string, model: string | undefined): Promise<{ code: number; finalText: string; stderr: string }> {
  const dotnetRoot = process.env.DOTNET_ROOT ?? join(homedir(), ".dotnet");
  const args = [
    "-p", prompt,
    ...(run.sessionId ? ["--resume", run.sessionId] : []),
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Edit", "MultiEdit", "Write", "Glob", "Grep", "TodoWrite",
    "Bash(dotnet build:*)", "Bash(dotnet test:*)", "Bash(dotnet restore:*)", "Bash(git diff:*)", "Bash(git status:*)", "Bash(ls:*)", "Bash(cat:*)",
    "--model", model ?? process.env.SCHEMA_AGENT_MODEL ?? "sonnet",
  ];
  const child = spawn("claude", args, {
    cwd: run.worktree,
    env: { ...process.env, DOTNET_ROOT: dotnetRoot, PATH: `${dotnetRoot}:${process.env.PATH ?? ""}`, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const rawLog = join(RUNS(), `${run.runId}.jsonl`);
  let buf = "";
  let finalText = "";
  let stderr = "";
  child.stdout.on("data", (b: Buffer) => {
    buf += b.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      appendFileSync(rawLog, line + "\n");
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      if (ev.type === "system" && ev.subtype === "init") {
        run.model = String(ev.model ?? ""); run.agentVersion = String(ev.claude_code_version ?? "");
        if (ev.session_id) run.sessionId = String(ev.session_id);
      }
      if (ev.type === "result") {
        finalText = String(ev.result ?? "");
        run.turns = (run.turns ?? 0) + Number(ev.num_turns ?? 0);
        run.costUsd = (run.costUsd ?? 0) + Number(ev.total_cost_usd ?? 0);
        run.durationMs = (run.durationMs ?? 0) + Number(ev.duration_ms ?? 0);
        run.steps.push({ i: run.steps.length, at: new Date().toISOString(), kind: "result", title: "Agent finished this turn", detail: finalText });
      }
      for (const st of toSteps(ev, run.worktree)) run.steps.push({ ...st, i: run.steps.length, at: new Date().toISOString() });
      saveRun(run);
    }
  });
  child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
  return new Promise((resolve) => child.on("close", (code) => resolve({ code: code ?? 1, finalText, stderr })));
}

async function commitWork(run: AgentRun, subject: string, body: string): Promise<boolean> {
  const status = await git(run.worktree, "status", "--porcelain");
  if (!status.trim()) return false;
  await git(run.worktree, "add", "-A");
  const msg = [subject, "", body, "", `Requirement: ${run.requirementId}`, `Agent: Claude Code ${run.agentVersion ?? ""} (${run.model ?? "default model"})`, `Agent-Run: ${run.runId}`, "Review: advisory receipt attached to the PR; a named human signs off."].join("\n");
  await git(run.worktree, "-c", "user.name=Claude Code agent", "-c", "user.email=agent@schema.local", "commit", "-q", "-m", msg);
  run.headSha = (await git(run.worktree, "rev-parse", "HEAD")).trim();
  run.filesChanged = (await git(run.worktree, "diff", "--name-only", run.baseSha, run.headSha)).split("\n").filter(Boolean);
  return true;
}

function note(run: AgentRun, kind: StepKind, title: string, detail?: string) {
  run.steps.push({ i: run.steps.length, at: new Date().toISOString(), kind, title, detail });
  saveRun(run);
}

/** On server start: runs left "running" by a restart either continue from CI (already committed) or are marked interrupted. */
export async function recoverRuns(onDone?: (run: AgentRun) => Promise<Partial<AgentRun>>): Promise<void> {
  const { readdirSync } = await import("node:fs");
  if (!existsSync(RUNS())) return;
  for (const f of readdirSync(RUNS()).filter((x) => x.endsWith(".json"))) {
    const run = loadRun(f.slice(0, -5));
    if (!run || run.status !== "running") continue;
    if (!run.headSha) {
      run.status = "failed"; run.error = "Interrupted by a server restart before the agent committed. Start the fix again.";
      run.finishedAt = new Date().toISOString(); saveRun(run);
      continue;
    }
    note(run, "note", "Server restarted; resuming from CI.");
    void (async () => {
      try {
        const result = await runCi(
          { worktree: run.worktree, headSha: run.headSha!, filesChanged: run.filesChanged ?? [], branch: run.branch, baseSha: run.baseSha, repo: (await git(run.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim().replace(/\/\.git$/, "") },
          (st) => note(run, st.ok ? "result" : "note", `CI · ${st.name} ${st.ok ? "passed" : "failed"}${st.seconds ? ` (${st.seconds}s)` : ""}`, st.log || undefined),
        );
        run.ci = [...(run.ci ?? []), { headSha: result.headSha, passed: result.passed, provider: result.provider, at: result.at }];
        if (!result.passed) run.openQuestions.push("CI failed after a server restart; review the CI log before accepting.");
        run.status = "done";
      } catch (err) {
        run.status = "failed"; run.error = err instanceof Error ? err.message : String(err);
      }
      run.finishedAt = new Date().toISOString(); saveRun(run);
      if (run.status === "done" && onDone) { try { Object.assign(run, await onDone(run)); } catch (e) { run.publishError = String(e); } saveRun(run); }
    })();
  }
}

/** Agent turn -> commit -> CI -> (fix from CI log, at most MAX_CI_FIXES times) -> publish. */
async function pipeline(run: AgentRun, prompt: string, model: string | undefined, onDone?: (run: AgentRun) => Promise<Partial<AgentRun>>): Promise<void> {
  try {
    const req = loadRequirement(run.requirementId);
    try {
      const repo = (await git(run.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim().replace(/\/\.git$/, "");
      run.focus = await buildFocus(repo, run.baseSha, req);
      note(run, "search", `Schema focus brief (${run.focus.strategy}${run.focus.model ? ` · ${run.focus.model}` : ""}, ${run.focus.ms}ms): ${run.focus.files.slice(0, 4).map((f) => f.path.split("/").pop()).join(", ")}`, focusMarkdown(run.focus));
    } catch (err) {
      note(run, "note", "Focus brief unavailable; the agent searches on its own.", String(err));
    }
    const first = await claudeTurn(run, buildPrompt(req, prompt, run.focus), model);
    const d = parseDecisions(first.finalText);
    run.decisions = d.decisions; run.openQuestions = d.openQuestions; run.summary = d.summary;
    const committed = await commitWork(run, `${req.title} (${req.id})`, d.summary ?? "Agent-written change.");
    if (!committed) throw new Error(first.code !== 0 ? `claude exited ${first.code}: ${first.stderr.slice(-800)}` : "The agent made no changes.");
    logDecision({ actor: "agent", action: "agent:commit", receiptId: run.runId, detail: `${run.headSha!.slice(0, 8)}: ${run.filesChanged!.length} files, ${run.decisions.length} decisions` });

    run.ci = [];
    for (let attempt = 0; ; attempt++) {
      note(run, "command", `CI (${ciProvider().name}) on ${run.headSha!.slice(0, 8)}${attempt ? `, after fix ${attempt}` : ""}`);
      const result = await runCi(
        { worktree: run.worktree, headSha: run.headSha!, filesChanged: run.filesChanged ?? [], branch: run.branch, baseSha: run.baseSha, repo: (await git(run.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim().replace(/\/\.git$/, "") },
        (st) => note(run, st.ok ? "result" : "note", `CI · ${st.name} ${st.ok ? "passed" : "failed"}${st.seconds ? ` (${st.seconds}s)` : ""}`, st.log || undefined),
      );
      run.ci.push({ headSha: result.headSha, passed: result.passed, provider: result.provider, at: result.at });
      logDecision({ actor: "ci", action: result.passed ? "ci:passed" : "ci:failed", receiptId: run.runId, detail: `${result.provider} · ${result.headSha.slice(0, 8)} · ${result.steps.filter((x) => !x.ok).map((x) => x.name).join(", ") || "all steps green"}` });
      if (result.passed || attempt >= MAX_CI_FIXES || !run.sessionId) break;
      const failing = result.steps.filter((x) => !x.ok).map((x) => `## ${x.name}\n${x.log}`).join("\n\n");
      const fix = await claudeTurn(run, [
        `CI failed on your commit ${run.headSha!.slice(0, 8)} (${result.provider} runner): a build, a test, or the supply-chain scan (a vulnerable package your change introduced). Fix the cause, keeping the change minimal and inside the requirement's scope. For a vulnerable package, move to a patched version or drop the dependency; never suppress the advisory.`,
        "Re-run only the failing build or tests to confirm. Do not commit or push; the harness does that.",
        "End with the same fenced `decisions` JSON block, listing only decisions you made in this fix.",
        "", "Failing steps:", failing.slice(0, 12_000),
      ].join("\n"), model);
      const fd = parseDecisions(fix.finalText);
      run.decisions = run.decisions.concat(fd.decisions); run.openQuestions = run.openQuestions.concat(fd.openQuestions);
      const fixed = await commitWork(run, `Fix CI failure (attempt ${attempt + 1}) for ${req.id}`, fd.summary ?? "Agent fix after CI feedback.");
      if (!fixed) { note(run, "note", "Agent made no changes in response to CI; stopping."); break; }
    }
    if (run.ci.length && !run.ci[run.ci.length - 1]!.passed) run.openQuestions.push(`CI is still failing after ${run.ci.length - 1} automatic fix attempt(s). Review the CI log before accepting.`);
    run.status = "done";
  } catch (err) {
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
    logDecision({ actor: "agent", action: "agent:failed", receiptId: run.runId, detail: run.error });
  }
  run.finishedAt = new Date().toISOString();
  saveRun(run);
  if (run.status === "done" && onDone) {
    try { Object.assign(run, await onDone(run)); } catch (err) { run.publishError = err instanceof Error ? err.message : String(err); }
    saveRun(run);
  }
}
