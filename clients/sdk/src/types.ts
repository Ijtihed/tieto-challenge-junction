export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly locator: string;
  readonly filePath?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly meta?: Record<string, unknown>;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly meta?: Record<string, unknown>;
}

export interface ClusterInfo {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kindMix: Record<string, number>;
  readonly externalEdges: number;
}

export interface SummaryData {
  readonly clusters: ClusterInfo[];
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly markdownUri?: string;
}

export interface Violation {
  readonly ruleId: string;
  readonly severity: string;
  readonly message: string;
  readonly nodeIds?: string[];
}

export interface NodeDetail {
  readonly node: GraphNode;
  readonly source?: string;
  readonly snippet?: string;
}

export interface PlanStep {
  readonly op: string;
  readonly symbolId: string;
  readonly args?: Record<string, unknown>;
}

export interface PlanStatus {
  readonly planId: string;
  readonly state: string;
  readonly steps: unknown[];
}

export interface CanonResult {
  readonly docId: string;
  readonly title: string;
  readonly paradigm: string;
  readonly score: number;
  readonly snippet: string;
}

export interface SkillInfo {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly uri: string;
}

export interface SessionEvent {
  readonly kind: string;
  readonly at: number;
  readonly [key: string]: unknown;
}

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
