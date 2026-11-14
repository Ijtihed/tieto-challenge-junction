// Agent-PR review flow: prompt -> Claude Code run -> receipt -> PR -> named sign-off.
// Kept separate from the main store; it only pushes highlights into it.
import { create } from "zustand";
import { callTool } from "@/mcp-client";
import { fetchApi } from "@/lib/api";
import { useStore } from "@/state/store";
import type { Graph, LocalDiff } from "@/lib/types";

export type ClaimStatus = "verified" | "contradicted" | "partial" | "unverified" | "heuristic";
export interface Evidence { label: string; ref?: string; detail?: string }
export interface Claim { id: string; text: string; status: ClaimStatus; decidedBy: string; evidence: Evidence[] }
export interface Refusal { question: string; why: string; evidence: Evidence[]; routeTo: string }
export interface RiskFactor { id: string; label: string; points: number; evidence: Evidence[] }
export interface Side { signature: string; accessibility: string; text: string; startLine: number; endLine: number }
export interface TestPath { test: string; path: string[]; isNew: boolean }
export interface ReviewedMember {
  key: string; nodeId: string; name: string; csKind: string; file: string; changes: string[]; changedLines: number;
  publicApi: boolean; directCallers: number; transitiveCallers: number; tests: TestPath[]; flags: string[]; before?: Side; after?: Side;
}
export interface AgentDecision { decision: string; why: string; alternatives?: string; confidence: "sure" | "unsure"; evidence?: string }
export interface Receipt {
  id: string; branch: string; digest?: string; repo: string; baseSha: string; headSha: string; engineVersion: string;
  requirement: { id: string; title: string; source: string; intent: string; branch: string; kind: string };
  story: string[];
  summary: { files: number; added: number; deleted: number; readLines: number; totalLines: number; byClass: Record<string, { files: number; lines: number }> };
  files: { path: string; status: string; cls: string; added: number; deleted: number; inScope: boolean }[];
  members: ReviewedMember[];
  claims: Claim[]; refusals: Refusal[];
  risk: { score: number; factors: RiskFactor[]; tier: string; baseTier: string; tierLabel: string; tierMeaning: string; trustAdjustments: string[] };
  readList: { key: string; file: string; why: string[] }[];
  checked: { what: string; by: string }[]; notChecked: { what: string; why: string }[]; areas: string[];
  agent?: { runId: string; model?: string; agentVersion?: string; turns?: number; costUsd?: number; summary?: string; decisions: AgentDecision[]; steps: number };
}
export interface AgentStep { i: number; at: string; kind: string; title: string; detail?: string; file?: string }
export interface AgentRun {
  runId: string; requirementId: string; prompt: string; status: "running" | "done" | "failed"; branch: string; baseSha: string; headSha?: string; startedAt: string;
  worktree: string; model?: string; agentVersion?: string; turns?: number; costUsd?: number; durationMs?: number;
  steps: AgentStep[]; decisions: AgentDecision[]; openQuestions: string[]; summary?: string; error?: string; filesChanged?: string[];
  receiptId?: string; prUrl?: string; pageUrl?: string; slug?: string; publishError?: string;
  ci?: { headSha: string; passed: boolean; provider: string; at: string }[];
}
export interface ReqRow { id: string; title: string; kind: string; branch: string; receipts: string[] }
export interface RunRow { runId: string; requirementId: string; status: string; startedAt: string; branch: string; headSha?: string }
export interface PrRecord { url: string; number: number; branch: string; headSha: string; digest: string; slug?: string; pageUrl?: string }
export interface VerifyResult { url: string; state: string; verified: boolean; checks: { check: string; ok: boolean; detail: string }[] }
export interface Decision { at: string; actor: string; action: string; detail: string }

type Tab = "agent" | "receipt" | "signoff";
export interface MapNode { id: string; label: string; group: string; kind: string; file: string; members: number; usedBy: number; bucket?: boolean; count?: number }
export interface MapGroup { id: string; name: string; row: number; col: number; color: string; slots: number; about: string; types: number; rules: { prefixes: string[]; match: string | null } }
export interface RepoMap {
  title: string; sha: string; rows: { label: string }[]; groups: MapGroup[]; matchOrder: string[]; exclude: string[];
  nodes: MapNode[]; edges: { source: string; target: string; weight: number; description?: string; examples?: string[] }[];
  typeToNode: Record<string, string>; fileToNode: Record<string, string>;
  geometry: { width: number; height: number; nodes: Record<string, { x: number; y: number; r: number }>; groups: { id: string; path: string; labelX: number; labelY: number; cx: number; cy: number }[] };
}
export interface EvidenceGraph {
  nodes: { id: string; label: string; role: string; csKind: string; file: string; publicApi: boolean }[];
  edges: { source: string; target: string; relation: string; resolved: boolean }[];
}

