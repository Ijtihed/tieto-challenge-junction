"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/state/store";
import { APPLICABLE_OPS, promptForOp } from "@/lib/ops";
import type { GraphNode } from "@/lib/types";

interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  divider?: never;
}
interface MenuDivider {
  divider: true;
  id: string;
  label?: never;
  hint?: never;
  run?: never;
}
type Item = MenuItem | MenuDivider;

interface Props {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
}

export default function NodeContextMenu({ x, y, nodeId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const workingGraph = useStore((s) => s.workingGraph);
  const level = useStore((s) => s.level);
  const selectNode = useStore((s) => s.selectNode);
  const drillInto = useStore((s) => s.drillInto);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const emitToast = useStore((s) => s.emitToast);

  // Close on outside click, escape, or scroll.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Resolve the node — could be a real graph node, a cluster id, or a module id.
  const isCluster = nodeId.startsWith("cluster:");
  const isModule = nodeId.startsWith("module:");
  const innerNode: GraphNode | undefined = workingGraph.nodes.find(
    (n) => n.id === nodeId,
  );
  const cluster = workingGraph.clusters.find((c) => c.id === nodeId);
  const moduleFile = isModule ? nodeId.replace(/^module:/, "") : null;

  const label = innerNode?.meta?.httpPath
    ? `${innerNode.meta.httpMethod} ${innerNode.meta.httpPath}`
    : innerNode?.name ?? cluster?.name ?? moduleFile ?? "Node";

  async function copyId() {
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(nodeId);
        ok = true;
      }
    } catch {
      /* fallback */
    }
    if (!ok && typeof document !== "undefined") {
      try {
        const ta = document.createElement("textarea");
        ta.value = nodeId;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* swallow */
      }
    }
    emitToast(ok ? "Copied" : "Copy failed");
    onClose();
  }

  const items: Item[] = [];

  // Inspect — always.
  items.push({
    id: "inspect",
    label: "Inspect",
    hint: "Opens inspector",
    run: () => {
      selectNode(nodeId);
      onClose();
    },
  });

  // Drill in — only at L1/L2 for clusters/modules.
  if (level < 3 && (isCluster || isModule)) {
    const segLabel = cluster?.name ?? moduleFile?.split("/").pop() ?? label;
    items.push({
      id: "drill",
      label: "Expand",
      hint: `→ ${level === 0 ? "Architecture" : level === 1 ? "Modules" : "Detail"}`,
      run: () => {
        drillInto({ id: nodeId, label: segLabel, level });
        onClose();
      },
    });
  }

  items.push({ divider: true, id: "div-1" });

  // Apply ops — only for real graph nodes.
  if (innerNode) {
    const ops = APPLICABLE_OPS[innerNode.kind] ?? [];
    for (const op of ops) {
      items.push({
        id: `op-${op}`,
        label: `Apply ${op}`,
        hint: "Runs a plan",
        run: () => {
          submitPrompt(promptForOp(op, innerNode.name));
          onClose();
        },
      });
    }
    if (ops.length > 0) items.push({ divider: true, id: "div-2" });
  }

  // Always available
  items.push({
    id: "copy",
    label: "Copy ID",
    hint: nodeId.length > 32 ? `${nodeId.slice(0, 32)}…` : nodeId,
    run: () => void copyId(),
  });

  // Position the menu, clamping to viewport.
  const MENU_W = 260;
  const MENU_H = items.length * 40 + 40;
  const left =
    typeof window !== "undefined"
      ? Math.min(x, window.innerWidth - MENU_W - 8)
      : x;
  const top =
    typeof window !== "undefined"
      ? Math.min(y, window.innerHeight - MENU_H - 8)
      : y;

  return (
    <div
      ref={ref}
      data-testid="node-context-menu"
      role="menu"
      style={{ left, top, width: MENU_W }}
      className="fixed z-[150] border border-outline bg-surface-container rounded-[10px] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-outline-variant">
        <p
          className="font-[JetBrains_Mono] text-xs text-on-surface truncate"
          title={label}
        >
          {label}
        </p>
        <p className="text-xs text-on-surface-faint mt-0.5">
          {isCluster ? "Cluster" : isModule ? "Module" : innerNode?.kind ?? "Node"}
        </p>
      </div>
      <ul className="py-1">
        {items.map((it) =>
          "divider" in it ? (
            <li
              key={it.id}
              className="border-t border-outline-variant my-1"
              role="separator"
            />
          ) : (
            <li key={it.id} role="none">
              <button
                role="menuitem"
                onClick={it.run}
                data-testid={`ctx-${it.id}`}
                className="w-full text-left px-3 py-2 hover:bg-surface-container-high transition-colors flex items-baseline justify-between gap-3"
              >
                <span className="text-xs text-on-surface">
                  {it.label}
                </span>
                {it.hint && (
                  <span className="text-xs text-on-surface-faint truncate shrink-0">
                    {it.hint}
                  </span>
                )}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
