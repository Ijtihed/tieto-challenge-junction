"use client";

import { useEffect } from "react";
import { useStore } from "@/state/store";

export default function Shortcuts() {
  const goToLevel = useStore((s) => s.goToLevel);
  const setSidePanelView = useStore((s) => s.setSidePanelView);
  const setCheatSheetOpen = useStore((s) => s.setCheatSheetOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const cancelPlan = useStore((s) => s.cancelPlan);
  const selectNode = useStore((s) => s.selectNode);
  const undoLast = useStore((s) => s.undoLast);
  const popToSegment = useStore((s) => s.popToSegment);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);

      // Cmd/Ctrl-K opens search anywhere
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        setSearchOpen(true);
        e.preventDefault();
        return;
      }
      // Cmd/Ctrl-Z undoes — but NOT when the user is typing in an input
      // (native text undo should win in that case).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        if (!inField) {
          undoLast();
          e.preventDefault();
        }
        return;
      }
      // Cmd/Ctrl + 1/2/3 for level switching (demo-friendly)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (e.key === "1") { goToLevel(1); e.preventDefault(); return; }
        if (e.key === "2") { goToLevel(2); e.preventDefault(); return; }
        if (e.key === "3") { goToLevel(3); e.preventDefault(); return; }
        if (e.key === "0") { popToSegment(-1); goToLevel(1); e.preventDefault(); return; }
      }

      if (inField && e.key !== "Escape") return;

      const s = useStore.getState();

      // Shared cleanup when closing any panel — clear selection, focus,
      // and hover so the canvas doesn't stay dimmed with no visible
      // panel to explain why.
      function closePanel() {
        setSidePanelView(null);
        if (s.selectedNodeId) selectNode(null);
        if (s.selectedEdgeId) useStore.getState().selectEdge(null);
        useStore.setState({
          focusTargetIds: new Set<string>(),
          hoverInsightTargets: new Set<string>(),
          hoverViolationTargets: new Set<string>(),
          hoverPreviewTargets: new Set<string>(),
        });
      }

      function togglePanel(view: string) {
        if (s.sidePanelView === view) {
          closePanel();
        } else {
          setSidePanelView(view as any);
        }
      }

      if (e.key === "?") {
        setCheatSheetOpen(true);
        e.preventDefault();
      } else if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>(
          'input[type="text"]:not([data-testid="search-input"])',
        );
        if (input) {
          input.focus();
          e.preventDefault();
        }
      } else if (e.key === "Escape") {
        if (s.searchOpen) {
          setSearchOpen(false);
        } else if (s.cheatSheetOpen) {
          setCheatSheetOpen(false);
        } else if (s.planPhase === "preview" || s.planPhase === "streaming") {
          cancelPlan();
        } else if (s.sidePanelView) {
          closePanel();
        } else if (s.selectedNodeId || s.selectedEdgeId) {
          selectNode(null);
          if (s.selectedEdgeId) useStore.getState().selectEdge(null);
        } else if (s.bulkSelection.size > 0) {
          s.clearBulk();
        }
      } else if (e.key === "Backspace") {
        popToSegment(-1);
      } else if (e.key === "1") goToLevel(1);
      else if (e.key === "2") goToLevel(2);
      else if (e.key === "3") goToLevel(3);
      else if (e.key === "i") togglePanel("problems");
      else if (e.key === "r") togglePanel("rules");
      else if (e.key === "h") togglePanel("history");
      else if (e.key === "s") togglePanel("snapshots");
      else if (e.key === "a") togglePanel("summary");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    goToLevel,
    setSidePanelView,
    setCheatSheetOpen,
    setSearchOpen,
    cancelPlan,
    selectNode,
    undoLast,
    popToSegment,
  ]);

  return null;
}
