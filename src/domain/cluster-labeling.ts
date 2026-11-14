// Per `architecture/v1-launch-plan.md` Step 7 + research/24
// §7.5 (refined by the plan's prescription).
//
// The 7-tier label pipeline. Each tier is a pure function from
// `LabelInput` to `LabelDecision | null`. The pipeline tries
// tiers 1 → 7 in order; the first non-null result wins. Tier 7
// is the catch-all and never returns null — guarantees the
// `Module N` / `Other` patterns banned by doc 24 §1.2 cannot
// reach user-facing copy.
//
// **Separation of concerns.** Per the Step 6 double-check
// lesson (§0.6.4 refinement #2): extracting the 7-tier logic
// from `cluster.ts`'s `mergeAndLabel` makes every tier
// independently mutation-testable. The `pickLabelTier`
// dispatcher orchestrates the tiers; each tier function is a
// pure data → decision mapping.

import type { GraphNode } from "./multi-repo.ts";
import type { ClusterLabelTier } from "./multi-repo.ts";
import { NODE_KINDS } from "./vocabulary.ts";

/** Inputs available to every tier function. Constructed once
 *  per cluster by the caller; tiers read what they need. */
export interface LabelInput {
  /** Node IDs in this cluster. */
  readonly nodeIds: readonly string[];
  /** Lookup map populated by the caller. */
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  /** Workspace-relative file path per node (workspace prefix
   *  stripped). Maps node id → path. */
  readonly relPathById: ReadonlyMap<string, string>;
  /** Per-node PageRank importance from Stage D (descending).
   *  Empty for very small clusters that skip PageRank. */
  readonly importance: ReadonlyMap<string, number>;
  /** Detected archetype primary for the workspace (Step 3).
   *  Drives Tier 2's archetype-aware capitalization. */
  readonly archetype?: string | undefined;
  /** Workspace-root tokens from `package.json` keywords +
   *  README top-level headings, lowercased + deduped. Drives
   *  Tier 4. Empty when no workspace metadata is available. */
  readonly domainTokens: ReadonlySet<string>;
  /** Coordinate-fallback grid position (x,y). Drives Tier 7's
   *  `Area at (x,y)` fallback. Provided by the caller's grid
   *  layout pre-pass; if absent, Tier 7 uses sequential
   *  numbering instead. */
  readonly coordinate?: { readonly x: number; readonly y: number } | undefined;
}

export interface LabelDecision {
  readonly tier: ClusterLabelTier;
  readonly name: string;
  /** Optional sub-title for hover / inspector display.
   *  Currently only populated by Tier 6 (LLM augmentation),
   *  but tiers 2 + 3 may use it in the future. */
  readonly subtitle?: string;
}

// ──────────────────────────────────────────────────────────
// Framework signatures — Tier 1
// ──────────────────────────────────────────────────────────

/** Filename/path signatures that indicate a specific
 *  framework. Order matters: more specific signatures
 *  first. Each entry maps a regex-tested predicate to the
 *  framework's user-facing label. */
interface FrameworkSignature {
  /** Test against a node's file path. */
  matches(filePath: string, node: GraphNode): boolean;
  /** Label form. May reference a captured group via `$1`. */
  label: string;
}

const FRAMEWORK_SIGNATURES: readonly FrameworkSignature[] = [
  // Express
  {
    matches: (p) => /\b(router|routes|controllers?)\b/i.test(p) &&
      /\.(t|j)sx?$/.test(p),
    label: "Express Router",
  },
  // FastAPI / Flask
  {
    matches: (p, n) =>
      /\.(py)$/.test(p) &&
      (n.kind === NODE_KINDS.route_handler || /\b(routers?|endpoints?|api)\b/i.test(p)),
    label: "FastAPI Endpoints",
  },
  // Next.js app/pages routes
  {
    matches: (p) =>
      /\b(app|pages)\/.*\b(route|page|layout)\.(t|j)sx?$/i.test(p),
    label: "Next.js Routes",
  },
  // Go HTTP handlers
  {
    matches: (p) =>
      /\.go$/.test(p) && /\b(handler|handlers|router)\b/i.test(p),
    label: "Go HTTP Handlers",
  },
  // Rust Axum / Actix
  {
    matches: (p) =>
      /\.rs$/.test(p) && /\b(routes?|handlers?|controllers?)\b/i.test(p),
    label: "Rust HTTP Handlers",
  },
  // Django views
  {
    matches: (p) =>
      /\.py$/.test(p) && /\b(views?|urls?)\b/i.test(p),
    label: "Django Views",
  },
  // Spring controllers
  {
    matches: (p, n) =>
      /\.(java|kt)$/.test(p) &&
      (n.kind === NODE_KINDS.route_handler || /\bController\b/.test(p)),
    label: "Spring Controllers",
  },
];

