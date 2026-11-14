// Differential dataflow for Datalog-lite.
// Uses predicate-level delta tracking with incremental semi-naive re-derivation.
// When EDB facts change, only rules whose body references a changed predicate
// are re-evaluated — transitive through rule dependencies.

import type { DlProgram, DlRule, DlAtom, DlTerm } from "./types.ts";
import type { FactDb } from "./edb.ts";
import type { EvalResult } from "./evaluator.ts";

export interface EdbDelta {
  added: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
}

type Binding = Map<string, string>;

function key(tuple: string[]): string { return JSON.stringify(tuple); }
function tupleFromKey(k: string): string[] { return JSON.parse(k) as string[]; }

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
      if (!unifyTerm(atom.terms[i]!, tuple[i]!, newBinding)) { matched = false; break; }
    }
    if (matched) results.push(newBinding);
  }
  return results;
}

function evaluateBody(body: DlAtom[], facts: FactDb, initialBinding: Binding): Binding[] {
  let bindings: Binding[] = [initialBinding];
  for (const atom of body) {
    if (atom.predicate === "__unsupported__" || atom.negated) continue;
    const next: Binding[] = [];
    for (const b of bindings) next.push(...matchAtom(atom, facts, b));
    bindings = next;
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

function ruleUsesUnsupported(rule: DlRule): boolean {
  return rule.body.some((a) => a.predicate === "__unsupported__" || a.negated);
}

export class IncrementalEvaluator {
  private edb: FactDb = new Map();
  private idb: FactDb = new Map();
  private merged: FactDb = new Map();
  private _program: DlProgram | null = null;
  private supportedRules: DlRule[] = [];
  private bodyDeps: Map<string, number[]> = new Map();
  private headPreds: string[] = [];
  private _version = 0;
  private _evalCount = 0;
  private _lastFullIterations = 0;

  get version(): number { return this._version; }
  get evalCount(): number { return this._evalCount; }
  get program(): DlProgram | null { return this._program; }

  installProgram(program: DlProgram): void {
    this._program = program;
    this.rebuildIndex();
  }

  /**
   * Merge additional rules into the installed program without replacing it.
   * Use this for accumulating rules from multiple `rules.add` calls.
   */
  addRules(program: DlProgram): void {
    if (!this._program) {
      this.installProgram(program);
      return;
    }
    this._program = {
      rules: [...this._program.rules, ...program.rules],
      queries: [...this._program.queries, ...program.queries],
      metadata: this._program.metadata,
    };
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    if (!this._program) return;
    this.supportedRules = this._program.rules.filter((r) => !ruleUsesUnsupported(r));
    this.headPreds = this.supportedRules.map((r) => r.head.predicate);
    this.bodyDeps = new Map();
    for (let i = 0; i < this.supportedRules.length; i++) {
      const rule = this.supportedRules[i]!;
      for (const atom of rule.body) {
        if (atom.predicate === "__unsupported__") continue;
        let deps = this.bodyDeps.get(atom.predicate);
        if (!deps) { deps = []; this.bodyDeps.set(atom.predicate, deps); }
        if (!deps.includes(i)) deps.push(i);
      }
    }
    this.idb = new Map();
    this.rebuildMerged();
  }

  setEdb(edb: FactDb): void {
    this.edb = new Map();
    for (const [pred, set] of edb) {
      this.edb.set(pred, new Set(set));
    }
    this.rebuildMerged();
    this._version++;
  }

  fullEval(maxIterations = 100): EvalResult {
    if (!this._program || this.supportedRules.length === 0) {
      return { facts: this.snapshotFacts(), violations: [], iterations: 0 };
    }
    this.idb = new Map();
    this.rebuildMerged();

    let iteration = 0;
    let changed = true;
    while (changed && iteration < maxIterations) {
      changed = false;
      iteration++;
      for (const rule of this.supportedRules) {
        const bindings = evaluateBody(rule.body, this.merged, new Map());
        for (const binding of bindings) {
          const tuple = deriveHead(rule.head, binding);
          if (!tuple) continue;
          if (this.addIdbFact(rule.head.predicate, tuple)) changed = true;
        }
      }
    }
    this._lastFullIterations = iteration;
    this._evalCount++;
    return this.buildResult(iteration);
  }

  /**
   * Compute the EDB delta between the current EDB and a new EDB,
   * then apply it and incrementally re-derive affected IDB facts.
   */
  applyEdbUpdate(newEdb: FactDb, maxIterations = 100): { delta: EdbDelta; result: EvalResult } {
    const delta = computeEdbDelta(this.edb, newEdb);
    this.setEdb(newEdb);

    if (!this._program || this.supportedRules.length === 0) {
      return { delta, result: { facts: new Map(this.merged), violations: [], iterations: 0 } };
    }

    const changedPreds = new Set<string>();
    for (const pred of delta.added.keys()) changedPreds.add(pred);
    for (const pred of delta.removed.keys()) changedPreds.add(pred);

    if (changedPreds.size === 0) {
      this._evalCount++;
      return { delta, result: this.buildResult(0) };
    }

    const affectedRuleIndices = this.findAffectedRules(changedPreds);
    if (affectedRuleIndices.size === 0) {
      this._evalCount++;
      return { delta, result: this.buildResult(0) };
    }

    const affectedHeadPreds = new Set<string>();
    for (const idx of affectedRuleIndices) {
      affectedHeadPreds.add(this.headPreds[idx]!);
    }

    for (const pred of affectedHeadPreds) {
      this.idb.delete(pred);
    }
    this.rebuildMerged();

    const affectedRules = [...affectedRuleIndices].map((i) => this.supportedRules[i]!);
    let iteration = 0;
    let changed = true;
    while (changed && iteration < maxIterations) {
      changed = false;
      iteration++;
      for (const rule of affectedRules) {
        const bindings = evaluateBody(rule.body, this.merged, new Map());
        for (const binding of bindings) {
          const tuple = deriveHead(rule.head, binding);
          if (!tuple) continue;
          if (this.addIdbFact(rule.head.predicate, tuple)) changed = true;
        }
      }
    }

    this._evalCount++;
    return { delta, result: this.buildResult(iteration) };
  }

  /**
   * Transitive closure: find all rule indices affected by a set of changed predicates.
   * A rule is affected if its body references a changed predicate, or if its body
   * references a predicate that is the head of an affected rule.
   */
  private findAffectedRules(changedPreds: ReadonlySet<string>): Set<number> {
    const affected = new Set<number>();
    const visited = new Set(changedPreds);
    const worklist = [...changedPreds];

    while (worklist.length > 0) {
      const pred = worklist.pop()!;
      const deps = this.bodyDeps.get(pred);
      if (!deps) continue;
      for (const idx of deps) {
        if (affected.has(idx)) continue;
        affected.add(idx);
        const headPred = this.headPreds[idx]!;
        if (!visited.has(headPred)) {
          visited.add(headPred);
          worklist.push(headPred);
        }
      }
    }
    return affected;
  }

  private addIdbFact(predicate: string, tuple: string[]): boolean {
    let idbSet = this.idb.get(predicate);
    if (!idbSet) { idbSet = new Set(); this.idb.set(predicate, idbSet); }
    const k = key(tuple);
    if (idbSet.has(k)) return false;
    idbSet.add(k);

    let mergedSet = this.merged.get(predicate);
    if (!mergedSet) { mergedSet = new Set(); this.merged.set(predicate, mergedSet); }
    mergedSet.add(k);
    return true;
  }

  private rebuildMerged(): void {
    this.merged = new Map();
    for (const [pred, set] of this.edb) {
      this.merged.set(pred, new Set(set));
    }
    for (const [pred, set] of this.idb) {
      let mergedSet = this.merged.get(pred);
      if (!mergedSet) { mergedSet = new Set(); this.merged.set(pred, mergedSet); }
      for (const k of set) mergedSet.add(k);
    }
  }

  private buildResult(iterations: number): EvalResult {
    const violations: EvalResult["violations"] = [];
    const violationFacts = this.merged.get("violation");
    if (violationFacts) {
      for (const factKey of violationFacts) {
        const tuple = tupleFromKey(factKey);
        if (tuple.length >= 2) {
          violations.push({ ruleId: tuple[0]!, nodeId: tuple[1]!, message: tuple[2] });
        }
      }
    }
    return { facts: this.snapshotFacts(), violations, iterations };
  }

  query(program: DlProgram): string[][] {
    const answers: string[][] = [];
    for (const q of program.queries) {
      const predFacts = this.merged.get(q.atom.predicate);
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

  snapshotFacts(): FactDb {
    return new Map(
      [...this.merged.entries()].map(([pred, set]) => [pred, new Set(set)]),
    );
  }

  get stats(): { edbPredicates: number; idbPredicates: number; edbFacts: number; idbFacts: number; rulesInstalled: number } {
    let edbFacts = 0;
    for (const set of this.edb.values()) edbFacts += set.size;
    let idbFacts = 0;
    for (const set of this.idb.values()) idbFacts += set.size;
    return {
      edbPredicates: this.edb.size,
      idbPredicates: this.idb.size,
      edbFacts,
      idbFacts,
      rulesInstalled: this.supportedRules.length,
    };
  }
}

/**
 * Compute the delta between two EDB snapshots.
 * Returns facts that were added and facts that were removed.
 */
export function computeEdbDelta(oldEdb: FactDb, newEdb: FactDb): EdbDelta {
  const added: Map<string, Set<string>> = new Map();
  const removed: Map<string, Set<string>> = new Map();

  const allPreds = new Set([...oldEdb.keys(), ...newEdb.keys()]);
  for (const pred of allPreds) {
    const oldSet = oldEdb.get(pred);
    const newSet = newEdb.get(pred);

    if (!oldSet && newSet) {
      added.set(pred, new Set(newSet));
      continue;
    }
    if (oldSet && !newSet) {
      removed.set(pred, new Set(oldSet));
      continue;
    }
    if (!oldSet || !newSet) continue;

    const addedFacts = new Set<string>();
    const removedFacts = new Set<string>();

    for (const k of newSet) {
      if (!oldSet.has(k)) addedFacts.add(k);
    }
    for (const k of oldSet) {
      if (!newSet.has(k)) removedFacts.add(k);
    }

    if (addedFacts.size > 0) added.set(pred, addedFacts);
    if (removedFacts.size > 0) removed.set(pred, removedFacts);
  }

  return { added, removed };
}

export function deltaSize(delta: EdbDelta): number {
  let size = 0;
  for (const set of delta.added.values()) size += set.size;
  for (const set of delta.removed.values()) size += set.size;
  return size;
}

export function isDeltaEmpty(delta: EdbDelta): boolean {
  return delta.added.size === 0 && delta.removed.size === 0;
}
