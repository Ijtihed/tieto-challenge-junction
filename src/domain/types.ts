// Per architecture/schema-v3.md §3.3 — domain types used by session + actions

export interface Insight {
  readonly id: string;
  readonly kind: string;
  readonly message: string;
  readonly severity: "info" | "warn" | "error";
  readonly nodeIds?: readonly string[];
}

export interface Violation {
  readonly ruleId: string;
  readonly severity: "info" | "warn" | "error";
  readonly message: string;
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
}

export interface Rule {
  readonly id: string;
  readonly kind: "structural" | "prose";
  readonly body: string;
  readonly severity: "info" | "warn" | "error";
  readonly evaluation?: "deterministic" | "llm";
  readonly globs?: readonly string[];
}

export interface ImportedRule extends Rule {
  readonly source: string;
}

export interface PlanStep {
  readonly op: string;
  readonly symbolId: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export interface Plan {
  readonly id: string;
  readonly rationale: string;
  readonly steps: readonly PlanStep[];
  readonly createdAt: number;
}

export interface StepRun {
  readonly step: number;
  readonly phase: "pending" | "applying" | "testing" | "verifying" | "passed" | "failed";
  readonly filesChanged?: readonly string[];
  readonly error?: string;
}

export interface PlanRun {
  readonly id: string;
  readonly planId: string;
  readonly state: "running" | "completed" | "failed" | "cancelled" | "restored";
  readonly steps: readonly StepRun[];
  readonly startedAt: number;
  readonly completedAt?: number;
}
