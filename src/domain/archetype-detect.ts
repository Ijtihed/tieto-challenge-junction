// Per `research/25-95-percent-and-leveling.md` §2.1 + §8 and
// `architecture/v1-launch-plan.md` Step 3.
//
// Pure deterministic archetype detector. Inputs:
//   - `rootFiles`: list of basenames in the repo root (the
//     workspace.open caller reads `fs.listDir(root, { recursive:
//     false })` and passes basenames).
//   - `allFilePaths`: every file path the extractors saw (for the
//     file-extension and directory-name signals).
//   - `nodes`: the RepoSubgraph nodes (for route_handler, model,
//     contract counts).
//
// Outputs `{ primary, secondaries, confidence }`. Primary is the
// single archetype id with the highest score; secondaries are any
// archetypes that reached ≥0.5 of the primary score. Confidence
// is the primary's normalized score in [0, 1].
//
// Adheres to the §6.2 ranking from doc 25: the eight archetypes
// in `ARCHETYPES` are the 95% coverage set. The 9th
// "unclassified" is implicit — when the highest score is below
// `MIN_CONFIDENCE`, primary becomes "unclassified".
//
// The detector is exposed at the `domain/` layer (pure data; no
// FS IO at this layer per the import DAG). The fs read happens in
// `actions/workspace-open.ts`.

import type { GraphNode } from "./multi-repo.ts";
import { NODE_KINDS } from "./vocabulary.ts";

export type ArchetypeId =
  | "web-app-service"
  | "library-sdk"
  | "cli-tool"
  | "ai-ml-project"
  | "data-pipeline"
  | "infrastructure-devops"
  | "documentation-site"
  | "mobile-desktop"
  | "unclassified";

export interface Archetype {
  readonly id: ArchetypeId;
  /** Display label per `[research:25.§8.1]`. */
  readonly l1Label: string;
  /** Long-form name for L0 hero copy. */
  readonly displayName: string;
}

/** Per [research:25.§8.1] — the L1 word per archetype.
 *  Order matters: `score()` ties broken by earlier-wins. */
export const ARCHETYPES: readonly Archetype[] = [
  { id: "web-app-service",       l1Label: "Services",  displayName: "Web app / service" },
  { id: "library-sdk",           l1Label: "Modules",   displayName: "Library / SDK" },
  { id: "cli-tool",              l1Label: "Commands",  displayName: "CLI tool" },
  { id: "ai-ml-project",         l1Label: "Notebooks", displayName: "AI / ML project" },
  { id: "data-pipeline",         l1Label: "Pipelines", displayName: "Data pipeline" },
  { id: "infrastructure-devops", l1Label: "Resources", displayName: "Infrastructure / DevOps" },
  { id: "documentation-site",    l1Label: "Sections",  displayName: "Documentation site" },
  { id: "mobile-desktop",        l1Label: "Areas",     displayName: "Mobile / desktop app" },
];

const UNCLASSIFIED: Archetype = {
  id: "unclassified", l1Label: "Areas", displayName: "Unclassified",
};

export function archetypeById(id: ArchetypeId): Archetype {
  if (id === "unclassified") return UNCLASSIFIED;
  return ARCHETYPES.find((a) => a.id === id) ?? UNCLASSIFIED;
}

export interface ArchetypeInput {
  /** Basenames of files in the workspace root (e.g.
   *  `["package.json", "Cargo.toml", "README.md"]`). */
  readonly rootFiles: readonly string[];
  /** Every file path the extractors saw across all repos. */
  readonly allFilePaths: readonly string[];
  /** All extracted graph nodes (kinds matter for route_handler
   *  + contract counts). */
  readonly nodes: readonly GraphNode[];
}

export interface ArchetypeResult {
  readonly primary: ArchetypeId;
  readonly secondaries: readonly ArchetypeId[];
  /** [0, 1]: normalised score of the primary archetype. */
  readonly confidence: number;
  /** Per-archetype raw scores, sorted descending. Surfaced for
   *  the Studio L0 hero so the user can see the runner-ups. */
  readonly scores: readonly { id: ArchetypeId; score: number }[];
}

const MIN_CONFIDENCE = 0.25;
const SECONDARY_THRESHOLD = 0.5;

