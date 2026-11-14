import { createHash } from "node:crypto";
import type { Receipt } from "./receipt.ts";
import { short } from "./receipt.ts";

/** Stable digest of a receipt (without its own digest field). */
export function receiptDigest(r: Receipt): string {
  const { digest: _omit, ...rest } = r as Receipt & { digest?: string };
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

const ICON: Record<string, string> = { verified: "✅", partial: "🟡", heuristic: "🟡", unverified: "⚪", contradicted: "❌" };
const ref = (s?: string) => (s ? (s.includes("/") ? `\`${s}\`` : `\`${short(s)}\``) : "");

export function receiptMarkdown(r: Receipt & { digest?: string; agent?: { runId: string; model?: string; agentVersion?: string; turns?: number; costUsd?: number; summary?: string; decisions: { decision: string; why: string; alternatives?: string; confidence: string; evidence?: string }[]; steps: number } }, extras?: { pageUrl?: string; steps?: string[]; revisions?: number }): string {
  const L: string[] = [];
  L.push(`> **AI review is advice with evidence. It does not approve this PR.** A named owner signs off below.`, "");
  if (extras?.pageUrl) {
    L.push(`### 🗺️ [Open the live review page](${extras.pageUrl})`);
    L.push(`Repo graph before and after this change, the agent's path through the code step by step, its decisions, and the evidence. Updates automatically when new commits land${extras.revisions && extras.revisions > 1 ? ` (revision ${extras.revisions})` : ""}.`, "");
  }
  L.push(`**${r.requirement.id}** · ${r.requirement.title} · [issue](${r.requirement.source})`, "");
  L.push(`### Verdict: ${r.risk.tierLabel} (risk score ${r.risk.score})`);
  L.push(`Owner reads **${r.summary.readLines} of ${r.summary.totalLines}** changed lines. ${r.risk.tierMeaning}`, "");
  L.push("### What the change does", ...r.story.map((s) => `- ${s}`), "");
  if (r.agent) {
    L.push(`### What the agent did and decided`);
    L.push(`Claude Code ${r.agent.agentVersion ?? ""} · ${r.agent.model ?? ""} · ${r.agent.turns ?? "?"} turns · ${r.agent.steps} recorded steps · run \`${r.agent.runId}\``, "");
    if (r.agent.summary) L.push(r.agent.summary, "");
    if (r.agent.decisions.length) {
      L.push("| Decision | Why | Confidence |", "|---|---|---|");
      for (const d of r.agent.decisions) L.push(`| ${d.decision.replace(/\|/g, "\\|")} | ${d.why.replace(/\|/g, "\\|")} | ${d.confidence === "unsure" ? "⚠️ unsure" : "sure"} |`);
      L.push("");
    }
  }
  if (extras?.steps?.length) {
    L.push(`<details><summary>Everything the agent did (${extras.steps.length} steps)</summary>`, "", ...extras.steps.map((s, i) => `${i + 1}. \`${s.replace(/`/g, "'").slice(0, 160)}\``), "", "</details>", "");
  }
  L.push("### Claims", "| | Claim | Decided by |", "|---|---|---|");
  for (const c of r.claims) L.push(`| ${ICON[c.status] ?? ""} ${c.status} | ${c.text.replace(/\|/g, "\\|")} | ${c.decidedBy} |`);
  L.push("");
  if (r.refusals.length) {
    L.push("### Refused to decide (owner must answer)");
    for (const q of r.refusals) L.push(`- **${q.question}**  \n  ${q.why}`);
    L.push("");
  }
  L.push("### Read these");
  for (const x of r.readList) L.push(`- ${ref(x.key)} (${x.why.join(", ")})`);
  L.push("", "<details><summary>Risk factors</summary>", "");
  for (const f of r.risk.factors) L.push(`- +${f.points} ${f.label}`);
  L.push("", "</details>", "", "<details><summary>Not checked</summary>", "");
  for (const n of r.notChecked) L.push(`- **${n.what}**: ${n.why}`);
  L.push("", "</details>", "");
  L.push(`---`, `receipt \`${r.id}\` · base \`${r.baseSha.slice(0, 8)}\` · head \`${r.headSha}\` · engine ${r.engineVersion}`);
  if (r.digest) L.push(`receipt-sha256: \`${r.digest}\``);
  return L.join("\n");
}
