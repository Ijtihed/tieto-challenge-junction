# Datalog-Lite Rule Evaluator — spec

> **Implements:** `architecture/schema-v3.md §17.2`
>
> **Scope:** A lightweight Datalog-subset evaluator in TypeScript
> that runs over the `MultiRepoGraph`. Replaces the current
> "custom rules iterate all nodes and match globs" pattern with
> a declarative rule language. Target: v1.1.
>
> **Why not Soufflé/DDlog:** Both compile to native code (C++ /
> Rust). Bundling either violates Rule 11 (Node host) and Rule 3
> (binary ceiling). The graph is typically thousands of nodes,
> not millions — a naive semi-naive fixpoint evaluator in
> TypeScript handles this in <500 ms. If the graph grows past
> ~100K nodes, Soufflé can be added as an optional native
> accelerator behind a feature flag.

---

## 1. Language subset

Datalog-Lite is a strict subset of Datalog. No aggregates, no
functors, no negation-as-failure (stratified negation is v1.2),
no arithmetic beyond comparisons.

### 1.1 Grammar (PEG-style)

```
Program     ← Rule*
Rule        ← Head ':-' Body '.'
Head        ← Atom
Body        ← Atom (',' Atom)*
Atom        ← Predicate '(' TermList ')'
TermList    ← Term (',' Term)*
Term        ← Variable | StringLiteral | '_'
Variable    ← [A-Z][a-zA-Z0-9_]*
StringLiteral ← '"' [^"]* '"'
Predicate   ← [a-z][a-zA-Z0-9_]*
```

### 1.2 Built-in EDB predicates (extensional — from the graph)

These are automatically populated from the `MultiRepoGraph`
before evaluation. The user does not define them.

| Predicate | Arity | Arguments | Source |
|---|---|---|---|
| `node` | 3 | `(Id, Kind, Name)` | `GraphNode.id`, `.kind`, `.name` |
| `node_file` | 2 | `(Id, FilePath)` | `GraphNode.id`, `.filePath` |
| `node_loc` | 4 | `(Id, FilePath, StartLine, EndLine)` | `GraphNode.id`, `.filePath`, `.startLine`, `.endLine` |
| `edge` | 4 | `(Source, Relation, Target, EdgeId)` | `GraphEdge.source`, `.relation`, `.target`, `.id` |
| `contract` | 3 | `(Id, Scheme, Locator)` | Contract nodes: `.id`, locator scheme, `.locator` |
| `cluster` | 2 | `(ClusterId, NodeId)` | `Cluster.id`, member node ID |
| `repo` | 2 | `(RepoUri, NodeId)` | Repo URI, node ID |

**v1.1 addition (§17.1 data-flow-lite):**

| Predicate | Arity | Arguments | Source |
|---|---|---|---|
| `reads_field` | 2 | `(NodeId, FieldName)` | Inferred from AST |
| `writes_field` | 2 | `(NodeId, FieldName)` | Inferred from AST |
| `reads_table` | 2 | `(NodeId, TableName)` | From SQL bridge |
| `writes_table` | 2 | `(NodeId, TableName)` | From SQL bridge |
| `reads_env` | 2 | `(NodeId, EnvVar)` | Inferred from AST |
| `writes_env` | 2 | `(NodeId, EnvVar)` | Inferred from AST |

### 1.3 User-defined IDB predicates (intensional)

Users define derived predicates via rules:

```prolog
% "reachable" is a user-defined IDB predicate
reachable(X, Y) :- edge(X, "calls", Y, _).
reachable(X, Z) :- edge(X, "calls", Y, _), reachable(Y, Z).
```

### 1.4 The `violation` predicate

The built-in `violation/2` predicate is the output interface.
Any fact derived for `violation(RuleId, NodeId)` becomes a
`Violation` in the evaluation result:

```prolog
violation("no-controller-imports-driver", N) :-
  node(N, "service", _),
  edge(N, "imports", M, _),
  node(M, "data_access", _).
```

A `violation/3` variant adds a custom message:

```prolog
violation("auth-required", N, "Route skips auth middleware") :-
  node(N, "route_handler", _),
  not applies_middleware(N).
```

(Negation requires stratified evaluation — v1.2. In v1.1,
express the positive form via an auxiliary predicate.)

---

## 2. Evaluation algorithm

