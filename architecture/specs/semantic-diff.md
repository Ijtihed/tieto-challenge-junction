# Semantic Diff Enrichment — spec

> **Implements:** `architecture/schema-v3.md §17.6`
>
> **Scope:** Three enrichments to `graph.diff_against` and
> `pr.review` that upgrade the current file-level diff into a
> semantic-level diff. Target: v1.1 (months 1–3 post-launch).
>
> **Motivation:** The moat research identifies semantic diff as
> the strongest near-term moat item. "Your 800-line PR is
> semantically a 12-line change" is the single most compelling
> sentence for the `pr.review` wedge. The current implementation
> diffs at the file level — if a file changed, all nodes in that
> file are marked `modified`. This spec upgrades the diff to
> understand *what* changed, *how much* of the system it affects,
> and *whether it matters*.

---

## 1. Current state

`graph-diff-against.ts` runs `git diff --name-only` and
`git diff --numstat` against a ref, then marks every graph node
whose `filePath` appears in the changed-file set as `modified`.
Impact is file-level: a 1-line rename and a 500-line rewrite of
the same file both produce `status: "modified"`.

`pr-review.ts` calls `graph.diff_against` + `rules.evaluate`,
renders a markdown report with changed files, node counts, and
rule violations. No semantic analysis.

`delta.ts` has a `computeDelta(base, head)` function that
compares two `MultiRepoGraph` instances node-by-node and
edge-by-edge. It detects added/removed/modified nodes based on
property changes (name, kind, locator, filePath, startLine,
endLine). This is more precise than the git-based diff but is
only used when two full graphs are available.

---

## 2. Three enrichments

### 2.1 Refactoring detection

**Goal:** Classify each modified node as one of:

| Classification | Meaning |
|---|---|
| `renamed` | Same structure, different name |
| `moved` | Same name and structure, different file or location |
| `extracted` | A new node whose body was previously inline in another node |
| `inlined` | A node was removed and its body absorbed into a caller |
| `signature_changed` | Parameters, return type, or decorators changed; body unchanged |
| `modified` | Substantive body change (the default / fallback) |

**Algorithm:**

1. For each node with `status: "removed"` in the base, compute
   a **body fingerprint**: hash the tree-sitter CST of the
   function body (excluding comments and whitespace) into a
   32-bit FNV-1a hash.

2. For each node with `status: "added"` in the head, compute
   the same body fingerprint.

3. **Rename detection:** If a removed node and an added node
   share the same body fingerprint but differ in `name`, and
   they are in the same file, classify both as `renamed` and
   link them via `renamedFrom` / `renamedTo` fields.

4. **Move detection:** If a removed node and an added node
   share the same body fingerprint and `name` but differ in
   `filePath`, classify as `moved`.

5. **Extract detection:** If a removed node's body fingerprint
   partially matches (>70% of CST nodes shared) with a new
   node, and the removed node's caller now calls the new node,
   classify as `extracted`.

6. **Inline detection:** The inverse of extract — a removed
   node whose body appears inside a modified caller.

7. **Signature change:** If a modified node's body fingerprint
   is unchanged but its name, parameters (from tree-sitter
   parameter nodes), or decorator/attribute nodes changed,
   classify as `signature_changed`.

8. **Fallback:** Anything not caught above stays `modified`.

**Data model extension — `GraphDelta` changes:**

```typescript
interface NodeDelta {
  id: string;
  status: "added" | "removed" | "modified" | "unchanged";
  // New fields:
  classification?:
    | "renamed"
    | "moved"
    | "extracted"
    | "inlined"
    | "signature_changed"
    | "modified";
  renamedFrom?: string;  // node ID of the base counterpart
  renamedTo?: string;    // node ID of the head counterpart
  movedFrom?: string;    // file path in base
  movedTo?: string;      // file path in head
  extractedFrom?: string; // node ID of the original containing node
  inlinedInto?: string;   // node ID of the absorbing node
  reasons?: string[];
}
```

**Implementation location:** New file
`src/domain/refactoring-detect.ts`. Called from
`graph-diff-against.ts` after the file-level diff pass.

**Performance target:** <200 ms on a diff with 500 changed nodes
(typical large PR). The body fingerprint is computed during
extraction and cached on the node; the diff pass does map
lookups, not re-parsing.

### 2.2 Behavioral impact score

**Goal:** For each modified/added/removed node, compute:

- `impactedUpstream: number` — how many distinct callers
  (transitively) reach this node.
- `impactedDownstream: number` — how many distinct callees
  (transitively) are reachable from this node.
- `impactedContracts: string[]` — which contract nodes are
  transitively connected.

**Algorithm:**

1. For each node in the delta with `status !== "unchanged"`,
   run BFS upstream along `calls` / `imports` edges (reusing
   the logic in `graph-find-callers.ts`). Count distinct nodes
   reached. Cap BFS depth at 10 to bound runtime.

2. Run BFS downstream along `calls` edges (reusing
   `graph-find-callees.ts`). Count distinct nodes reached.
   Cap depth at 10.

3. Collect any `contract` nodes encountered in either traversal
   into `impactedContracts`.

4. Aggregate across all changed nodes for a PR-level summary:
   `totalImpactedNodes`, `totalImpactedContracts`.

**Data model extension — new fields on `GraphDelta`:**

```typescript
interface NodeDelta {
  // ... existing fields ...
  impactedUpstream?: number;
  impactedDownstream?: number;
  impactedContracts?: string[];
}

interface GraphDelta {
  // ... existing fields ...
  impactSummary?: {
    totalImpactedNodes: number;
    totalImpactedContracts: number;
    highestImpactNode?: { id: string; name: string; impact: number };
  };
}
```