interface TrustState {
  open: boolean;
  tab: Tab;
  reqs: ReqRow[];
  runs: RunRow[];
  run: AgentRun | null;
  receipt: Receipt | null;
  pr: PrRecord | null;
  verify: VerifyResult | null;
  log: Decision[];
  busy: string | null;
  error: string | null;
  selectedKey: string | null;
  graph: EvidenceGraph | null;
  map: RepoMap | null;
  playhead: number | null;
  playing: boolean;
  setPlayhead: (p: number | null) => void;
  setPlaying: (p: boolean) => void;
  view: "map" | "evidence";
  setView: (v: "map" | "evidence") => void;
  refresh: () => Promise<void>;
  matchRequirement: (prompt: string) => string | null;
  startFix: (prompt: string, requirementId: string) => Promise<void>;
  watchRun: (runId: string) => void;
  loadReceipt: (requirementId: string, runId?: string, fresh?: boolean) => Promise<void>;
  openPr: () => Promise<void>;
  verifyPr: () => Promise<void>;
  signoff: (args: { owner: string; decision: string; residualRisk: string; notes: string; refusalAnswers: Record<string, string>; checkedByOwner: string[] }) => Promise<void>;
  showHeadOnCanvas: () => Promise<void>;
  selectMember: (key: string) => void;
  setTab: (t: Tab) => void;
  close: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function overlayFrom(r: Receipt): LocalDiff {
  const nodes = r.members.map((m) => ({
    id: m.nodeId, status: m.changes.includes("added") ? "added" : m.changes.includes("removed") ? "removed" : "modified",
    file: m.file, name: m.name, reasons: m.changes,
  }));
  const count = (s: string) => nodes.filter((n) => n.status === s).length;
  const empty = { nodes: [], edges: [] } as unknown as Graph;
  const noEval = { rules: [], violations: [], insights: [] };
  return {
    baseSha: r.baseSha, headSha: r.headSha, baseRef: r.baseSha.slice(0, 8), baseBranch: "main", fetched: true, ahead: 1, behind: 0,
    workingTreeDirty: false, baseGraph: empty, headGraph: empty, baseEval: noEval, headEval: noEval,
    delta: { newViolations: [], resolvedViolations: [], newInsights: [], resolvedInsights: [] },
    fileStats: { filesChanged: r.files.map((f) => f.path), added: r.files.filter((f) => f.status === "A").length, modified: r.files.filter((f) => f.status === "M").length, deleted: r.files.filter((f) => f.status === "D").length },
    graphDelta: { nodes, edges: [], counts: { nodesAdded: count("added"), nodesRemoved: count("removed"), nodesModified: count("modified"), edgesAdded: 0, edgesRemoved: 0 } },
  } as unknown as LocalDiff;
}

// Canvas highlights are driven by the agent overlay (components/trust/RepoMap.tsx).
function paintCanvas(_r: Receipt) {}

export const useTrust = create<TrustState>((set, get) => ({
  open: false, tab: "agent", reqs: [], runs: [], run: null, receipt: null, pr: null, verify: null, log: [],
  busy: null, error: null, selectedKey: null, graph: null, view: "map", map: null, playhead: null, playing: false,
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),
  setView: (view) => set({ view }),

  refresh: async () => {
    const [reqs, runs] = await Promise.all([
      callTool<{ requirements: ReqRow[] }>("trust.list_requirements", {}),
      callTool<RunRow[]>("agent.list", {}),
    ]);
    const order = ["REQ-2283", "REQ-2234", "REQ-2297", "REQ-2129"];
    const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
    set({ reqs: [...reqs.requirements].sort((a, b) => rank(a.id) - rank(b.id)), runs });
    if (!get().map) set({ map: await callTool<RepoMap>("repo.map", {}) });
  },

  matchRequirement: (prompt) => {
    const m = /(?:#|REQ-|issue\s*|MP-|MPCS-)(\d{3,5})/i.exec(prompt);
    if (!m) return null;
    const id = `REQ-${m[1]}`;
    return get().reqs.some((r) => r.id === id) ? id : null;
  },

  startFix: async (prompt, requirementId) => {
    // The agent run shows in Studio's own plan panel; this panel is for reviewing receipts.
    set({ open: false, busy: "Starting Claude Code in an isolated worktree…", error: null, receipt: null, pr: null, verify: null });
    try {
      const run = await callTool<AgentRun>("agent.start", { requirementId, prompt });
      set({ run, busy: null });
      get().watchRun(run.runId);
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  watchRun: (runId) => {
    set({ playhead: null, playing: false, receipt: get().run?.runId === runId ? get().receipt : null });
    if (pollTimer) clearInterval(pollTimer);
    const tick = async () => {
      const run = await callTool<AgentRun>("agent.status", { runId });
      set({ run });

      // The server publishes automatically after the run: receipt, then PR with a live page.
      const finishedLongAgo = !!(run as { finishedAt?: string }).finishedAt && Date.now() - Date.parse((run as { finishedAt?: string }).finishedAt!) > 120_000;
      const settled = run.status === "failed" || !!run.receiptId || !!run.publishError || finishedLongAgo;
      if (run.status !== "running" && settled) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        void get().refresh();
        if (run.receiptId) {
          const receipt = await callTool<Receipt>("trust.receipt_get", { receiptId: run.receiptId });
          const pr = await callTool<PrRecord | null>("pr.get", { receiptId: run.receiptId }).catch(() => null);
          set({ receipt, pr, playhead: null, playing: false });
        } else if (run.status === "done") {
          await get().loadReceipt(run.requirementId, run.runId, true);
        }
      } else if (run.status === "done" && !get().busy) {
        set({ busy: "Claude finished. Building the evidence receipt…" });
      }
      if (settled && get().busy?.startsWith("Claude finished")) set({ busy: null });
    };
    void tick();
    pollTimer = setInterval(() => { void tick(); }, 2000);
  },

  loadReceipt: async (requirementId, runId, fresh = false) => {
    useStore.getState().setSidePanelView(null);
    // Agent runs are shown in Studio's plan panel; only organisers' branches open this panel.
    set({ open: runId ? get().open : true, busy: "Building evidence receipt: Roslyn AST diff + call graph…", error: null });
    try {
      const receipt = await callTool<Receipt>("trust.receipt", { requirementId, runId, cached: !fresh && !runId });
      void callTool<PrRecord | null>("pr.get", { receiptId: receipt.id }).then((pr) => { if (pr) set({ pr }); }).catch(() => undefined);
      set({ receipt, tab: runId ? get().tab : "receipt", busy: null, pr: null, verify: null, selectedKey: null, graph: null, view: "map", playhead: null, playing: !runId });
      void callTool<EvidenceGraph>("trust.graph", { receiptId: receipt.id, hops: 1 }).then((graph) => set({ graph })).catch(() => undefined);
      const ledger = await callTool<{ decisions: Decision[] }>("trust.ledger", { receiptId: receipt.id });
      set({ log: ledger.decisions });
      paintCanvas(receipt);
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  openPr: async () => {
    const r = get().receipt;
    if (!r) return;
    set({ busy: "Pushing the reviewed commit and opening a PR with the receipt…", error: null });
    try {
      const pr = await callTool<PrRecord>("pr.open", { receiptId: r.id });
      set({ pr, busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  verifyPr: async () => {
    const r = get().receipt;
    if (!r) return;
    set({ busy: "Checking the PR against the saved receipt…" });
    try {
      set({ verify: await callTool<VerifyResult>("pr.verify", { receiptId: r.id }), busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  signoff: async (args) => {
    const r = get().receipt;
    if (!r) return;
    set({ busy: "Recording sign-off…", error: null });
    try {
      await callTool("trust.signoff", { receiptId: r.id, ...args });
      const ledger = await callTool<{ decisions: Decision[] }>("trust.ledger", { receiptId: r.id });
      set({ busy: null, log: ledger.decisions });
      if (get().pr) await get().verifyPr();
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  showHeadOnCanvas: async () => {
    const { run, receipt } = get();
    const path = run?.worktree;
    if (!path || !receipt) return;
    set({ busy: "Opening the agent's version on the canvas…" });
    try {
      const open = await fetchApi("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
      const oj = await open.json();
      if (oj.error) throw new Error(oj.error);
      const res = await fetchApi("/api/load-graph", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const graph = json.graph as Graph;
      useStore.getState().loadGraph(graph, {
        label: `${receipt.requirement.id} · ${run.branch}`,
        subtitle: `agent head ${receipt.headSha.slice(0, 8)} · ${graph.nodes.length} nodes`,
        origin: "local", rootPath: path,
      } as never, { rules: json.rules, violations: json.violations, insights: json.insights } as never);
      paintCanvas(receipt);
      set({ busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  selectMember: (key) => {
    set({ selectedKey: key, tab: "receipt" });
    const m = get().receipt?.members.find((x) => x.key === key);
    // Focus the member on the repo map without opening Studio's generic inspector.
    if (m) useStore.setState({ focusTargetIds: new Set([m.nodeId]) } as never);
  },

  setTab: (tab) => set({ tab }),
  close: () => {
    set({ open: false, view: "map" });
    useStore.setState({ diffOverlayMode: "off", focusTargetIds: new Set<string>() } as never);
  },
}));