**Semi-naive evaluation** — the standard Datalog fixpoint
algorithm:

1. **Initialize EDB:** Populate `node/3`, `edge/4`, etc. from
   the `MultiRepoGraph`. Each predicate is stored as a
   `Set<string>` of serialized tuples (JSON arrays).

2. **First iteration:** For each rule, evaluate the body against
   the current facts. Any new head facts are added to a
   `deltaNew` set.

3. **Subsequent iterations:** For each rule, evaluate the body
   using only `deltaNew` facts from the previous iteration
   (the semi-naive optimization: only consider new facts, not
   re-derive existing ones). Newly derived facts go into the
   next `deltaNew`.

4. **Fixpoint:** When `deltaNew` is empty (no new facts derived),
   evaluation is complete.

5. **Extract violations:** Collect all `violation/2` and
   `violation/3` facts from the final fact set. Map each to a
   `Violation` object.

**Unification:** Simple structural unification on terms.
Variables bind to constants; `_` matches anything without
binding. Two variables unify if they share the same name within
a rule body (implicit join).

**Performance:** Semi-naive evaluation is polynomial in the size
of the EDB for non-recursive rules, and terminates in O(n^k)
iterations for recursive rules of depth k. For a 10K-node graph
with 200 non-recursive rules, each iteration scans ~10K tuples
× ~5 body atoms = ~50K unifications. With 200 rules: ~10M
unifications per iteration, <100 ms in TypeScript.

For recursive rules (reachability queries), the fixpoint
converges in O(diameter) iterations where diameter is the
longest path in the graph — typically <20 for software graphs.

---

## 3. File format and loading

### 3.1 Bundled rules

~50 rules ship in `src/domain/rules/bundled/`:

```
src/domain/rules/bundled/
  structural.dl      — the 4 existing built-in rules, rewritten
  bridges.dl         — contract/bridge integrity rules
  security.dl        — auth middleware, input validation patterns
  architecture.dl    — layer violations, dependency constraints
```

### 3.2 User rules

Users place `.dl` files in `.schema/rules/`:

```
.schema/rules/
  no-direct-db.dl
  auth-required.dl
  my-custom-rules.dl
```

These are loaded on `workspace.open` alongside bundled rules.

### 3.3 Rule metadata

Each `.dl` file can include metadata in a comment header:

```prolog
%% id: custom:no-direct-db
%% severity: error
%% description: Controllers must not import database drivers directly
%%

violation("no-direct-db", N) :-
  node(N, "service", _),
  edge(N, "imports", M, _),
  node(M, "data_access", _).
```

If `%% severity` is omitted, defaults to `warn`.
If `%% id` is omitted, the filename (without extension) is used.

---

## 4. MCP integration

### 4.1 `rules.add` upgrade

The existing `rules.add` action gains a `datalog` field:

```json
{
  "sessionId": "...",
  "rule": {
    "datalog": "violation(\"no-direct-db\", N) :- node(N, \"service\", _), edge(N, \"imports\", M, _), node(M, \"data_access\", _).",
    "severity": "error"
  }
}
```

When `datalog` is present, the rule is parsed and validated at
add time. Parse errors return `code: "invalid-datalog"` with
a line/column error message.

When `datalog` is absent, the existing `body` + `globs` path
continues to work (backward compatible).

### 4.2 `rules.evaluate` upgrade

`rules.evaluate` runs both:
1. The existing TypeScript built-in rules (4 current rules).
2. All Datalog rules (bundled + user + session-added).

Results are unified into the same `violations` array. Each
violation includes `source: "builtin" | "datalog"` to
distinguish.

### 4.3 New action: `rules.explain`

Given a violation, trace the derivation chain:

```json
{
  "sessionId": "...",
  "violationId": "..."
}
```

Returns the rule that produced the violation and the EDB facts
that matched each body atom. This is the Datalog equivalent of
"show me why this rule fired."

### 4.4 New action: `rules.query`

Run an ad-hoc Datalog query without defining a persistent rule:

```json
{
  "sessionId": "...",
  "query": "reachable(X, Y) :- edge(X, \"calls\", Y, _). reachable(X, Z) :- edge(X, \"calls\", Y, _), reachable(Y, Z). ?- reachable(\"node_abc123\", Y)."
}
```

