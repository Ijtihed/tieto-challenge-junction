"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

/**
 * Per-node `git blame` strip rendered inside the inspector.
 *
 * Fires `/api/git/blame` for the node's file + line range and renders
 * a compact "who last touched these lines" summary. Goals:
 *   - Cheap signal of code ownership without leaving the inspector.
 *   - Distinguishes uncommitted (working-tree) lines from committed
 *     ones — useful right after a Schema codemod runs.
 *   - Silently no-ops on the bundled fixture (no rootPath) and on
 *     non-git repos (the API returns `lines: []`).
 *
 * Doesn't refetch on every render — keyed on (rootPath, file, range)
 * so re-selecting the same node is free.
 */

interface BlameLine {
  line: number;
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  summary: string;
  uncommitted: boolean;
}

interface BlameResponse {
  relPath: string;
  startLine: number;
  endLine: number;
  lines: BlameLine[];
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: BlameResponse }
  | { kind: "error"; message: string };

export default function BlameStrip(props: {
  rootPath: string;
  relPath: string;
  startLine: number;
  endLine: number;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchApi("/api/git/blame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: props.rootPath,
        relPath: props.relPath,
        startLine: props.startLine,
        endLine: props.endLine,
      }),
    })
      .then(async (res) => {
        const json = (await res.json()) as
          | BlameResponse
          | { error: string; code: string };
        if (cancelled) return;
        if (!res.ok || "error" in json) {
          setState({
            kind: "error",
            message:
              "error" in json ? `${json.code} — ${json.error}` : `HTTP ${res.status}`,
          });
        } else {
          setState({ kind: "ready", data: json });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [props.rootPath, props.relPath, props.startLine, props.endLine]);

  if (state.kind === "loading") {
    return (
      <div
        data-testid="blame-loading"
        className="border border-outline-variant/60 bg-surface-dim px-3 py-2"
      >
        <p className="text-xs text-on-surface-muted">
          Loading blame...
        </p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        data-testid="blame-error"
        className="border border-outline-variant/60 bg-surface-dim px-3 py-2"
      >
        <p className="text-xs text-on-surface-muted mb-1">
          Blame unavailable
        </p>
        <p className="font-[JetBrains_Mono] text-xs text-on-surface-faint truncate">
          {state.message}
        </p>
      </div>
    );
  }
  if (state.kind !== "ready" || state.data.lines.length === 0) {
    return null;
  }

  // Group consecutive lines that share the same SHA into a single
  // strip entry. A function with one author has one entry, not N.
  const groups = groupBySha(state.data.lines);

  return (
    <div
      data-testid="blame-strip"
      className="border border-outline-variant/60 bg-surface-dim px-3 py-2 space-y-1.5"
    >
      <p className="text-xs text-on-surface-muted">
        Blame · {state.data.startLine}–{state.data.endLine}
      </p>
      {groups.map((g, i) => (
        <div
          key={`${g.sha}:${i}`}
          data-testid={`blame-group-${g.sha.slice(0, 7)}`}
          data-uncommitted={g.uncommitted ? "true" : "false"}
          className={`flex items-baseline justify-between gap-3 ${
            g.uncommitted ? "text-phase-applying" : "text-on-surface"
          }`}
        >
          <div className="min-w-0 flex items-baseline gap-2">
            <span className="font-[JetBrains_Mono] text-xs tabular-nums text-on-surface-faint shrink-0">
              {g.startLine === g.endLine
                ? `L${g.startLine}`
                : `L${g.startLine}–${g.endLine}`}
            </span>
            <span
              className={`font-[JetBrains_Mono] text-xs truncate ${
                g.uncommitted ? "italic" : ""
              }`}
            >
              {g.uncommitted ? "uncommitted (working tree)" : g.summary}
            </span>
          </div>
          <div className="shrink-0 flex items-baseline gap-2">
            <span className="font-[JetBrains_Mono] text-xs text-on-surface-muted">
              {g.author || "—"}
            </span>
            <span
              title={g.sha}
              className="font-[JetBrains_Mono] text-xs text-on-surface-faint tabular-nums"
            >
              {g.uncommitted ? "—" : g.shortSha}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface BlameGroup {
  sha: string;
  shortSha: string;
  author: string;
  summary: string;
  uncommitted: boolean;
  startLine: number;
  endLine: number;
}

function groupBySha(lines: BlameLine[]): BlameGroup[] {
  const out: BlameGroup[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last && last.sha === line.sha) {
      last.endLine = line.line;
      continue;
    }
    out.push({
      sha: line.sha,
      shortSha: line.shortSha,
      author: line.author,
      summary: line.summary,
      uncommitted: line.uncommitted,
      startLine: line.line,
      endLine: line.line,
    });
  }
  return out;
}