**Implementation location:** New file
`src/domain/impact-score.ts`. Called from
`graph-diff-against.ts` after refactoring detection.

**Performance target:** <300 ms on a 10K-node graph. BFS is
O(V+E) per changed node, but with depth cap at 10 and typical
graph sparsity, each BFS touches <100 nodes. For a 50-node diff
on a 10K graph: 50 × 100 × 2 = 10K node visits, trivial.

### 2.3 Semantic no-op classification

**Goal:** Classify a PR-level diff as one of:

| Classification | Meaning |
|---|---|
| `semantic_noop` | All changes are renames, moves, whitespace, or comment-only edits. Zero behavioral impact. |
| `low_impact` | <5 nodes with `classification: "modified"` and `totalImpactedNodes < 10` |
| `high_impact` | >=5 substantively modified nodes or `totalImpactedNodes >= 50` |
| `mixed` | Contains both `semantic_noop` and `modified` changes |

**The headline sentence:** When `semantic_noop` or `mixed`:

> "This 847-line diff is semantically a 3-line change: 1
> function renamed, 2 files moved. 844 lines are mechanical
> consequences."

**Algorithm:**

1. After refactoring detection (§2.1) and impact scoring (§2.2),
   count nodes by classification.

2. If all non-unchanged nodes are `renamed`, `moved`, or
   `signature_changed` with zero downstream impact, classify
   the PR as `semantic_noop`.

3. If <5 nodes are `modified` (the substantive fallback) and
   total impact <10, classify as `low_impact`.

4. Otherwise classify as `high_impact` or `mixed`.

5. Generate the headline sentence by counting lines from
   `fileStats` and comparing against the number of
   substantively modified nodes.

**Data model extension — new fields on diff result:**

```typescript
interface SemanticDiffSummary {
  classification: "semantic_noop" | "low_impact" | "high_impact" | "mixed";
  headline: string;
  substantiveChanges: number;
  mechanicalChanges: number;
  totalLinesChanged: number;
}
```

**Implementation location:** New file
`src/domain/semantic-summary.ts`. Called from
`graph-diff-against.ts` as the final enrichment pass.

---

## 3. PR review markdown upgrade

The `pr.review` markdown output gains three new sections:

```markdown
## Schema PR Review

**Base:** `origin/main`

### Semantic summary

> **This 847-line diff is semantically a 3-line change.**
> 1 function renamed (`handleUser` → `processUser`),
> 2 files moved. 844 lines are mechanical consequences.

Classification: `low_impact`

### Changed files (12)
- `src/routes/user.ts` (+42, -38)
- ...

### Refactoring analysis
- `handleUser` → `processUser` (renamed)
- `src/old/auth.ts:validateToken` → `src/auth/validate.ts:validateToken` (moved)
- `processOrder` (modified — substantive)

### Behavioral impact
- **3** nodes substantively modified
- **47** upstream callers affected
- **12** downstream callees affected
- **2** contracts impacted: `POST /api/users`, `orders` table
- Highest-impact node: `processOrder` (23 upstream callers)

### Rule violations (0)

All rules pass.
```

---

## 4. Body fingerprint caching

To avoid re-parsing files during diff, each extractor computes a
**body fingerprint** during extraction and stores it on the node:

```typescript
interface GraphNode {
  // ... existing fields ...
  bodyFingerprint?: number; // FNV-1a 32-bit hash of CST body
}
```

The fingerprint is computed by:
1. Getting the tree-sitter node for the function body.
2. Walking the CST, skipping `comment` nodes.
3. Concatenating node types and text of leaf nodes.
4. Hashing with FNV-1a 32-bit.

This is cheap (<1 ms per function) and done during the existing
extraction pass. The fingerprint is stored in the graph and
persisted to SQLite (§17.7).

---

## 5. Wire format

No wire version bump required. The new fields (`classification`,
`impactedUpstream`, etc.) are optional additions to existing
types. Clients that don't understand them ignore them. The
`SemanticDiffSummary` is a new top-level field on the diff
result, also optional.

---

## 6. Test plan

1. **Rename detection:** Fixture with a function renamed between
   two commits. Assert `classification: "renamed"` and correct
   `renamedFrom` / `renamedTo` linkage.

2. **Move detection:** Fixture with a function moved to a
   different file. Assert `classification: "moved"`.

3. **Extract detection:** Fixture where inline code is extracted
   into a new function. Assert `classification: "extracted"`.

4. **Impact scoring:** Fixture with a deep call chain (A→B→C→D).
   Modify D. Assert `impactedUpstream >= 3` on the D node delta.

5. **Semantic no-op:** Fixture with a 20-file rename refactor.
   Assert `classification: "semantic_noop"` at the PR level and
   a headline like "This N-line diff is semantically a 0-line
   change."

6. **Mixed diff:** Fixture with renames + one real modification.
   Assert `classification: "mixed"`.

7. **PR review markdown:** Snapshot test on the rendered markdown
   output, checking for the new sections.

8. **Performance:** Benchmark body-fingerprint computation on a
   1000-function fixture. Assert <500 ms total.

---

## 7. Dependencies

No new npm dependencies. Uses existing tree-sitter bindings for
CST access and existing FNV-1a utility from `domain/locator.ts`.

---

## 8. Migration

Existing `GraphDelta` consumers see no breaking changes — all
new fields are optional. The `pr.review` markdown output gains
new sections but retains backward-compatible structure. No
wire version bump.
