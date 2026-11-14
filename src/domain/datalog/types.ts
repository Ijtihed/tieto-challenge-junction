// Per architecture/specs/datalog-lite.md §6.2

export type DlTerm =
  | { kind: "variable"; name: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "wildcard" };

export interface DlAtom {
  predicate: string;
  terms: DlTerm[];
  negated?: boolean | undefined;
}

export interface DlRule {
  head: DlAtom;
  body: DlAtom[];
  line: number;
}

export interface DlQuery {
  atom: DlAtom;
  line: number;
}

export interface DlMetadata {
  id?: string | undefined;
  severity?: "error" | "warn" | "info" | undefined;
  description?: string | undefined;
}

export interface DlProgram {
  rules: DlRule[];
  queries: DlQuery[];
  metadata: DlMetadata;
}

export interface DlParseError {
  line: number;
  column: number;
  message: string;
  source: string;
}