Returns matching tuples. This powers the constraint-based
architectural search (§17.9).

---

## 5. Bundled rules catalog (50 rules, v1.1)

### 5.1 Structural (12 rules)

| Rule ID | Description |
|---|---|
| `no-cycle` | No directed cycles in the call/import graph |
| `must-have-handler` | Every route_handler has >=1 incoming edge |
| `must-have-inbound` | File nodes with outgoing edges have >=1 incoming |
| `must-have-outbound` | File nodes with incoming edges have >=1 outgoing |
| `no-orphan-node` | Every node has at least one edge |
| `no-self-loop` | No node calls/imports itself |
| `max-fan-out` | No node has >20 outgoing call edges |
| `max-fan-in` | No node has >50 incoming call edges |
| `single-responsibility` | No node has >3 distinct edge-relation types outgoing |
| `no-circular-imports` | No import cycles (stronger than no-cycle: imports only) |
| `contract-has-impl` | Every contract node has >=1 implements_contract edge |
| `contract-has-consumer` | Every contract node has >=1 consumes_contract edge |

### 5.2 Bridge integrity (8 rules)

| Rule ID | Description |
|---|---|
| `rest-impl-matches-spec` | REST contract locator matches an implementor |
| `grpc-impl-matches-proto` | gRPC contract has a matching service impl |
| `sql-model-has-access` | SQL contract has >=1 data_access node |
| `bridge-no-dangling` | No implements_contract edge targets a missing contract |
| `bridge-no-orphan-contract` | No contract node with zero edges |
| `cross-lang-coverage` | Each contract is implemented in >=1 language |
| `spec-source-consistency` | Contract locator path matches a real file |
| `bridge-bidirectional` | If A implements_contract C, some B consumes_contract C |

### 5.3 Security (10 rules)

| Rule ID | Description |
|---|---|
| `auth-on-route` | Every route_handler has an applies_middleware edge to an auth-shaped middleware |
| `no-hardcoded-secret` | No node name contains "password", "secret", "key" literals |
| `input-validation` | Route handlers have a validation middleware |
| `no-wildcard-cors` | No middleware node named "*cors*" with wildcard pattern |
| `https-only` | External nodes use https:// locators |
| `no-eval` | No node calls eval-shaped functions |
| `csrf-protection` | State-changing routes have CSRF middleware |
| `rate-limit-present` | Public routes have rate-limiting middleware |
| `no-sql-concat` | Data access nodes don't use string concatenation patterns |
| `error-handler-present` | Route handlers have error-handling middleware |

### 5.4 Architecture (12 rules)

| Rule ID | Description |
|---|---|
| `layer-no-upward-dep` | Services don't import route handlers |
| `layer-no-skip` | Route handlers don't directly import data_access |
| `middleware-no-data-access` | Middleware doesn't import data_access directly |
| `model-no-service-dep` | Models don't depend on services |
| `utility-no-domain-dep` | Utilities don't import domain-specific nodes |
| `no-god-service` | No service node with >15 outgoing edges |
| `deployment-has-service` | Every deployment node deploys >=1 service |
| `service-has-deployment` | Every service is deployed somewhere (if deployment nodes exist) |
| `max-module-depth` | No call chain exceeds 10 hops |
| `cluster-boundary-respect` | Cross-cluster edges are only via contracts |
| `no-shared-mutable-state` | No two services write the same field/table |
| `api-versioning` | REST contracts include version in path |

### 5.5 Data flow (8 rules, dependent on §17.1)

| Rule ID | Description |
|---|---|
| `read-before-write` | No node writes a field it never reads (potential dead write) |
| `table-access-through-model` | Table reads/writes go through a data_access node |
| `env-documented` | Every reads_env reference has a corresponding .env.example entry |
| `no-transitive-write` | Route handlers don't transitively write to >3 tables |
| `side-effect-in-middleware` | Middleware nodes should not write tables |
| `read-only-query-handler` | GET route handlers should not write tables |
| `write-isolation` | Each table is written by <=3 distinct services |
| `env-not-in-handler` | Route handlers don't read env vars directly |

---

## 6. Parser implementation

### 6.1 Location

`src/domain/datalog/`:

