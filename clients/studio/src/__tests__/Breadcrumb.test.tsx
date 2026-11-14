// Per `architecture/v1-launch-plan.md` Step 3 — pin the
// archetype-aware breadcrumb. When the user drills into a
// `cluster:foo` segment, the kindLabel must render the singular
// form of the archetype L1 label (e.g. "service" for a web app,
// "module" for a library) — NOT "cluster" (the internal id).

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Breadcrumb from "../components/workspace/Breadcrumb";
import { useStore, type WorkspaceArchetypeClient, type ArchetypeIdClient } from "../state/store";
import type { Graph } from "../lib/types";

const EMPTY_GRAPH: Graph = { nodes: [], edges: [], clusters: [], rootDir: "/" };

function setStore(opts: {
  drillPath?: { id: string; label: string }[];
  archetype?: ArchetypeIdClient | null;
}) {
  const archetype: WorkspaceArchetypeClient | null = opts.archetype
    ? {
        primary: opts.archetype,
        secondaries: [],
        confidence: 1,
        scores: [{ id: opts.archetype, score: 1 }],
        monorepo: false,
      }
    : null;
  useStore.setState({
    drillPath: (opts.drillPath ?? []) as any,
    workingGraph: EMPTY_GRAPH as any,
    workspaceArchetype: archetype,
  });
}

beforeEach(() => {
  cleanup();
  setStore({});
});

describe("Breadcrumb — archetype-aware singular labels", () => {
  it("renders nothing when drillPath is empty", () => {
    const { container } = render(<Breadcrumb />);
    expect(container.querySelector('[data-testid="drill-banner"]')).toBeNull();
  });

  it("web app → 'Viewing service' for a cluster:* segment", () => {
    setStore({
      drillPath: [{ id: "cluster:auth", label: "Auth" }],
      archetype: "web-app-service",
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing service/i);
  });

  it("library/SDK → 'Viewing module' for a cluster:* segment", () => {
    setStore({
      drillPath: [{ id: "cluster:core", label: "Core" }],
      archetype: "library-sdk",
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing module/i);
  });

  it("CLI tool → 'Viewing command' for a cluster:* segment", () => {
    setStore({
      drillPath: [{ id: "cluster:build", label: "Build" }],
      archetype: "cli-tool",
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing command/i);
  });

  it("data pipeline → 'Viewing pipeline' for a cluster:* segment", () => {
    setStore({
      drillPath: [{ id: "cluster:ingest", label: "Ingest" }],
      archetype: "data-pipeline",
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing pipeline/i);
  });

  it("module: segment → 'Viewing file' regardless of archetype", () => {
    setStore({
      drillPath: [{ id: "module:/repo/src/foo.ts", label: "foo.ts" }],
      archetype: "library-sdk",
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing file/i);
  });

  it("fn: segment → 'Viewing symbol'", () => {
    setStore({
      drillPath: [{ id: "fn:abc123", label: "doStuff" }],
      archetype: "web-app-service",
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing symbol/i);
  });

  it("no archetype yet → falls back to 'Viewing area'", () => {
    setStore({
      drillPath: [{ id: "cluster:foo", label: "Foo" }],
      archetype: null,
    });
    render(<Breadcrumb />);
    expect(screen.getByTestId("drill-banner")).toHaveTextContent(/Viewing area/i);
  });

  it("forbids leaking the internal 'cluster' / 'module' / 'node' ids", () => {
    setStore({
      drillPath: [{ id: "cluster:foo", label: "Foo" }],
      archetype: "web-app-service",
    });
    render(<Breadcrumb />);
    const banner = screen.getByTestId("drill-banner");
    // The banner contains the "Viewing service" string AND a "All" link;
    // it must not contain the v1-era word "cluster" anywhere.
    expect(banner.textContent).not.toMatch(/Viewing cluster/i);
    expect(banner.textContent).not.toMatch(/Viewing module/i);
    expect(banner.textContent).not.toMatch(/Viewing node/i);
  });
});
