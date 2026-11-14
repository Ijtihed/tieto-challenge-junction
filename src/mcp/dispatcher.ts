// Per architecture/schema-v3.md §3.10 + §14.1 + §14.4
// Phase 1: empty boot. Phase 4: action registration + tools/call routing.

import { logger, type EventLogger } from "../obs/index.ts";
import type { Session } from "../session/session.ts";

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpCapabilities {
  tools: Record<string, never>;
  resources: Record<string, never>;
  logging: Record<string, never>;
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: McpServerInfo;
  capabilities: McpCapabilities;
}

export interface ActionHandler {
  readonly name: string;
  readonly description: string;
  readonly sideEffect: "none" | "preflightable" | "final";
  readonly inputSchema?: Record<string, unknown>;
  handle(args: Record<string, unknown>): Promise<
    { ok: true; data: unknown } | { ok: false; code: string; message: string }
  >;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: { type: string; text: string }[];
  isError: boolean;
}

export interface ResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export type ResourceReader = (uri: string) => { contents: { uri: string; text: string; mimeType: string }[] } | null;

export class McpDispatcher {
  readonly serverInfo: McpServerInfo;
  private closed = false;
  private readonly actions = new Map<string, ActionHandler>();
  private readonly resources: ResourceInfo[] = [];
  private resourceReader: ResourceReader = () => null;
  readonly eventLog?: EventLogger | undefined;

  private getSessionFn: ((id: string) => Session | null) | undefined;

  constructor(serverInfo: McpServerInfo, getSessionFn?: (id: string) => Session | null, eventLog?: EventLogger) {
    this.serverInfo = serverInfo;
    this.getSessionFn = getSessionFn;
    this.eventLog = eventLog;
  }

  registerAction(handler: ActionHandler): void {
    this.actions.set(handler.name, handler);
  }

  initialize(): InitializeResult {
    logger.info("mcp.dispatcher", "initialize", {
      server: this.serverInfo.name,
      version: this.serverInfo.version,
    });

    return {
      protocolVersion: "2025-11-25",
      serverInfo: this.serverInfo,
      capabilities: {
        tools: {},
        resources: {},
        logging: {},
      },
    };
  }

  listTools(): { tools: ToolInfo[] } {
    return {
      tools: [...this.actions.values()].map((a) => ({
        name: a.name,
        description: a.description,
        inputSchema: a.inputSchema ?? { type: "object" },
      })),
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const action = this.actions.get(name);
    if (!action) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, code: "unknown-tool", message: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    const sessionId = args["sessionId"] as string | undefined;
    let release: (() => void) | undefined;
    if (sessionId && this.getSessionFn) {
      const session = this.getSessionFn(sessionId);
      if (session && !session.closed) {
        release = await session.mutex.acquire();
      }
    }

    try {
      const result = await action.handle(args);
      if (this.eventLog && result.ok) {
        this._emitActionEvent(name, args, result.data);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, code: "internal", message }) }],
        isError: true,
      };
    } finally {
      release?.();
    }
  }

  registerResource(info: ResourceInfo): void {
    this.resources.push(info);
  }

  setResourceReader(reader: ResourceReader): void {
    this.resourceReader = reader;
  }

  listResources(): { resources: ResourceInfo[] } {
    return { resources: this.resources };
  }

  readResource(uri: string): { contents: { uri: string; text: string; mimeType: string }[] } | null {
    return this.resourceReader(uri);
  }

  private _emitActionEvent(name: string, args: Record<string, unknown>, data: unknown): void {
    if (!this.eventLog) return;
    const sid = (args["sessionId"] as string) ?? "none";
    const d = data as Record<string, unknown>;
    try {
      switch (name) {
        case "workspace.open": {
          const ws = d["workspace"] as Record<string, unknown> | undefined;
          this.eventLog.log({ sid, kind: "workspace.opened", lc: ((ws?.["languages"] as unknown[]) ?? []).length, nc: 0, ec: 0 } as any);
          break;
        }
        case "rules.evaluate": {
          const violations = (d["violations"] as unknown[]) ?? [];
          const rules = (d["rules"] as unknown[]) ?? [];
          this.eventLog.log({ sid, kind: "rules.evaluated", vc: violations.length, rc: rules.length, scope: "all" } as any);
          break;
        }
        case "pr.review":
          this.eventLog.log({ sid, kind: "pr.reviewed", vc: 0, nc: 0 } as any);
          break;
        case "plan.propose":
          this.eventLog.log({ sid, kind: "plan.proposed", planId: (d["planId"] as string) ?? "", opCount: ((d["steps"] as unknown[]) ?? []).length, gh: "" } as any);
          break;
        case "plan.apply":
          this.eventLog.log({ sid, kind: "plan.applied", planId: (d["planId"] as string) ?? "", tp: true, fc: 0 } as any);
          break;
        case "plan.cancel":
          this.eventLog.log({ sid, kind: "plan.cancelled", planId: (args["planId"] as string) ?? "" } as any);
          break;
        case "plan.restore":
          this.eventLog.log({ sid, kind: "plan.restored", planId: (args["planId"] as string) ?? "", reason: "user" } as any);
          break;
      }
    } catch {
      // Event logging is fire-and-forget — never interrupt the action result.
    }
  }

  get toolCount(): number {
    return this.actions.size;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    logger.info("mcp.dispatcher", "closed");
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
