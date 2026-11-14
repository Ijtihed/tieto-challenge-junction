// Per architecture/phase-13.md §3 — VS Code / Cursor / Cline extension (T2).
import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;
let currentSessionId: string | undefined;

function getBaseUrl(): string {
  const port = vscode.workspace.getConfiguration("schema").get<number>("serverPort", 7474);
  return `http://127.0.0.1:${port}`;
}

async function mcpCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${getBaseUrl()}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await mcpCall("tools/call", { name, arguments: args })) as {
    content: { text: string }[];
  };
  const parsed = JSON.parse(result.content[0]!.text);
  if (!parsed.ok) throw new Error(parsed.message ?? "Action failed");
  return parsed.data as T;
}

async function ensureSession(): Promise<string> {
  if (currentSessionId) return currentSessionId;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error("No workspace folder open");

  const uri = `file://${folders[0]!.uri.fsPath}`;
  const data = await callTool<{ sessionId: string }>("workspace.open", { uris: [uri] });
  currentSessionId = data.sessionId;
  outputChannel.appendLine(`Session opened: ${currentSessionId}`);
  return currentSessionId;
}

interface ViolationData {
  ruleId: string;
  severity: string;
  message: string;
  nodeIds?: string[];
}

interface GraphNode {
  id: string;
  kind: string;
  name: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

async function evaluateAndShowViolations(): Promise<void> {
  try {
    const sessionId = await ensureSession();
    const result = await callTool<{ violations: ViolationData[] }>("rules.evaluate", { sessionId });

    diagnosticCollection.clear();
    const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

    let violationCount = 0;
    for (const v of result.violations) {
      violationCount++;
      if (!v.nodeIds?.length) continue;

      for (const nodeId of v.nodeIds) {
        try {
          const nodeData = await callTool<{ node: GraphNode }>("graph.get_node", {
            sessionId,
            id: nodeId,
            include: [],
          });
          const node = nodeData.node;
          if (!node.filePath) continue;

          const range = new vscode.Range(
            (node.startLine ?? 1) - 1, 0,
            (node.endLine ?? node.startLine ?? 1) - 1, 100,
          );

          const severity = v.severity === "error"
            ? vscode.DiagnosticSeverity.Error
            : v.severity === "warn"
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information;

          const diag = new vscode.Diagnostic(range, `[${v.ruleId}] ${v.message}`, severity);
          diag.source = "Schema";

          const fileDiags = diagnosticMap.get(node.filePath) ?? [];
          fileDiags.push(diag);
          diagnosticMap.set(node.filePath, fileDiags);
        } catch { /* skip nodes that can't be resolved */ }
      }
    }

    for (const [filePath, diags] of diagnosticMap) {
      diagnosticCollection.set(vscode.Uri.file(filePath), diags);
    }

    statusBar.text = `$(symbol-structure) Schema: ${violationCount} violations`;
    statusBar.show();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Rule evaluation error: ${msg}`);
  }
}

class SummaryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private items: vscode.TreeItem[] = [];

  async refresh(): Promise<void> {
    try {
      const sessionId = await ensureSession();
      const summary = await callTool<{
        totalNodes: number;
        totalEdges: number;
        clusters: { id: string; name: string; size: number }[];
      }>("graph.summary", { sessionId });

      this.items = [
        Object.assign(new vscode.TreeItem(`Nodes: ${summary.totalNodes}`), {
          iconPath: new vscode.ThemeIcon("symbol-function"),
        }),
        Object.assign(new vscode.TreeItem(`Edges: ${summary.totalEdges}`), {
          iconPath: new vscode.ThemeIcon("arrow-right"),
        }),
        Object.assign(new vscode.TreeItem(`Clusters: ${summary.clusters.length}`), {
          iconPath: new vscode.ThemeIcon("symbol-namespace"),
        }),
        ...summary.clusters.map((c) =>
          Object.assign(new vscode.TreeItem(`  ${c.name} (${c.size} nodes)`), {
            iconPath: new vscode.ThemeIcon("folder"),
          }),
        ),
      ];
    } catch {
      this.items = [new vscode.TreeItem("Open a workspace to see the graph")];
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] { return this.items; }
}

class RulesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private items: vscode.TreeItem[] = [];

  async refresh(): Promise<void> {
    try {
      const sessionId = await ensureSession();
      const result = await callTool<{ violations: ViolationData[] }>("rules.evaluate", { sessionId });

      if (result.violations.length === 0) {
        this.items = [
          Object.assign(new vscode.TreeItem("All rules pass"), {
            iconPath: new vscode.ThemeIcon("pass"),
          }),
        ];
      } else {
        this.items = result.violations.map((v) => {
          const icon = v.severity === "error" ? "error" : v.severity === "warn" ? "warning" : "info";
          return Object.assign(new vscode.TreeItem(`[${v.ruleId}] ${v.message}`), {
            iconPath: new vscode.ThemeIcon(icon),
            tooltip: v.message,
          });
        });
      }
    } catch {
      this.items = [new vscode.TreeItem("Evaluate rules to see violations")];
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] { return this.items; }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Schema");
  diagnosticCollection = vscode.languages.createDiagnosticCollection("schema");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "schema.evaluateRules";
  statusBar.text = "$(symbol-structure) Schema";
  statusBar.tooltip = "Schema — click to evaluate rules";
  statusBar.show();

  const summaryProvider = new SummaryTreeProvider();
  const rulesProvider = new RulesTreeProvider();

  vscode.window.registerTreeDataProvider("schema.summary", summaryProvider);
  vscode.window.registerTreeDataProvider("schema.rules", rulesProvider);

  context.subscriptions.push(
    outputChannel,
    diagnosticCollection,
    statusBar,

    vscode.commands.registerCommand("schema.openGraph", async () => {
      try {
        await ensureSession();
        await summaryProvider.refresh();
        await rulesProvider.refresh();
        vscode.window.showInformationMessage("Schema graph loaded. Check the Schema panel in the sidebar.");
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("schema.evaluateRules", async () => {
      await evaluateAndShowViolations();
      await rulesProvider.refresh();
      vscode.window.showInformationMessage("Schema: Rules evaluated. Check the Problems panel.");
    }),

    vscode.commands.registerCommand("schema.generatePrSummary", async () => {
      try {
        const sessionId = await ensureSession();
        const result = await callTool<{ markdown: string; violations: unknown[] }>(
          "pr.review", { sessionId },
        );
        await vscode.env.clipboard.writeText(result.markdown);
        vscode.window.showInformationMessage("Schema: PR summary copied to clipboard.");
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("schema.showGraphForFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage("No active editor."); return; }

      try {
        const sessionId = await ensureSession();
        const filePath = editor.document.uri.fsPath;
        const result = await callTool<{ hits: { id: string; name: string; kind: string }[] }>(
          "graph.search", { sessionId, query: filePath.split("/").pop() },
        );
        const fileNodes = result.hits.filter((h) => h.name);
        if (fileNodes.length === 0) {
          vscode.window.showInformationMessage("No graph nodes found for this file.");
        } else {
          const items = fileNodes.map((n) => `${n.name} (${n.kind})`);
          outputChannel.show();
          outputChannel.appendLine(`Nodes in ${filePath.split("/").pop()}:`);
          items.forEach((item) => outputChannel.appendLine(`  ${item}`));
          vscode.window.showInformationMessage(`Schema: ${fileNodes.length} nodes found. See output channel.`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("schema.findCallers", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage("No active editor."); return; }

      const selection = editor.document.getText(editor.selection);
      if (!selection) { vscode.window.showWarningMessage("Select a symbol name first."); return; }

      try {
        const sessionId = await ensureSession();
        const searchResult = await callTool<{ hits: { id: string; name: string }[] }>(
          "graph.search", { sessionId, query: selection },
        );
        if (!searchResult.hits.length) {
          vscode.window.showInformationMessage(`No graph node matching "${selection}".`);
          return;
        }

        const nodeId = searchResult.hits[0]!.id;
        const callers = await callTool<{ callers: { id: string; name: string; kind: string }[] }>(
          "graph.find_callers", { sessionId, symbolId: nodeId },
        );

        outputChannel.show();
        outputChannel.appendLine(`Callers of "${selection}":`);
        if (callers.callers.length === 0) {
          outputChannel.appendLine("  (none)");
        } else {
          callers.callers.forEach((c) => outputChannel.appendLine(`  ${c.name} (${c.kind})`));
        }
        vscode.window.showInformationMessage(`Schema: ${callers.callers.length} callers found.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("schema.findCallees", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage("No active editor."); return; }

      const selection = editor.document.getText(editor.selection);
      if (!selection) { vscode.window.showWarningMessage("Select a symbol name first."); return; }

      try {
        const sessionId = await ensureSession();
        const searchResult = await callTool<{ hits: { id: string; name: string }[] }>(
          "graph.search", { sessionId, query: selection },
        );
        if (!searchResult.hits.length) {
          vscode.window.showInformationMessage(`No graph node matching "${selection}".`);
          return;
        }

        const nodeId = searchResult.hits[0]!.id;
        const callees = await callTool<{ callees: { id: string; name: string; kind: string }[] }>(
          "graph.find_callees", { sessionId, symbolId: nodeId },
        );

        outputChannel.show();
        outputChannel.appendLine(`Callees of "${selection}":`);
        if (callees.callees.length === 0) {
          outputChannel.appendLine("  (none)");
        } else {
          callees.callees.forEach((c) => outputChannel.appendLine(`  ${c.name} (${c.kind})`));
        }
        vscode.window.showInformationMessage(`Schema: ${callees.callees.length} callees found.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("schema.diffAgainst", async () => {
      const ref = await vscode.window.showInputBox({
        prompt: "Git ref to diff against",
        value: "HEAD~1",
      });
      if (!ref) return;

      try {
        const sessionId = await ensureSession();
        const result = await callTool<{
          graphDelta: {
            nodes: { id: string; name: string; kind: string; status: string; filePath?: string }[];
            baseRef: string;
            headRef: string;
          };
        }>("graph.diff_against", { sessionId, ref });

        const changed = result.graphDelta.nodes.filter((n) => n.status !== "unchanged");
        if (changed.length === 0) {
          vscode.window.showInformationMessage("Schema: No structural changes detected.");
          return;
        }

        diagnosticCollection.clear();
        const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

        for (const node of changed) {
          if (!node.filePath) continue;
          try {
            const nodeData = await callTool<{ node: GraphNode }>("graph.get_node", {
              sessionId, id: node.id, include: [],
            });
            const n = nodeData.node;
            if (!n.filePath) continue;

            const range = new vscode.Range(
              (n.startLine ?? 1) - 1, 0,
              (n.endLine ?? n.startLine ?? 1) - 1, 100,
            );

            const severity = node.status === "removed"
              ? vscode.DiagnosticSeverity.Error
              : node.status === "added"
                ? vscode.DiagnosticSeverity.Hint
                : vscode.DiagnosticSeverity.Warning;

            const label = node.status === "added" ? "+" : node.status === "removed" ? "−" : "~";
            const diag = new vscode.Diagnostic(range, `[${label} ${node.kind}] ${node.name}`, severity);
            diag.source = "Schema Diff";

            const fileDiags = diagnosticMap.get(n.filePath) ?? [];
            fileDiags.push(diag);
            diagnosticMap.set(n.filePath, fileDiags);
          } catch { /* skip unresolvable nodes */ }
        }

        for (const [filePath, diags] of diagnosticMap) {
          diagnosticCollection.set(vscode.Uri.file(filePath), diags);
        }

        const added = changed.filter((n) => n.status === "added").length;
        const removed = changed.filter((n) => n.status === "removed").length;
        const modified = changed.filter((n) => n.status === "modified").length;
        vscode.window.showInformationMessage(
          `Schema Diff vs ${ref}: +${added} added, −${removed} removed, ~${modified} modified`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("schema.openInDesktop", () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showWarningMessage("No workspace folder open.");
        return;
      }
      const uri = `file://${folders[0]!.uri.fsPath}`;
      vscode.env.openExternal(vscode.Uri.parse(`schema://open?uri=${encodeURIComponent(uri)}`));
    }),

    vscode.commands.registerCommand("schema.addRule", async () => {
      const kind = await vscode.window.showQuickPick(["structural", "prose"], {
        placeHolder: "Rule kind",
      });
      if (!kind) return;

      const ruleId = await vscode.window.showInputBox({
        prompt: "Rule ID (e.g. no-cycle, must-auth)",
      });
      if (!ruleId) return;

      const body = await vscode.window.showInputBox({
        prompt: kind === "structural"
          ? 'Rule body (JSON, e.g. { "type": "no-cycle" })'
          : "Rule body (plain English)",
      });
      if (!body) return;

      try {
        const sessionId = await ensureSession();
        await callTool("rules.add", {
          sessionId,
          rule: { id: ruleId, kind, severity: "warn", body, persist: false },
        });
        vscode.window.showInformationMessage(`Schema: Rule "${ruleId}" added.`);
        await evaluateAndShowViolations();
        await rulesProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Schema: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  if (vscode.workspace.getConfiguration("schema").get<boolean>("autoEvaluateRules", true)) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async () => {
        if (currentSessionId) {
          await evaluateAndShowViolations();
          await rulesProvider.refresh();
        }
      }),
    );
  }

  outputChannel.appendLine("Schema extension activated.");
}

export function deactivate() {
  if (currentSessionId) {
    callTool("workspace.close", { sessionId: currentSessionId }).catch(() => {});
    currentSessionId = undefined;
  }
  outputChannel?.dispose();
  diagnosticCollection?.dispose();
  statusBar?.dispose();
}
