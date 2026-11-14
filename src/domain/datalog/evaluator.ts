// Per architecture/specs/datalog-lite.md §2 — semi-naive fixpoint evaluator.

import type { DlProgram, DlRule, DlAtom, DlTerm } from "./types.ts";
import type { FactDb } from "./edb.ts";

type Binding = Map<string, string>;

function termValue(term: DlTerm, binding: Binding): string | null {
  switch (term.kind) {
    case "string": return term.value;
    case "number": return String(term.value);
    case "variable": return binding.get(term.name) ?? null;
    case "wildcard": return null;
  }
}

function unifyTerm(term: DlTerm, value: string, binding: Binding): boolean {
  switch (term.kind) {
    case "string": return term.value === value;
    case "number": return String(term.value) === value;
    case "wildcard": return true;
    case "variable": {
      const existing = binding.get(term.name);
      if (existing !== undefined) return existing === value;
      binding.set(term.name, value);
      return true;
    }
  }
}

function tupleFromKey(key: string): string[] {
  return JSON.parse(key) as string[];
}

function matchAtom(atom: DlAtom, facts: FactDb, binding: Binding): Binding[] {
  const predFacts = facts.get(atom.predicate);
  if (!predFacts) return [];

  const results: Binding[] = [];
  for (const factKey of predFacts) {
    const tuple = tupleFromKey(factKey);
    if (tuple.length !== atom.terms.length) continue;

    const newBinding = new Map(binding);
    let matched = true;
    for (let i = 0; i < atom.terms.length; i++) {
      if (!unifyTerm(atom.terms[i]!, tuple[i]!, newBinding)) {
        matched = false;
        break;
      }
    }
    if (matched) results.push(newBinding);
  }
  return results;
}

function evaluateBody(body: DlAtom[], facts: FactDb, initialBinding: Binding): Binding[] {
  let bindings: Binding[] = [initialBinding];

  for (const atom of body) {
    const nextBindings: Binding[] = [];
    for (const binding of bindings) {
      nextBindings.push(...matchAtom(atom, facts, binding));
    }
    bindings = nextBindings;
    if (bindings.length === 0) return [];
  }

  return bindings;
}

function deriveHead(head: DlAtom, binding: Binding): string[] | null {
  const tuple: string[] = [];
  for (const term of head.terms) {
    const val = termValue(term, binding);
    if (val === null) return null;
    tuple.push(val);
  }
  return tuple;
}

function key(tuple: string[]): string {
  return JSON.stringify(tuple);
}

export interface EvalResult {
  facts: FactDb;
  violations: { ruleId: string; nodeId: string; message?: string | undefined }[];
  iterations: number;
}

function ruleUsesUnsupported(rule: DlRule): boolean {
  return rule.body.some((a) => a.predicate === "__unsupported__" || a.negated);
}

export function evaluate(program: DlProgram, edb: FactDb, maxIterations = 100): EvalResult {
  const facts: FactDb = new Map();
  for (const [pred, set] of edb) {
    facts.set(pred, new Set(set));
  }

  const supportedRules = program.rules.filter((r) => !ruleUsesUnsupported(r));

  let iteration = 0;
  let changed = true;

  while (changed && iteration < maxIterations) {
    changed = false;
    iteration++;

    for (const rule of supportedRules) {
      const bindings = evaluateBody(rule.body, facts, new Map());

      for (const binding of bindings) {
        const tuple = deriveHead(rule.head, binding);
        if (!tuple) continue;

        const pred = rule.head.predicate;
        let predSet = facts.get(pred);
        if (!predSet) {
          predSet = new Set();
          facts.set(pred, predSet);
        }
        const k = key(tuple);
        if (!predSet.has(k)) {
          predSet.add(k);
          changed = true;
        }
      }
    }
  }

  const violations: EvalResult["violations"] = [];
  const violationFacts = facts.get("violation");
  if (violationFacts) {
    for (const factKey of violationFacts) {
      const tuple = tupleFromKey(factKey);
      if (tuple.length >= 2) {
        violations.push({
          ruleId: tuple[0]!,
          nodeId: tuple[1]!,
          message: tuple[2],
        });
      }
    }
  }

  return { facts, violations, iterations: iteration };
}

export function query(program: DlProgram, edb: FactDb): string[][] {
  const result = evaluate(program, edb);

  const answers: string[][] = [];
  for (const q of program.queries) {
    const predFacts = result.facts.get(q.atom.predicate);
    if (!predFacts) continue;

    for (const factKey of predFacts) {
      const tuple = tupleFromKey(factKey);
      if (tuple.length !== q.atom.terms.length) continue;

      let matched = true;
      for (let i = 0; i < q.atom.terms.length; i++) {
        const term = q.atom.terms[i]!;
        if (term.kind === "string" && term.value !== tuple[i]) { matched = false; break; }
      }
      if (matched) answers.push(tuple);
    }
  }

  return answers;
}