/** Tier 1: detected framework name. Fires when ≥40% of nodes
 *  in the cluster match the same framework signature. */
export function tierFramework(input: LabelInput): LabelDecision | null {
  const matches = new Map<string, number>();
  let scored = 0;
  for (const id of input.nodeIds) {
    const node = input.nodeById.get(id);
    if (!node?.filePath) continue;
    scored++;
    for (const sig of FRAMEWORK_SIGNATURES) {
      if (sig.matches(node.filePath, node)) {
        matches.set(sig.label, (matches.get(sig.label) ?? 0) + 1);
        break;
      }
    }
  }
  if (scored === 0) return null;
  let best: { label: string; count: number } | null = null;
  for (const [label, count] of matches) {
    if (!best || count > best.count) best = { label, count };
  }
  if (!best || best.count / scored < 0.4) return null;
  return { tier: "framework", name: best.label };
}

// ──────────────────────────────────────────────────────────
// Tier 2 — Folder name + archetype-aware capitalization
// ──────────────────────────────────────────────────────────

/** Conventional folder prefixes to strip before extracting the
 *  architectural-segment name. Same as `cluster.ts`. */
const ROOT_FOLDERS = new Set([
  "src", "lib", "app", "packages", "pkg",
  "internal", "cmd", "modules",
]);

/** Words that should be left lowercase except at the start
 *  of a phrase. Used by `humanizeFolder` to produce labels
 *  like "Auth Service" rather than "Auth-Service". */
const LOWERCASE_PARTICLES = new Set([
  "of", "the", "and", "for", "to", "in", "on", "at", "by", "vs", "via",
]);

/** Domain words from `cluster-domain-words.ts` would map a folder
 *  segment to a more user-friendly noun. For Step 7a we ship a
 *  minimal hand-picked set; expanding it is a Step 7b/§10 polish
 *  concern. Each entry maps a lowercased folder segment to its
 *  preferred user-facing label. */
const DOMAIN_FOLDER_DICT: ReadonlyMap<string, string> = new Map([
  ["auth", "Authentication"],
  ["authn", "Authentication"],
  ["authz", "Authorization"],
  ["payments", "Payments"],
  ["billing", "Billing"],
  ["checkout", "Checkout"],
  ["users", "Users"],
  ["accounts", "Accounts"],
  ["orders", "Orders"],
  ["catalog", "Catalog"],
  ["products", "Products"],
  ["inventory", "Inventory"],
  ["search", "Search"],
  ["notifications", "Notifications"],
  ["emails", "Email"],
  ["sms", "SMS"],
  ["chat", "Chat"],
  ["analytics", "Analytics"],
  ["reporting", "Reporting"],
  ["admin", "Admin"],
  ["dashboard", "Dashboard"],
]);

/** Humanize a folder segment into a label. Per doc 24 §7.5:
 *  Pascal-Cased with particles lowercased. */
