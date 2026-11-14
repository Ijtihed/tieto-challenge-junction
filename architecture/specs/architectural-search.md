# Constraint-Based Architectural Search (v1.0 Moat Slice M-C)

Per architecture/schema-v3.md §17.9. The Datalog evaluator is
already shipped (§17.2). This slice is the UX surface.

---

## 1. Goal

Expose the Datalog engine as a user-facing search tool with
10 bundled queries that demonstrate architectural reasoning
beyond grep/text-search.

## 2. Components

### graph.query (extended)

- Accepts `query` (ad-hoc Datalog text) OR `bundledQueryId`
- `limit` parameter (default 100)
- Returns enriched results with node metadata

### graph.list_queries (new)

- Returns all 10 bundled queries with id/name/description/category
- No sessionId required

### Bundled Queries (10)

| ID | Name | Category |
|---|---|---|
| routes-skipping-auth | Routes that skip auth middleware | security |
| import-cycles | Cycles in the import graph | structural |
| transitive-deps-on-service | Transitive dependents of a service | architecture |
| orphan-services | Orphan services with no callers | structural |
| db-writes-from-routes | Routes that write to the database | dataflow |
| contract-without-impl | Contracts without implementations | bridges |
| data-access-not-through-service | Direct data access bypassing service layer | architecture |
| middleware-chains | Middleware application chains | architecture |
| cross-language-contracts | Cross-language contract usage | bridges |
| scip-only-nodes | Nodes only visible via SCIP import | structural |

## 3. Acceptance

- All 10 bundled queries run without error on the fixture
- Invalid Datalog syntax returns a parse error, not a crash
- Query results are deterministic across runs
