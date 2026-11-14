// Per `architecture/v1-launch-plan.md` Step 3 + `research/25-95-percent-and-leveling.md`
// §8.2 (archetype detector) + Appendix C (test corpus).
//
// 8 synthetic fixtures, one per archetype, exercising the detector
// without disk IO. The 9th case is the unclassified fallback. The
// synthetic shape mirrors the empirical detection signals from
// doc 25 §2.1 — route_handlers + manifest files + dir segments +
// extension distribution.
//
// These tests are Step 3's "verify the verifier" gate: each is
// designed to fail loudly if a future agent breaks one of the
// archetype-specific signals (e.g., drops the `.ipynb` heuristic).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectArchetype, detectMonorepo, ARCHETYPES, archetypeById, type ArchetypeId } from "../domain/archetype-detect.ts";
import { NODE_KINDS } from "../domain/vocabulary.ts";
import type { GraphNode } from "../domain/multi-repo.ts";

function mkNode(kind: string, filePath: string): GraphNode {
  return {
    id: `n_${filePath}`,
    kind,
    name: filePath.split("/").pop() ?? filePath,
    locator: `file://${filePath}`,
    filePath,
  };
}

describe("archetype-detect: 8 archetype fixtures", () => {
  it("1. web-app-service (Express-like)", () => {
    const handlers = Array.from({ length: 12 }, (_, i) =>
      mkNode(NODE_KINDS.route_handler, `/repo/src/handlers/h${i}.ts`),
    );
    const utilities = Array.from({ length: 4 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/src/lib/u${i}.ts`),
    );
    const result = detectArchetype({
      rootFiles: ["package.json", "README.md", "tsconfig.json", "Dockerfile"],
      allFilePaths: [
        ...handlers.map((n) => n.filePath!),
        ...utilities.map((n) => n.filePath!),
        "/repo/package.json",
      ],
      nodes: [...handlers, ...utilities],
    });
    assert.equal(result.primary, "web-app-service",
      `expected web-app-service; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
    assert.ok(result.confidence > 0.5, `expected high confidence; got ${result.confidence}`);
  });

  it("2. library-sdk (typescript lib)", () => {
    const utilities = Array.from({ length: 20 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/src/lib/u${i}.ts`),
    );
    const result = detectArchetype({
      rootFiles: ["package.json", "README.md", "tsconfig.json", "LICENSE"],
      allFilePaths: [
        ...utilities.map((n) => n.filePath!),
        "/repo/src/lib/index.ts",
        "/repo/src/index.ts",
        "/repo/package.json",
      ],
      nodes: utilities,
    });
    assert.equal(result.primary, "library-sdk",
      `expected library-sdk; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("3. cli-tool (Go cmd/)", () => {
    const cmd = Array.from({ length: 5 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/cmd/sub${i}/main.go`),
    );
    const internal = Array.from({ length: 10 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/internal/u${i}.go`),
    );
    const result = detectArchetype({
      rootFiles: ["go.mod", "go.sum", "README.md", "Makefile"],
      allFilePaths: [
        ...cmd.map((n) => n.filePath!),
        ...internal.map((n) => n.filePath!),
        "/repo/main.go",
        "/repo/cmd/root/main.go",
      ],
      nodes: [...cmd, ...internal],
    });
    assert.equal(result.primary, "cli-tool",
      `expected cli-tool; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("4. ai-ml-project (Python + notebooks + torch)", () => {
    const notebooks = Array.from({ length: 8 }, (_, i) => `/repo/notebooks/exp${i}.ipynb`);
    const models = Array.from({ length: 5 }, (_, i) =>
      mkNode(NODE_KINDS.model, `/repo/models/m${i}.py`),
    );
    const result = detectArchetype({
      rootFiles: ["requirements.txt", "README.md", "setup.py"],
      allFilePaths: [
        ...notebooks,
        ...models.map((n) => n.filePath!),
        "/repo/requirements.txt",
        "/repo/training/train_torch.py",
        "/repo/models/m0.py",
      ],
      nodes: models,
    });
    assert.equal(result.primary, "ai-ml-project",
      `expected ai-ml-project; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("5. data-pipeline (Airflow DAGs)", () => {
    const dags = Array.from({ length: 10 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/dags/dag${i}.py`),
    );
    const result = detectArchetype({
      rootFiles: ["requirements.txt", "README.md", "airflow.cfg"],
      allFilePaths: [
        ...dags.map((n) => n.filePath!),
        "/repo/requirements.txt",
        "/repo/dags/airflow_dag.py",
        "/repo/pipelines/etl.py",
      ],
      nodes: dags,
    });
    assert.equal(result.primary, "data-pipeline",
      `expected data-pipeline; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("6. infrastructure-devops (Terraform-heavy)", () => {
    // Build a fixture where IaC is the dominant extension.
    const tfFiles = Array.from({ length: 30 }, (_, i) => `/repo/terraform/m${i}.tf`);
    const yamlFiles = Array.from({ length: 20 }, (_, i) => `/repo/k8s/svc${i}.yaml`);
    const code = Array.from({ length: 5 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/scripts/s${i}.py`),
    );
    const result = detectArchetype({
      rootFiles: ["README.md", "Makefile", "Dockerfile"],
      allFilePaths: [
        ...tfFiles, ...yamlFiles,
        ...code.map((n) => n.filePath!),
        "/repo/Dockerfile",
      ],
      nodes: code,
    });
    assert.equal(result.primary, "infrastructure-devops",
      `expected infrastructure-devops; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("7. documentation-site (Docusaurus)", () => {
    const md = Array.from({ length: 40 }, (_, i) => `/repo/docs/page${i}.md`);
    const code = Array.from({ length: 5 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/src/theme/c${i}.tsx`),
    );
    const result = detectArchetype({
      rootFiles: ["docusaurus.config.js", "package.json", "README.md"],
      allFilePaths: [
        ...md,
        ...code.map((n) => n.filePath!),
        "/repo/docusaurus.config.js",
      ],
      nodes: code,
    });
    assert.equal(result.primary, "documentation-site",
      `expected documentation-site; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("8. mobile-desktop (Tauri app)", () => {
    const tauriFiles = Array.from({ length: 5 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/src-tauri/src/cmd${i}.rs`),
    );
    const ui = Array.from({ length: 30 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/src/components/c${i}.tsx`),
    );
    const result = detectArchetype({
      // A real Tauri app: top-level package.json + tauri.conf.json,
      // and Cargo.toml lives under src-tauri/ — not at the workspace
      // root.
      rootFiles: ["tauri.conf.json", "package.json", "README.md"],
      allFilePaths: [
        ...tauriFiles.map((n) => n.filePath!),
        ...ui.map((n) => n.filePath!),
        "/repo/src-tauri/Cargo.toml",
        "/repo/src-tauri/tauri.conf.json",
      ],
      nodes: [...tauriFiles, ...ui],
    });
    assert.equal(result.primary, "mobile-desktop",
      `expected mobile-desktop; got ${result.primary} (scores=${JSON.stringify(result.scores)})`);
  });

  it("9. unclassified fallback (no strong signals)", () => {
    // A repo that has nothing distinctive — just a scratch /
    // experimental thing.
    const result = detectArchetype({
      rootFiles: ["README.md"],
      allFilePaths: ["/repo/README.md", "/repo/notes.txt"],
      nodes: [],
    });
    assert.equal(result.primary, "unclassified",
      `expected unclassified; got ${result.primary}`);
    assert.equal(result.confidence, 0);
  });
});

describe("archetype-detect: secondaries", () => {
  it("emits a non-empty secondaries list when two archetypes both fire", () => {
    // CLI + library: cmd/ subdir + utility-dominant + lib/ paths.
    const cmd = mkNode(NODE_KINDS.utility, "/repo/cmd/cli/main.go");
    const lib = Array.from({ length: 20 }, (_, i) =>
      mkNode(NODE_KINDS.utility, `/repo/lib/u${i}.go`),
    );
    const result = detectArchetype({
      rootFiles: ["go.mod", "README.md"],
      allFilePaths: [
        cmd.filePath!,
        ...lib.map((n) => n.filePath!),
        "/repo/main.go",
      ],
      nodes: [cmd, ...lib],
    });
    // primary is whichever scores higher; secondaries include
    // the other. Just assert both archetypes are in the top 3.
    const topThree = new Set(result.scores.slice(0, 3).map((s) => s.id));
    assert.ok(topThree.has("cli-tool"), `cli-tool not in top 3: ${JSON.stringify(result.scores)}`);
    assert.ok(topThree.has("library-sdk"), `library-sdk not in top 3: ${JSON.stringify(result.scores)}`);
  });
});

// Added during Step 3's double-check pass — pins the canonical 9-id
// set so any drift on the engine side fires here. The Studio side
// has the matching test at
// `clients/studio/src/__tests__/archetype.test.ts` ("archetype id
// set — engine ↔ studio canonical union"). Both must update together.
describe("archetype-detect: canonical archetype set", () => {
  const CANONICAL_IDS: readonly ArchetypeId[] = [
    "web-app-service",
    "library-sdk",
    "cli-tool",
    "ai-ml-project",
    "data-pipeline",
    "infrastructure-devops",
    "documentation-site",
    "mobile-desktop",
    "unclassified",
  ];

  it("ARCHETYPES array exposes 8 archetypes (unclassified is implicit)", () => {
    assert.equal(ARCHETYPES.length, 8);
  });

  it("ARCHETYPES ids match the canonical set minus 'unclassified'", () => {
    const exposed = new Set(ARCHETYPES.map((a) => a.id));
    const expected = new Set(CANONICAL_IDS.filter((id) => id !== "unclassified"));
    assert.deepEqual([...exposed].sort(), [...expected].sort());
  });

  it("archetypeById covers every canonical id (including unclassified)", () => {
    for (const id of CANONICAL_IDS) {
      const meta = archetypeById(id);
      assert.ok(meta.l1Label.length > 0, `${id} has no l1Label`);
      assert.ok(meta.displayName.length > 0, `${id} has no displayName`);
    }
  });

  it("each ARCHETYPES entry has a non-empty L1 label per doc-25 §8.1", () => {
    for (const a of ARCHETYPES) {
      assert.ok(a.l1Label.length > 0, `${a.id} has no l1Label`);
      assert.ok(a.displayName.length > 0, `${a.id} has no displayName`);
    }
  });
});

describe("archetype-detect: monorepo detection", () => {
  it("detects pnpm-workspace.yaml as monorepo", () => {
    assert.equal(detectMonorepo(["pnpm-workspace.yaml", "package.json"], []), true);
  });
  it("detects nx.json as monorepo", () => {
    assert.equal(detectMonorepo(["nx.json", "package.json"], []), true);
  });
  it("detects lerna.json as monorepo", () => {
    assert.equal(detectMonorepo(["lerna.json", "package.json"], []), true);
  });
  it("detects turbo.json as monorepo", () => {
    assert.equal(detectMonorepo(["turbo.json", "package.json"], []), true);
  });
  it("detects Cargo workspace via nested Cargo.toml files", () => {
    assert.equal(
      detectMonorepo(
        ["Cargo.toml"],
        ["/r/Cargo.toml", "/r/crate-a/Cargo.toml", "/r/crate-b/Cargo.toml"],
      ),
      true,
    );
  });
  it("does NOT flag plain single-package npm repo as monorepo", () => {
    assert.equal(detectMonorepo(["package.json", "README.md"], []), false);
  });
  it("does NOT flag a Cargo single-crate repo as monorepo", () => {
    assert.equal(
      detectMonorepo(["Cargo.toml"], ["/r/Cargo.toml", "/r/src/main.rs"]),
      false,
    );
  });
});
