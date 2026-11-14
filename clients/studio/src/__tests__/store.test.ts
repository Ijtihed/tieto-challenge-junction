// Per `architecture/v1-launch-plan.md` Step 2 — pins the load-bearing
// surface of the Zustand store. Step 5 (reactive layer) will rework
// graph state via `reactively`, and Step 6 (stacked-overlay
// persistence) will change how snapshots flow; these tests pin the
// public contracts the rest of Studio depends on so that work doesn't
// regress silently.
//
// Scope is intentionally narrow: connection status, toast queue,
// extraction stats. We do NOT exercise the canvas / plan / undo
// surfaces here — those are component-bound and covered by their own
// suites + the Playwright e2e set.

import { describe, it, expect, beforeEach } from "vitest";
import { useStore, type ExtractionStatsClient } from "../state/store";

beforeEach(() => {
  useStore.setState({
    mcpStatus: "connected",
    toasts: [],
    extractionStats: null,
    extractionBannerDismissed: false,
  });
});

describe("store — MCP status", () => {
  it("setMcpStatus updates the status field", () => {
    useStore.getState().setMcpStatus("disconnected");
    expect(useStore.getState().mcpStatus).toBe("disconnected");
    useStore.getState().setMcpStatus("reconnecting");
    expect(useStore.getState().mcpStatus).toBe("reconnecting");
    useStore.getState().setMcpStatus("connected");
    expect(useStore.getState().mcpStatus).toBe("connected");
  });
});

describe("store — toasts", () => {
  it("emitToast appends a toast row", () => {
    useStore.getState().emitToast("Snapshot saved");
    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.msg).toBe("Snapshot saved");
    expect(toasts[0]!.id).toBeTruthy();
    expect(toasts[0]!.until).toBeGreaterThan(Date.now());
  });

  it("emitToast preserves insertion order", () => {
    useStore.getState().emitToast("first");
    useStore.getState().emitToast("second");
    useStore.getState().emitToast("third");
    const toasts = useStore.getState().toasts;
    expect(toasts.map((t) => t.msg)).toEqual(["first", "second", "third"]);
  });
});

describe("store — extraction stats (Step 1 contract)", () => {
  function mkStats(failureCount: number): ExtractionStatsClient {
    return {
      filesAttempted: 100,
      filesParsed: 100 - failureCount,
      filesSkipped: failureCount,
      failures: Array.from({ length: failureCount }, (_, i) => ({
        filePath: `/f${i}.ts`,
        reason: "parse-failed" as const,
        extractorId: "extractor-typescript",
      })),
      perExtractor: [],
    };
  }

  it("setExtractionStats stores the stats and clears the dismissed flag", () => {
    // Pretend the user had previously dismissed an older banner.
    useStore.setState({ extractionBannerDismissed: true });
    const stats = mkStats(3);
    useStore.getState().setExtractionStats(stats);
    expect(useStore.getState().extractionStats).toBe(stats);
    expect(useStore.getState().extractionBannerDismissed).toBe(false);
  });

  it("setExtractionStats(null) clears the stats", () => {
    useStore.getState().setExtractionStats(mkStats(1));
    useStore.getState().setExtractionStats(null);
    expect(useStore.getState().extractionStats).toBe(null);
  });

  it("dismissExtractionBanner only flips the dismissed flag (not the stats)", () => {
    const stats = mkStats(5);
    useStore.getState().setExtractionStats(stats);
    useStore.getState().dismissExtractionBanner();
    expect(useStore.getState().extractionBannerDismissed).toBe(true);
    expect(useStore.getState().extractionStats).toBe(stats);
  });

  it("a fresh setExtractionStats resets a prior dismissal so a NEW extraction shows the banner again", () => {
    useStore.getState().setExtractionStats(mkStats(1));
    useStore.getState().dismissExtractionBanner();
    expect(useStore.getState().extractionBannerDismissed).toBe(true);
    // Simulate a new workspace.open that re-extracts and has failures.
    useStore.getState().setExtractionStats(mkStats(2));
    expect(useStore.getState().extractionBannerDismissed).toBe(false);
  });
});
