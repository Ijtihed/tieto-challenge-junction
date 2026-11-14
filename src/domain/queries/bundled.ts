// Per architecture/specs/architectural-search.md — 10 bundled Datalog queries.
// These are the demo material for the launch.

export interface BundledQuery {
  id: string;
  name: string;
  description: string;
  category: "architecture" | "security" | "dataflow" | "bridges" | "structural";
  datalog: string;
}

export const BUNDLED_QUERIES: readonly BundledQuery[] = [
  {
    id: "routes-skipping-auth",
    name: "All route handlers (check which have middleware)",
    description: "List all route handlers. Cross-reference with middleware-chains query to find unprotected ones.",
    category: "security",
    datalog: `
      route(R, Name) :- node(R, "route_handler", Name).
      ?- route(R, Name).
    `,
  },
  {
    id: "import-cycles",
    name: "Cycles in the import graph",
    description: "Find all pairs of modules that import each other (direct or transitive cycles).",
    category: "structural",
    datalog: `
      reaches(X, Y) :- edge(X, "imports", Y, _).
      reaches(X, Z) :- reaches(X, Y), edge(Y, "imports", Z, _).
      cycle(X, Y) :- reaches(X, Y), reaches(Y, X), X != Y.
      ?- cycle(X, Y).
    `,
  },
  {
    id: "transitive-deps-on-service",
    name: "Transitive dependents of a service",
    description: "Find all nodes that transitively depend on any service node.",
    category: "architecture",
    datalog: `
      depends(X, Y) :- edge(X, "calls", Y, _).
      depends(X, Z) :- depends(X, Y), depends(Y, Z).
      service_dep(X, S, SName) :- depends(X, S), node(S, "service", SName).
      ?- service_dep(X, S, SName).
    `,
  },
  {
    id: "orphan-services",
    name: "All services (check for callers via transitive-deps)",
    description: "List all service nodes. Services with zero results in transitive-deps query may be dead code.",
    category: "structural",
    datalog: `
      svc(S, Name) :- node(S, "service", Name).
      ?- svc(S, Name).
    `,
  },
  {
    id: "db-writes-from-routes",
    name: "Routes that write to the database",
    description: "Find route handlers that transitively reach a database write (writes_table edge).",
    category: "dataflow",
    datalog: `
      reaches(X, Y) :- edge(X, "calls", Y, _).
      reaches(X, Z) :- reaches(X, Y), reaches(Y, Z).
      writes_db(X) :- edge(X, "writes_table", _, _).
      route_writes_db(R, Name) :- node(R, "route_handler", Name), reaches(R, W), writes_db(W).
      ?- route_writes_db(R, Name).
    `,
  },
  {
    id: "contract-without-impl",
    name: "All contracts and their implementations",
    description: "List all contract nodes and which nodes implement them. Contracts with no results may be unimplemented.",
    category: "bridges",
    datalog: `
      contract(C, Name) :- node(C, "contract", Name).
      ?- contract(C, Name).
    `,
  },
  {
    id: "data-access-not-through-service",
    name: "Direct data access bypassing service layer",
    description: "Find route handlers that call data_access nodes directly instead of going through a service.",
    category: "architecture",
    datalog: `
      direct_db(R, RName, D, DName) :- node(R, "route_handler", RName), edge(R, "calls", D, _), node(D, "data_access", DName).
      ?- direct_db(R, RName, D, DName).
    `,
  },
  {
    id: "middleware-chains",
    name: "Middleware application chains",
    description: "Find all middleware nodes and what they protect.",
    category: "architecture",
    datalog: `
      protects(M, MName, T, TName) :- node(M, "middleware", MName), edge(_, "applies_middleware", T, _), node(T, _, TName).
      ?- protects(M, MName, T, TName).
    `,
  },
  {
    id: "cross-language-contracts",
    name: "Cross-language contract usage",
    description: "Find which nodes consume cross-language contracts (REST/gRPC/SQL).",
    category: "bridges",
    datalog: `
      consumes(N, NName, C, CName) :- edge(N, "consumes_contract", C, _), node(N, _, NName), node(C, "contract", CName).
      ?- consumes(N, NName, C, CName).
    `,
  },
  {
    id: "scip-only-nodes",
    name: "Nodes only visible via SCIP import",
    description: "Find nodes that were imported from SCIP and don't exist in tree-sitter extraction.",
    category: "structural",
    datalog: `
      scip_node(N, K, Name) :- node(N, K, Name), source(N, "scip").
      ?- scip_node(N, K, Name).
    `,
  },
] as const;