/** Detect the archetype(s) of a single-repo workspace. */
export function detectArchetype(input: ArchetypeInput): ArchetypeResult {
  const root = new Set(input.rootFiles);
  const paths = input.allFilePaths;
  const nodes = input.nodes;

  const scores: Record<ArchetypeId, number> = {
    "web-app-service": 0,
    "library-sdk": 0,
    "cli-tool": 0,
    "ai-ml-project": 0,
    "data-pipeline": 0,
    "infrastructure-devops": 0,
    "documentation-site": 0,
    "mobile-desktop": 0,
    "unclassified": 0,
  };

  // Pre-compute frequently-used aggregates.
  const total = Math.max(paths.length, 1);
  const extCounts = countByExt(paths);
  const dirSegments = collectDirSegments(paths);

  // ── 1. Web app / web service ────────────────────────────────
  const routeHandlers = nodes.filter((n) => n.kind === NODE_KINDS.route_handler).length;
  if (routeHandlers >= 3) scores["web-app-service"] += 0.6;
  if (routeHandlers >= 10) scores["web-app-service"] += 0.2;
  if (root.has("next.config.js") || root.has("next.config.ts") || root.has("next.config.mjs")) {
    scores["web-app-service"] += 0.3;
  }
  if (root.has("nuxt.config.js") || root.has("nuxt.config.ts")) scores["web-app-service"] += 0.3;
  if (root.has("astro.config.mjs") || root.has("astro.config.ts")) scores["web-app-service"] += 0.2;
  if (dirSegments.has("public") && root.has("index.html")) scores["web-app-service"] += 0.2;

  // ── 2. Library / SDK ────────────────────────────────────────
  // (Definition: no route handlers + utility-dominant + has a
  //  conventional library entrypoint.)
  const utilities = nodes.filter((n) => n.kind === NODE_KINDS.utility).length;
  const utilRatio = utilities / Math.max(nodes.length, 1);
  if (routeHandlers === 0 && utilRatio >= 0.6) scores["library-sdk"] += 0.5;
  if (root.has("package.json")) scores["library-sdk"] += 0.1;
  if (paths.some((p) => /\/lib\//.test(p))) scores["library-sdk"] += 0.2;
  if (paths.some((p) => /\/src\/index\.(ts|tsx|js|jsx)$/.test(p))) scores["library-sdk"] += 0.2;
  if (paths.some((p) => /\/__init__\.py$/.test(p)) && !root.has("manage.py")) {
    scores["library-sdk"] += 0.15;
  }
  if (root.has("Cargo.toml") && !root.has("src/main.rs")) scores["library-sdk"] += 0.2;
  if (root.has("setup.py") || root.has("pyproject.toml")) scores["library-sdk"] += 0.1;

  // ── 3. CLI tool ─────────────────────────────────────────────
  if (paths.some((p) => /\/cmd\//.test(p))) scores["cli-tool"] += 0.4;
  if (paths.some((p) => /\/bin\//.test(p))) scores["cli-tool"] += 0.3;
  if (paths.some((p) => /\/main\.go$/.test(p))) scores["cli-tool"] += 0.3;
  if (paths.some((p) => /\/src\/main\.rs$/.test(p))) scores["cli-tool"] += 0.3;
  if (paths.some((p) => /\/cli\//.test(p))) scores["cli-tool"] += 0.2;
  if (routeHandlers === 0 && (root.has("Cargo.toml") || root.has("go.mod"))) {
    scores["cli-tool"] += 0.1;
  }

  // ── 4. AI / ML project ──────────────────────────────────────
  const notebookCount = extCounts["ipynb"] ?? 0;
  if (notebookCount > 0) scores["ai-ml-project"] += 0.4 + Math.min(notebookCount / 20, 0.3);
  if (dirSegments.has("models")) scores["ai-ml-project"] += 0.15;
  if (dirSegments.has("notebooks")) scores["ai-ml-project"] += 0.2;
  if (dirSegments.has("training") || dirSegments.has("inference")) {
    scores["ai-ml-project"] += 0.2;
  }
  if (matchesRequirement(input, /\b(torch|tensorflow|scikit-learn|transformers|jax|keras|huggingface)\b/i)) {
    scores["ai-ml-project"] += 0.3;
  }

  // ── 5. Data pipeline / ETL ──────────────────────────────────
  if (dirSegments.has("dags")) scores["data-pipeline"] += 0.4;
  if (dirSegments.has("pipelines")) scores["data-pipeline"] += 0.3;
  if (matchesRequirement(input, /\b(apache-airflow|prefect|dagster|luigi|beam|dbt-core)\b/i)) {
    scores["data-pipeline"] += 0.4;
  }
  if (paths.some((p) => /airflow|prefect|dagster/i.test(p))) scores["data-pipeline"] += 0.2;

  // ── 6. Infrastructure / DevOps ─────────────────────────────
  const iacExts = ["tf", "tfvars", "hcl", "yaml", "yml", "dockerfile"];
  const iacCount = iacExts.reduce((sum, e) => sum + (extCounts[e] ?? 0), 0);
  // Also count files named exactly "Dockerfile" (no extension).
  const dockerfileCount = paths.filter((p) => /\/Dockerfile(\.[^/]+)?$/.test(p)).length;
  const iacRatio = (iacCount + dockerfileCount) / total;
  if (iacRatio >= 0.5) scores["infrastructure-devops"] += 0.6;
  else if (iacRatio >= 0.25) scores["infrastructure-devops"] += 0.4;
  if (dirSegments.has("terraform")) scores["infrastructure-devops"] += 0.2;
  if (dirSegments.has("ansible")) scores["infrastructure-devops"] += 0.2;
  if (dirSegments.has("charts") || dirSegments.has("helm")) scores["infrastructure-devops"] += 0.2;
  if (dirSegments.has("kustomize")) scores["infrastructure-devops"] += 0.2;

  // ── 7. Documentation site ──────────────────────────────────
  if (root.has("mkdocs.yml")) scores["documentation-site"] += 0.7;
  if (root.has("docusaurus.config.js") || root.has("docusaurus.config.ts")) {
    scores["documentation-site"] += 0.7;
  }
  if (root.has("_config.yml")) scores["documentation-site"] += 0.5; // Jekyll
  if (root.has("config.toml") && paths.some((p) => /\/content\//.test(p))) {
    scores["documentation-site"] += 0.5; // Hugo
  }
  const mdRatio = (extCounts["md"] ?? 0) / total;
  if (mdRatio >= 0.6) scores["documentation-site"] += 0.3;
  else if (mdRatio >= 0.3) scores["documentation-site"] += 0.15;

  // ── 8. Mobile / desktop app ────────────────────────────────
  if (root.has("Info.plist")) scores["mobile-desktop"] += 0.5;
  if (root.has("AndroidManifest.xml")) scores["mobile-desktop"] += 0.5;
  if (paths.some((p) => /\.xcodeproj\//.test(p))) scores["mobile-desktop"] += 0.5;
  if (paths.some((p) => /\.xcworkspace\//.test(p))) scores["mobile-desktop"] += 0.3;
  if (root.has("tauri.conf.json")) scores["mobile-desktop"] += 0.4;
  if (dirSegments.has("src-tauri")) scores["mobile-desktop"] += 0.3;
  if (paths.some((p) => /electron-builder\.(yml|json|js)$/.test(p))) scores["mobile-desktop"] += 0.3;
  if (root.has("pubspec.yaml")) scores["mobile-desktop"] += 0.4; // Flutter

  // Ranking + confidence ─────────────────────────────────────
  const ranked = ARCHETYPES
    .map((a) => ({ id: a.id, score: scores[a.id] }))
    .sort((a, b) => b.score - a.score);

  const topScore = ranked[0]?.score ?? 0;

  if (topScore < MIN_CONFIDENCE) {
    return {
      primary: "unclassified",
      secondaries: [],
      confidence: 0,
      scores: ranked,
    };
  }

  const secondaries = ranked
    .slice(1, 3)
    .filter((r) => r.score >= topScore * SECONDARY_THRESHOLD && r.score >= MIN_CONFIDENCE)
    .map((r) => r.id);

  return {
    primary: ranked[0]!.id,
    secondaries,
    confidence: Math.min(topScore, 1),
    scores: ranked,
  };
}

/** Workspace-level monorepo detection per `[research:25.§9.3]`.
 *  Returns true when the root has any of the canonical monorepo
 *  markers. The `Workspace` level is only rendered when this
 *  fires AND the workspace contains multiple top-level
 *  package-bearing directories — but the caller (Studio) can
 *  also gate on `workspaceUris.length > 1` for explicit
 *  multi-repo opens. */
export function detectMonorepo(rootFiles: readonly string[], allFilePaths: readonly string[]): boolean {
  const root = new Set(rootFiles);
  if (root.has("nx.json")) return true;
  if (root.has("lerna.json")) return true;
  if (root.has("turbo.json")) return true;
  if (root.has("pnpm-workspace.yaml")) return true;

  // Cargo workspace: Cargo.toml with a `[workspace]` table at the
  // root. Caller passes the manifest content separately via
  // `allFilePaths` only — we approximate via the existence of
  // crate sub-dirs (Cargo.toml in subdirectories of root).
  if (root.has("Cargo.toml")) {
    const innerCargo = allFilePaths.filter((p) => /\/[^/]+\/Cargo\.toml$/.test(p));
    if (innerCargo.length >= 2) return true;
  }
  return false;
}

// ── helpers ─────────────────────────────────────────────────

function countByExt(paths: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of paths) {
    const base = p.split("/").pop() ?? "";
    const dotIdx = base.lastIndexOf(".");
    if (dotIdx <= 0) continue;
    const ext = base.slice(dotIdx + 1).toLowerCase();
    out[ext] = (out[ext] ?? 0) + 1;
  }
  return out;
}

function collectDirSegments(paths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    for (const seg of p.split("/")) {
      if (seg.length > 0) out.add(seg.toLowerCase());
    }
  }
  return out;
}

function matchesRequirement(input: ArchetypeInput, re: RegExp): boolean {
  // We don't have file contents at the domain layer; signal
  // strength via the file existence + paths. Callers that want
  // content-based signals can pre-process and add their findings
  // to `rootFiles` (e.g., the workspace-open layer can read
  // requirements.txt and inject "requires-torch" as a virtual
  // root entry). For now we only check filenames that contain
  // the keyword — coarse but useful (e.g., a path containing
  // "torch_models" still fires the AI/ML signal).
  for (const p of input.allFilePaths) {
    if (re.test(p)) return true;
  }
  return false;
}
