// Per architecture/specs/datalog-lite.md §6.1 — PEG-style recursive descent parser.

import type { DlProgram, DlRule, DlAtom, DlTerm, DlQuery, DlMetadata, DlParseError } from "./types.ts";

export function parseDatalog(source: string, filename = "inline"): DlProgram | DlParseError {
  const metadata = parseMetadata(source);
  const rules: DlRule[] = [];
  const queries: DlQuery[] = [];

  let pos = 0;
  const cleaned = stripComments(source);

  while (pos < cleaned.length) {
    skipWhitespace();
    if (pos >= cleaned.length) break;

    if (cleaned[pos] === "?" && cleaned[pos + 1] === "-") {
      const queryResult = parseQuery();
      if ("message" in queryResult) return queryResult;
      queries.push(queryResult);
    } else {
      const ruleResult = parseRule();
      if ("message" in ruleResult) return ruleResult;
      rules.push(ruleResult);
    }
  }

  return { rules, queries, metadata };

  function stripComments(s: string): string {
    return s.split("\n").map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "%" && (i === 0 || line[i - 1] !== "\\")) {
          return line.slice(0, i);
        }
        if (line[i] === '"') {
          i++;
          while (i < line.length && line[i] !== '"') {
            if (line[i] === "\\") i++;
            i++;
          }
        }
      }
      return line;
    }).join("\n");
  }

  function parseMetadata(s: string): DlMetadata {
    const meta: DlMetadata = {};
    for (const line of s.split("\n")) {
      const m = line.match(/^%%\s*(\w+):\s*(.+)/);
      if (!m) continue;
      const key = m[1]!.trim();
      const val = m[2]!.trim();
      if (key === "id") meta.id = val;
      else if (key === "severity") meta.severity = val as DlMetadata["severity"];
      else if (key === "description") meta.description = val;
    }
    return meta;
  }

  function lineAt(): number {
    let line = 1;
    for (let i = 0; i < pos && i < cleaned.length; i++) {
      if (cleaned[i] === "\n") line++;
    }
    return line;
  }

  function colAt(): number {
    let col = 1;
    for (let i = pos - 1; i >= 0; i--) {
      if (cleaned[i] === "\n") break;
      col++;
    }
    return col;
  }

  function err(msg: string): DlParseError {
    return { line: lineAt(), column: colAt(), message: msg, source: filename };
  }

  function skipWhitespace(): void {
    while (pos < cleaned.length && /\s/.test(cleaned[pos]!)) pos++;
  }

  function peek(n = 1): string {
    return cleaned.slice(pos, pos + n);
  }

  function parseRule(): DlRule | DlParseError {
    const line = lineAt();
    const head = parseAtom();
    if ("message" in head) return head;

    skipWhitespace();
    if (cleaned.slice(pos, pos + 2) !== ":-") {
      return err("expected ':-' after rule head");
    }
    pos += 2;
    skipWhitespace();

    const body: DlAtom[] = [];
    const firstAtom = parseBodyAtom();
    if ("message" in firstAtom) return firstAtom;
    body.push(firstAtom);

    while (true) {
      skipWhitespace();
      if (pos >= cleaned.length) return err("expected '.' at end of rule");
      if (cleaned[pos] === ".") { pos++; break; }
      if (cleaned[pos] !== ",") return err("expected ',' or '.' in rule body");
      pos++;
      skipWhitespace();
      const atom = parseBodyAtom();
      if ("message" in atom) return atom;
      body.push(atom);
    }

    return { head, body, line };
  }

  function parseBodyAtom(): DlAtom | DlParseError {
    skipWhitespace();

    // Handle negation: "not predicate(...)"
    let negated = false;
    if (cleaned.slice(pos, pos + 4) === "not " || cleaned.slice(pos, pos + 4) === "not\t") {
      negated = true;
      pos += 3;
      skipWhitespace();
    }

    // Handle unsupported constructs — skip to end of body atom
    // Detect "Variable = count : { ... }" or "Variable != Variable" or "Variable > Number"
    if (pos < cleaned.length && /[A-Z]/.test(cleaned[pos]!)) {
      const lookahead = cleaned.slice(pos, pos + 300);
      const compMatch = lookahead.match(/^[A-Z]\w*\s*(!=|=|>|<|>=|<=)\s*/);
      if (compMatch) {
        let depth = 0;
        while (pos < cleaned.length) {
          if (cleaned[pos] === "{") depth++;
          else if (cleaned[pos] === "}") depth--;
          else if (depth === 0 && (cleaned[pos] === "," || cleaned[pos] === ".")) break;
          pos++;
        }
        return { predicate: "__unsupported__", terms: [], negated };
      }
    }

    const atom = parseAtom();
    if ("message" in atom) return atom;
    if (negated) atom.negated = true;
    return atom;
  }

  function parseQuery(): DlQuery | DlParseError {
    const line = lineAt();
    pos += 2; // skip ?-
    skipWhitespace();
    const atom = parseAtom();
    if ("message" in atom) return atom;
    skipWhitespace();
    if (pos < cleaned.length && cleaned[pos] === ".") pos++;
    return { atom, line };
  }

  function parseAtom(): DlAtom | DlParseError {
    skipWhitespace();
    let predicate = "";
    if (pos >= cleaned.length || !/[a-z_]/.test(cleaned[pos]!)) {
      return err(`expected predicate name, got '${cleaned[pos] ?? "EOF"}'`);
    }
    while (pos < cleaned.length && /[a-zA-Z0-9_]/.test(cleaned[pos]!)) {
      predicate += cleaned[pos];
      pos++;
    }
    skipWhitespace();
    if (pos >= cleaned.length || cleaned[pos] !== "(") {
      return err("expected '(' after predicate name");
    }
    pos++; // skip (
    skipWhitespace();

    const terms: DlTerm[] = [];
    if (pos < cleaned.length && cleaned[pos] !== ")") {
      const first = parseTerm();
      if ("message" in first) return first;
      terms.push(first);

      while (true) {
        skipWhitespace();
        if (pos >= cleaned.length) return err("expected ')' to close atom");
        if (cleaned[pos] === ")") break;
        if (cleaned[pos] !== ",") return err("expected ',' or ')' in term list");
        pos++;
        skipWhitespace();
        const term = parseTerm();
        if ("message" in term) return term;
        terms.push(term);
      }
    }

    if (pos >= cleaned.length || cleaned[pos] !== ")") {
      return err("expected ')' to close atom");
    }
    pos++; // skip )
    return { predicate, terms };
  }

  function parseTerm(): DlTerm | DlParseError {
    skipWhitespace();
    if (pos >= cleaned.length) return err("unexpected end of input in term");

    const ch = cleaned[pos]!;

    if (ch === "_") {
      pos++;
      if (pos < cleaned.length && /[a-zA-Z0-9]/.test(cleaned[pos]!)) {
        return err("'_' wildcard must stand alone");
      }
      return { kind: "wildcard" };
    }

    if (ch === '"') {
      pos++; // skip opening "
      let value = "";
      while (pos < cleaned.length && cleaned[pos] !== '"') {
        if (cleaned[pos] === "\\" && pos + 1 < cleaned.length) {
          pos++;
          value += cleaned[pos];
        } else {
          value += cleaned[pos];
        }
        pos++;
      }
      if (pos >= cleaned.length) return err("unterminated string literal");
      pos++; // skip closing "
      return { kind: "string", value };
    }

    if (/[0-9]/.test(ch) || (ch === "-" && pos + 1 < cleaned.length && /[0-9]/.test(cleaned[pos + 1]!))) {
      let numStr = "";
      if (ch === "-") { numStr += "-"; pos++; }
      while (pos < cleaned.length && /[0-9]/.test(cleaned[pos]!)) {
        numStr += cleaned[pos];
        pos++;
      }
      return { kind: "number", value: parseInt(numStr, 10) };
    }

    if (/[A-Z]/.test(ch)) {
      let name = "";
      while (pos < cleaned.length && /[a-zA-Z0-9_]/.test(cleaned[pos]!)) {
        name += cleaned[pos];
        pos++;
      }
      return { kind: "variable", name };
    }

    return err(`unexpected character '${ch}' in term`);
  }
}