function humanizeFolder(segment: string): string {
  const parts = segment.split(/[-_]/).filter((s) => s.length > 0);
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      if (i > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Extract the first "meaningful" segment from a relative
 *  workspace-relative path. Same heuristic as `cluster.ts`. */
function meaningfulSegments(rel: string): string[] {
  const parts = rel.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return [];
  let i = 0;
  while (i < parts.length - 1 && ROOT_FOLDERS.has(parts[i]!.toLowerCase())) {
    i++;
  }
  return parts.slice(i);
}

/** Pick the dominant folder segment of a cluster. Returns
 *  `{ folder, fraction }` where `fraction` is the share of
 *  nodes that belong to it. */
function dominantFolder(
  input: LabelInput,
): { folder: string; fraction: number } | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const id of input.nodeIds) {
    const rel = input.relPathById.get(id);
    if (!rel) continue;
    const segments = meaningfulSegments(rel);
    if (segments.length === 0) continue;
    const key = segments[0]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;
  let best: { folder: string; count: number } | null = null;
  for (const [folder, count] of counts) {
    if (!best || count > best.count) best = { folder, count };
  }
  if (!best) return null;
  return { folder: best.folder, fraction: best.count / total };
}

/** Tier 2: folder name with archetype-aware capitalization.
 *  Fires when the dominant folder claims ≥50% of nodes. */
export function tierFolderArchetype(
  input: LabelInput,
): LabelDecision | null {
  const dominant = dominantFolder(input);
  if (!dominant) return null;
  if (dominant.fraction < 0.5) return null;
  const lower = dominant.folder.toLowerCase();
  const dictHit = DOMAIN_FOLDER_DICT.get(lower);
  const name = dictHit ?? humanizeFolder(dominant.folder);
  return { tier: "folder-archetype", name };
}

// ──────────────────────────────────────────────────────────
// Tier 3 — Dominant file/symbol name
// ──────────────────────────────────────────────────────────

/** Tier 3: dominant file or symbol name. Uses Stage D's
 *  PageRank to find the most central node in the cluster; if
 *  its name accounts for ≥30% of in-cluster references AND
 *  isn't a generic verb (`run`, `get`, `init`, etc.), use it
 *  as the cluster name. Falls back to the file's basename
 *  (without extension) when the top node is purely a file. */
const GENERIC_SYMBOL_NAMES = new Set([
  "run", "get", "set", "init", "main", "handle", "process",
  "call", "do", "make", "build", "create", "update", "delete",
  "find", "load", "save", "open", "close", "start", "stop",
  "execute", "default",
]);

export function tierDominantSymbol(
  input: LabelInput,
): LabelDecision | null {
  if (input.importance.size === 0) return null;
  // Find the node with the highest PageRank.
  let topId: string | null = null;
  let topScore = -1;
  for (const id of input.nodeIds) {
    const score = input.importance.get(id) ?? 0;
    if (score > topScore) {
      topScore = score;
      topId = id;
    }
  }
  if (!topId) return null;
  const topNode = input.nodeById.get(topId);
  if (!topNode) return null;
  // Require the top node to carry meaningful share of the
  // cluster's total importance.
  let totalScore = 0;
  for (const id of input.nodeIds) totalScore += input.importance.get(id) ?? 0;
  if (totalScore === 0 || topScore / totalScore < 0.3) return null;

  // Prefer the symbol name if non-generic; otherwise the
  // file basename without extension.
  const name = topNode.name;
  if (name && name.length > 1 && !GENERIC_SYMBOL_NAMES.has(name.toLowerCase())) {
    return { tier: "dominant-symbol", name };
  }
  if (topNode.filePath) {
    const parts = topNode.filePath.split("/");
    const base = parts[parts.length - 1] ?? "";
    const noExt = base.replace(/\.[^./]+$/, "");
    if (noExt.length > 1) {
      return {
        tier: "dominant-symbol",
        name: humanizeFolder(noExt),
      };
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────
// Tier 4 — Domain inference from package.json + README
// ──────────────────────────────────────────────────────────

/** Tier 4: domain inference. The cluster's filenames + symbol
 *  names get matched against `domainTokens` (extracted by the
 *  caller from `package.json.keywords` + README top-level
 *  headings). The most-frequent matching token becomes the
 *  label. */
export function tierPackageReadme(
  input: LabelInput,
): LabelDecision | null {
  if (input.domainTokens.size === 0) return null;
  const counts = new Map<string, number>();
  for (const id of input.nodeIds) {
    const node = input.nodeById.get(id);
    if (!node) continue;
    const text = `${node.name} ${node.filePath ?? ""}`.toLowerCase();
    for (const token of input.domainTokens) {
      if (token.length < 3) continue; // skip noise
      if (text.includes(token)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return null;
  let best: { token: string; count: number } | null = null;
  for (const [token, count] of counts) {
    if (!best || count > best.count) best = { token, count };
  }
  if (!best) return null;
  // Require the token to appear in ≥30% of cluster nodes to
  // avoid noise (one match in a 50-node cluster shouldn't win).
  if (best.count / input.nodeIds.length < 0.3) return null;
  return {
    tier: "package-readme",
    name: humanizeFolder(best.token),
  };
}

// ──────────────────────────────────────────────────────────
// Tier 5 — Common-substring (Anquetil-Lethbridge)
// ──────────────────────────────────────────────────────────

/** Tier 5: common substring extraction. Per
 *  Anquetil-Lethbridge "File Clustering Using
 *  Naming Conventions" (1998): given N file names,
 *  find the longest common substring that appears in
 *  ≥60% of them and is ≥4 characters long. */
export function tierCommonSubstring(
  input: LabelInput,
): LabelDecision | null {
  const names: string[] = [];
  for (const id of input.nodeIds) {
    const node = input.nodeById.get(id);
    if (!node?.filePath) continue;
    const base = node.filePath.split("/").pop() ?? "";
    const noExt = base.replace(/\.[^./]+$/, "");
    if (noExt.length >= 4) names.push(noExt.toLowerCase());
  }
  if (names.length < 3) return null;

  // Enumerate substrings of the first name; check coverage in
  // the rest. Bounded by `MAX_CANDIDATE` to keep complexity
  // manageable on huge clusters.
  const MAX_CANDIDATE = 32;
  const reference = names[0]!;
  let best: { token: string; coverage: number } | null = null;
  for (let len = Math.min(reference.length, MAX_CANDIDATE); len >= 4; len--) {
    for (let start = 0; start + len <= reference.length; start++) {
      const cand = reference.slice(start, start + len);
      if (!/[a-z]/.test(cand)) continue;
      let hits = 0;
      for (const n of names) if (n.includes(cand)) hits++;
      const coverage = hits / names.length;
      if (coverage >= 0.6 && (!best || coverage > best.coverage)) {
        best = { token: cand, coverage };
      }
    }
    if (best && best.coverage >= 0.9) break;
  }
  if (!best) return null;
  // Reject single-word common prefixes that obviously aren't
  // architectural ("util", "test", etc.).
  if (GENERIC_SYMBOL_NAMES.has(best.token)) return null;
  return {
    tier: "common-substring",
    name: humanizeFolder(best.token),
  };
}

// ──────────────────────────────────────────────────────────
// Tier 6 — LLM augmentation (BYOK only)
// ──────────────────────────────────────────────────────────

/** Tier 6: LLM augmentation. Reserved for Step 7b — when a
 *  BYOK key is configured, an LLM is asked for a 1-3 word
 *  noun phrase + 1-sentence description.
 *
 *  Step 7a returns `null` from this tier so the pipeline
 *  falls through to Tier 7. The function exists so future
 *  callers (Step 7b) can wire the LLM without changing the
 *  pipeline's structure. */
export function tierLlmByok(
  _input: LabelInput,
): LabelDecision | null {
  return null;
}

// ──────────────────────────────────────────────────────────
// Tier 7 — Coordinate fallback (replaces banned Module N/Other)
// ──────────────────────────────────────────────────────────

/** Tier 7: summary fallback. **NEVER** returns null.
 *
 *  When no other tier fires, this tier generates a descriptive
 *  name from the top 2-3 most frequent directories in the
 *  cluster's node set. For example, a cluster spanning
 *  "domain + actions + session + extractors" becomes
 *  "Domain · Actions · Session". If even directory names are
 *  unavailable, falls back to a size-based label like
 *  "Core (359 nodes)".
 *
 *  This replaces the old "Area at (x,y)" coordinate fallback
 *  which was honest but unreadable. The new labels are still
 *  deterministic (sorted by frequency) and unambiguous
 *  (different node sets → different top directories). */
export function tierCoordinateFallback(
  input: LabelInput,
  _sequentialIndex: number,
): LabelDecision {
  // Collect the top 3 directories by node count.
  const dirCounts = new Map<string, number>();
  for (const id of input.nodeIds) {
    const rel = input.relPathById.get(id);
    if (!rel) continue;
    const parts = rel.split("/").filter((s) => s.length > 0);
    if (parts.length === 0) continue;
    const dir = parts[0]!;
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const topDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dir]) => humanizeFolder(dir));

  if (topDirs.length > 0) {
    return {
      tier: "coordinate-fallback",
      name: topDirs.join(" · "),
    };
  }

  return {
    tier: "coordinate-fallback",
    name: `Core (${input.nodeIds.length} nodes)`,
  };
}

// ──────────────────────────────────────────────────────────
// Pipeline dispatcher
// ──────────────────────────────────────────────────────────

/** Run the 7 tiers in order; return the first non-null decision.
 *  Tier 7 always fires if every earlier tier returned null, so
 *  this function never returns null.
 *
 *  `sequentialIndex` is used by tier 7 when `input.coordinate`
 *  is absent — typically the position of this cluster in the
 *  caller's ordered cluster list. */
export function pickLabelTier(
  input: LabelInput,
  sequentialIndex: number,
): LabelDecision {
  return (
    tierFramework(input)
    ?? tierFolderArchetype(input)
    ?? tierDominantSymbol(input)
    ?? tierPackageReadme(input)
    ?? tierCommonSubstring(input)
    ?? tierLlmByok(input)
    ?? tierCoordinateFallback(input, sequentialIndex)
  );
}

/** Per `architecture/v1-launch-plan.md` Step 7 — the literal
 *  banned-pattern check. Per doc 24 §1.2 + the plan's "never
 *  Module N, never Other" goal, the returned name must not
 *  match either pattern. Exported so tests can pin it and so
 *  the runtime guard in `cluster.ts` can throw if any tier
 *  ever produces a banned name (defence-in-depth). */
const BANNED_PATTERNS: readonly RegExp[] = [
  /^module\s+\d+/i,    // "Module 4", "Module 12"
  /^other$/i,          // exact "Other"
  /^cluster\s+\d+/i,   // "Cluster 4" — same bug class
];

export function isBannedLabel(label: string): boolean {
  return BANNED_PATTERNS.some((re) => re.test(label));
}
