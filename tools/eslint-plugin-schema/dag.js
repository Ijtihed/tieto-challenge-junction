// Per architecture/schema-v3.md §1 Rule 5 + §3.12
// Reads architecture/dag.json; fails on cross-layer imports outside the allowlist.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let dagData;
try {
  const dagPath = resolve(__dirname, "../../architecture/dag.json");
  dagData = JSON.parse(readFileSync(dagPath, "utf-8"));
} catch {
  dagData = null;
}

function getLayer(filename) {
  const match = filename.match(/\/src\/([^/]+)\//);
  return match ? match[1] : null;
}

export const dagRule = {
  meta: {
    type: "problem",
    docs: { description: "Enforce the module DAG from architecture/dag.json" },
    schema: [],
  },
  create(context) {
    if (!dagData) return {};

    const filename = context.filename ?? context.getFilename();
    const sourceLayer = getLayer(filename);
    if (!sourceLayer) return {};
    // Layers declared in `dagData.layers` but missing from
    // `dagData.allowed` are treated as "may import from nothing else in
    // src/" (the canonical example is `obs` — it sits at the root of
    // the DAG and depends only on node builtins). Layers not declared
    // at all (e.g. cli/, __tests__/) are out of scope.
    if (!dagData.layers || !dagData.layers.includes(sourceLayer)) return {};

    const allowedDeps = dagData.allowed[sourceLayer] ?? [];

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        // Only check relative imports that resolve inside `/src/`.
        // Bare imports (npm packages, node:builtins) and any path
        // outside src/ are out of scope for the layered DAG.
        if (!source.startsWith(".")) return;

        // Type-only imports (`import type { Foo } from ...`) describe
        // a contract, not a runtime dependency — they are erased at
        // compile time. Allow them across the DAG so contracts can
        // flow up without dragging runtime code with them. (The
        // canonical case: `obs/event-log.ts` reads
        // `import type { MultiRepoGraph } from "../domain/..."` to
        // type the events it emits, but doesn't import any runtime
        // `domain` module.)
        if (node.importKind === "type") return;

        const resolved = resolve(dirname(filename), source);
        if (!resolved.includes("/src/")) return;

        const targetLayer = getLayer(resolved);
        if (!targetLayer || targetLayer === sourceLayer) return;

        if (!allowedDeps.includes(targetLayer)) {
          context.report({
            node,
            message: `DAG violation: '${sourceLayer}' may not import from '${targetLayer}'. Allowed: [${allowedDeps.join(", ")}]. See architecture/schema-v3.md §3.12.`,
          });
        }
      },
    };
  },
};
