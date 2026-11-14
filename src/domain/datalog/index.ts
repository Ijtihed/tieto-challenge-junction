// Per architecture/specs/datalog-lite.md §6.1

export type {
  DlProgram, DlRule, DlAtom, DlTerm, DlQuery, DlMetadata, DlParseError,
} from "./types.ts";
export { parseDatalog } from "./parser.ts";
export { populateEdb, type FactDb } from "./edb.ts";
export { evaluate, query, type EvalResult } from "./evaluator.ts";
export {
  IncrementalEvaluator, computeEdbDelta, deltaSize, isDeltaEmpty, type EdbDelta,
} from "./differential.ts";