```
src/domain/datalog/
  parser.ts          — PEG parser for the Datalog subset
  evaluator.ts       — semi-naive fixpoint evaluator
  edb.ts             — EDB population from MultiRepoGraph
  types.ts           — AST types (Rule, Atom, Term, etc.)
  index.ts           — public API: parse + evaluate + query
```

### 6.2 Parser output (AST)

```typescript
interface DlProgram {
  rules: DlRule[];
  queries: DlQuery[];
  metadata: DlMetadata;
}

interface DlRule {
  head: DlAtom;
  body: DlAtom[];
  line: number;
}

interface DlAtom {
  predicate: string;
  terms: DlTerm[];
}

type DlTerm =
  | { kind: "variable"; name: string }
  | { kind: "string"; value: string }
  | { kind: "wildcard" };

interface DlQuery {
  atom: DlAtom;
  line: number;
}

interface DlMetadata {
  id?: string;
  severity?: "error" | "warn" | "info";
  description?: string;
}
```

### 6.3 Error reporting

Parse errors include line, column, and a human-readable message:

```typescript
interface DlParseError {
  line: number;
  column: number;
  message: string;
  source: string;  // the .dl file path or "inline"
}
```

---

## 7. Performance budget

| Metric | Target |
|---|---|
| EDB population (10K nodes, 50K edges) | <50 ms |
| Parse 50 bundled .dl files | <10 ms |
| Semi-naive evaluation (200 non-recursive rules, 10K-node graph) | <200 ms |
| Semi-naive evaluation (10 recursive rules, 10K-node graph) | <500 ms |
| Ad-hoc query (single reachability, 10K-node graph) | <100 ms |
| Total rules.evaluate roundtrip | <500 ms |

---

## 8. Backward compatibility

The 4 existing built-in rules (`no-cycle`, `must-have-handler`,
`must-have-inbound`, `must-have-outbound`) are rewritten as
Datalog in `bundled/structural.dl` but the TypeScript
implementations are kept as the reference. Both run; the Datalog
versions must produce identical violations (enforced by a
comparison test). Once confidence is established, the TypeScript
versions become dead code.

The `rules.add` action continues to accept `body` + `globs`
rules. These are internally wrapped as single-rule Datalog
programs that match the glob pattern. No breaking change.

---

## 9. Test plan

1. **Parser tests:** Valid and invalid Datalog programs.
   Edge cases: empty body, single-atom body, deeply nested
   variables, Unicode in string literals, missing period,
   duplicate rule heads.

2. **Evaluator tests:** Known-answer fixpoint evaluations.
   - Non-recursive: 3 rules, 10 facts, verify derived facts.
   - Recursive: transitive-closure on a 5-node chain, verify
     all reachable pairs.
   - Empty graph: no violations from any bundled rule.

3. **EDB population:** Verify `node/3` and `edge/4` match the
   `MultiRepoGraph` exactly.

4. **Bundled rule equivalence:** Each of the 4 existing built-in
   rules, evaluated via Datalog and via TypeScript, produce
   identical violations on 5 fixture graphs.

5. **User rules:** Load `.dl` files from a fixture `.schema/rules/`
   directory. Verify they parse, evaluate, and produce expected
   violations.

6. **Performance:** Benchmark evaluation on a synthetic 10K-node
   graph with 200 rules. Assert <500 ms.

7. **Error reporting:** Verify parse errors include correct line
   and column for 10 invalid-syntax fixtures.

8. **MCP integration:** `rules.add` with `datalog` field;
   `rules.evaluate` returns Datalog violations alongside
   built-in violations; `rules.query` returns matching tuples.

---

## 10. Dependencies

No new npm dependencies. The parser is hand-written (PEG-style
recursive descent). The evaluator uses `Set<string>` and `Map`
from the standard library. No external Datalog library.

---

## 11. Migration path to Soufflé (future)

If the graph grows past ~100K nodes and evaluation exceeds the
500 ms budget:

1. Add `@aspect-build/rules_js`-style Soufflé integration as an
   optional native addon.
2. The `.dl` file format is already valid Soufflé input (the
   subset is chosen to be compatible).
3. The TypeScript evaluator becomes the fallback when the native
   addon is not available.
4. Feature-flag: `SCHEMA_DATALOG_ENGINE=native|ts` (default
   `ts`).

This is not in scope for v1.1 — it's documented here to confirm
the language subset is forward-compatible with Soufflé.
