// Per architecture/schema-v3.md §4.1 — the ONLY place these literals exist.
// Rule 6: ESLint schema/no-vocabulary-string-literal blocks usage elsewhere.

export const NODE_KINDS = {
  route_handler:  "route_handler",
  service:        "service",
  data_access:    "data_access",
  middleware:     "middleware",
  model:          "model",
  utility:        "utility",
  external:       "external",

  // Cross-language bridges [research:01.§2.3, research:03.§2]
  contract:       "contract",
  deployment:     "deployment",
} as const;
export type NodeKind = keyof typeof NODE_KINDS;

export const EDGE_RELATIONS = {
  imports:                "imports",
  calls:                  "calls",
  registers_route:        "registers_route",
  applies_middleware:     "applies_middleware",

  implements_contract:    "implements_contract",
  consumes_contract:      "consumes_contract",
  deploys_to:             "deploys_to",

  // Data-flow-lite edges [architecture/schema-v3.md §17.1]
  reads_field:            "reads_field",
  writes_field:           "writes_field",
  reads_table:            "reads_table",
  writes_table:           "writes_table",
  reads_env:              "reads_env",
  writes_env:             "writes_env",

  // CPG-derived edges (Fraunhofer-AISEC Code Property Graph)
  data_flow:              "data_flow",
  control_flow:           "control_flow",
  control_dependence:     "control_dependence",
  program_dependence:     "program_dependence",
} as const;
export type EdgeRelation = keyof typeof EDGE_RELATIONS;
