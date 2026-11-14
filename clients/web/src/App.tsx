import { useState, useCallback, useRef, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import { callTool, subscribeEvents } from "./mcp-client";

// ── Error Boundary ──

interface ErrorBoundaryProps { children: ReactNode; }
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Schema UI caught an error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: "center", color: "#f87171" }}>
          <h1 style={{ fontSize: 24, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#a1a1aa", marginBottom: 16 }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: "8px 20px", borderRadius: 6, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer", fontSize: 14 }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Wire types (type-fresh per §3.11) ──

interface ClusterInfo { id: string; name: string; size: number; kindMix: Record<string, number>; externalEdges: number; }
interface SummaryData { clusters: ClusterInfo[]; totalNodes: number; totalEdges: number; markdownUri: string; }
interface GraphNode { id: string; kind: string; name: string; locator: string; filePath?: string; startLine?: number; endLine?: number; }
interface VisEdge { source: string; target: string; edgeId: string; relation?: string; }
interface SessionEvent { kind: string; at: number; [key: string]: unknown; }
interface ViolationData { ruleId: string; severity: string; message: string; nodeIds?: string[]; }
interface NodeDetail { node: GraphNode; source?: string; snippet?: string; }

// ── Colors ──

const KIND_COLORS: Record<string, string> = {
  utility: "#3b82f6", service: "#8b5cf6", route_handler: "#22c55e",
  middleware: "#eab308", data_access: "#f97316", model: "#ec4899",
  external: "#6b7280", contract: "#14b8a6", deployment: "#f43f5e",
};
function kindColor(kind: string): string { return KIND_COLORS[kind] ?? "#6b7280"; }

// ── App ──

type Panel = "summary" | "rules" | "plan" | "diff";
const CANVAS_W = 1200, CANVAS_H = 800;

function AppInner() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uri, setUri] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<VisEdge[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [violations, setViolations] = useState<ViolationData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<Set<string>>(new Set());
  const [changedNodeIds, setChangedNodeIds] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<Panel>("summary");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleOpen = useCallback(async () => {
    const trimmed = uri.trim();
    if (!trimmed) return;
    setLoading(true); setError(null); setSummary(null); setNodes([]); setEdges([]); setEvents([]);
    setSelectedNode(null); setViolations([]); setSearchHits(new Set()); setChangedNodeIds(new Set());

    try {
      const data = await callTool<{ sessionId: string }>("workspace.open", { uris: [trimmed] });
      setSessionId(data.sessionId);

      if (cleanupRef.current) cleanupRef.current();
      cleanupRef.current = subscribeEvents(data.sessionId, (event) => {
        setEvents((prev) => [...prev, event as SessionEvent]);
      });

      const [summaryData, nodeData] = await Promise.all([
        callTool<SummaryData>("graph.summary", { sessionId: data.sessionId }),
        callTool<{ nodes: GraphNode[] }>("graph.list_nodes", { sessionId: data.sessionId, filter: {} }),
      ]);
      setSummary(summaryData);
      setNodes(nodeData.nodes);

      const collectedEdges: VisEdge[] = [];
      const seen = new Set<string>();
      for (const node of nodeData.nodes) {
        const d = await callTool<{ callees: { id: string; viaEdge: string }[] }>(
          "graph.find_callees", { sessionId: data.sessionId, symbolId: node.id },
        );
        for (const c of d.callees) {
          if (!seen.has(c.viaEdge)) { seen.add(c.viaEdge); collectedEdges.push({ source: node.id, target: c.id, edgeId: c.viaEdge }); }
        }
      }
      setEdges(collectedEdges);

      const rulesData = await callTool<{ violations: ViolationData[] }>("rules.evaluate", { sessionId: data.sessionId });
      setViolations(rulesData.violations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }, [uri]);

  const handleSearch = useCallback(async () => {
    if (!sessionId || !searchQuery.trim()) { setSearchHits(new Set()); return; }
    try {
      const r = await callTool<{ hits: { id: string }[] }>("graph.search", { sessionId, query: searchQuery });
      setSearchHits(new Set(r.hits.map((h) => h.id)));
    } catch { setSearchHits(new Set()); }
  }, [sessionId, searchQuery]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    if (!sessionId) return;
    try {
      const r = await callTool<NodeDetail>("graph.get_node", { sessionId, id: nodeId, include: ["snippet", "source"] });
      setSelectedNode(r);
    } catch { /* ignore */ }
  }, [sessionId]);

  const handleDiff = useCallback(async (ref: string) => {
    if (!sessionId) return;
    try {
      const r = await callTool<{ graphDelta: { nodes: { id: string; status: string }[] } }>(
        "graph.diff_against", { sessionId, ref },
      );
      setChangedNodeIds(new Set(r.graphDelta.nodes.filter((n) => n.status !== "unchanged").map((n) => n.id)));
    } catch { /* ignore */ }
  }, [sessionId]);

  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [layoutLoading, setLayoutLoading] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (nodes.length === 0) { setPositions(new Map()); return; }

    setLayoutLoading(true);

    if (workerRef.current) workerRef.current.terminate();
    const worker = new Worker(new URL("./layout-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const result = e.data as { id: string; x: number; y: number }[];
      setPositions(new Map(result.map(p => [p.id, { x: p.x, y: p.y }])));
      setLayoutLoading(false);
    };

    worker.postMessage({
      nodes: nodes.map(n => ({ id: n.id })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
      width: CANVAS_W,
      height: CANVAS_H,
    });

    return () => { worker.terminate(); };
  }, [nodes, edges]);

  const violationNodeIds = new Set(violations.flatMap((v) => v.nodeIds ?? []));

  return (
    <div className="app">
      <header className="header">
        <h1>Schema</h1>
        <span className="subtitle">Architecture Graph</span>
        {sessionId && <span className="session-badge">{sessionId}</span>}
        {sessionId && (
          <div className="search-bar">
            <input className="search-input" type="text" placeholder="Search nodes..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
            <button className="search-btn" onClick={handleSearch}>Search</button>
          </div>
        )}
      </header>

      <aside className="sidebar">
        <div className="sidebar-section">
          <h2>Workspace</h2>
          <div className="opener-form">
            <input className="opener-input" type="text" placeholder="file:///path/to/repo" value={uri}
              onChange={(e) => setUri(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleOpen(); }}
              disabled={loading} />
            <button className="opener-btn" onClick={handleOpen} disabled={loading || !uri.trim()}>
              {loading ? "Opening\u2026" : "Open"}
            </button>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>

        {sessionId && (
          <div className="sidebar-section">
            <div className="panel-tabs">
              {(["summary", "rules", "plan", "diff"] as Panel[]).map((p) => (
                <button key={p} className={`tab-btn ${activePanel === p ? "active" : ""}`} onClick={() => setActivePanel(p)}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {activePanel === "summary" && summary && <SummaryPanel summary={summary} />}
        {activePanel === "rules" && <RulesPanel violations={violations} onHighlight={(ids) => setSearchHits(new Set(ids))} />}
        {activePanel === "plan" && sessionId && <PlanPanel sessionId={sessionId} nodes={nodes} />}
        {activePanel === "diff" && sessionId && <DiffPanelFull onDiff={handleDiff} changedCount={changedNodeIds.size} />}

        {selectedNode && <NodeInspector detail={selectedNode} onClose={() => setSelectedNode(null)} />}
      </aside>

      <main className="canvas-area" onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.max(0.2, Math.min(5, z * (e.deltaY > 0 ? 0.9 : 1.1)))); }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const startX = e.clientX, startY = e.clientY;
          const startPan = { ...pan };
          const onMove = (ev: MouseEvent) => setPan({ x: startPan.x + ev.clientX - startX, y: startPan.y + ev.clientY - startY });
          const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}>
        {nodes.length > 0 && positions.size > 0 ? (
          <svg className="graph-svg" viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${CANVAS_W / zoom} ${CANVAS_H / zoom}`}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 3 L 0 6 Z" fill="#52525b" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const s = positions.get(edge.source), t = positions.get(edge.target);
              if (!s || !t) return null;
              const dx = t.x - s.x, dy = t.y - s.y, dist = Math.sqrt(dx * dx + dy * dy) || 1, r = 10;
              return <line key={edge.edgeId} className="graph-edge" x1={s.x + (dx / dist) * r} y1={s.y + (dy / dist) * r}
                x2={t.x - (dx / dist) * r} y2={t.y - (dy / dist) * r} markerEnd="url(#arrow)" />;
            })}
            {nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const isHighlighted = searchHits.has(node.id);
              const isChanged = changedNodeIds.has(node.id);
              const hasViolation = violationNodeIds.has(node.id);
              const isSelected = selectedNode?.node.id === node.id;
              return (
                <g key={node.id} className="graph-node" onClick={() => handleNodeClick(node.id)} style={{ cursor: "pointer" }}>
                  <circle cx={pos.x} cy={pos.y} r={node.name.includes(".") ? 5 : 8} fill={kindColor(node.kind)}
                    stroke={isSelected ? "#fff" : isChanged ? "#ef4444" : isHighlighted ? "#fbbf24" : hasViolation ? "#f97316" : "none"}
                    strokeWidth={isSelected || isChanged || isHighlighted || hasViolation ? 3 : 0} />
                  <text className="node-label" x={pos.x} y={pos.y + 18}>
                    {node.name.length > 20 ? node.name.slice(0, 18) + "\u2026" : node.name}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="empty-state">
            <div className="icon">{loading || layoutLoading ? "\u23F3" : "\u25C7"}</div>
            <p>{loading ? "Opening workspace\u2026" : layoutLoading ? "Computing layout\u2026" : "Paste a file:// URI and click Open to visualise the graph."}</p>
          </div>
        )}
      </main>

      <footer className="event-log">
        <EventLog events={events} />
      </footer>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

// ── Summary Panel ──
function SummaryPanel({ summary }: { summary: SummaryData }) {
  return (
    <div className="sidebar-section">
      <h2>Summary</h2>
      <div className="summary-stat"><span className="label">Nodes</span><span className="value">{summary.totalNodes}</span></div>
      <div className="summary-stat"><span className="label">Edges</span><span className="value">{summary.totalEdges}</span></div>
      <div className="summary-stat"><span className="label">Clusters</span><span className="value">{summary.clusters.length}</span></div>
      <div style={{ marginTop: 12 }}>
        <h2>Clusters</h2>
        {summary.clusters.map((c) => (
          <div className="cluster-item" key={c.id}>
            <span className="cluster-name">{c.name}</span>
            <span className="cluster-size">{c.size} nodes</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Rules Panel ──
function RulesPanel({ violations, onHighlight }: { violations: ViolationData[]; onHighlight: (ids: string[]) => void }) {
  return (
    <div className="sidebar-section">
      <h2>Rules ({violations.length} violations)</h2>
      {violations.length === 0 && <p style={{ color: "var(--text-dim)", fontSize: 12 }}>All rules pass.</p>}
      {violations.map((v, i) => (
        <div key={i} className="violation-item" onClick={() => onHighlight(v.nodeIds ?? [])}>
          <span className={`severity-badge ${v.severity}`}>
            {v.severity === "error" ? "ERR" : v.severity === "warn" ? "WARN" : "INFO"}
          </span>
          <span className="violation-msg">{v.ruleId}: {v.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Plan Panel ──
function PlanPanel({ sessionId, nodes }: { sessionId: string; nodes: GraphNode[] }) {
  const [rationale, setRationale] = useState("");
  const [selectedOp, setSelectedOp] = useState("addMiddleware");
  const [targetNode, setTargetNode] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const handlePropose = useCallback(async () => {
    if (!targetNode || !rationale) return;
    try {
      const r = await callTool<{ planId: string; markdownUri: string }>("plan.propose", {
        sessionId, rationale, steps: [{ op: selectedOp, symbolId: targetNode, args: { name: "authMiddleware" } }],
      });
      setResult(`Plan created: ${r.planId}`);
    } catch (err) { setResult(`Error: ${err instanceof Error ? err.message : String(err)}`); }
  }, [sessionId, rationale, selectedOp, targetNode]);

  return (
    <div className="sidebar-section">
      <h2>Plan</h2>
      <input className="opener-input" placeholder="Rationale..." value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <select className="opener-input" value={selectedOp} onChange={(e) => setSelectedOp(e.target.value)} style={{ marginTop: 6 }}>
        {["addMiddleware", "renameSymbol", "extractFunction", "extractModule", "replaceImpl", "addCaching", "wrapTransformation", "addRateLimit"].map((op) =>
          <option key={op} value={op}>{op}</option>
        )}
      </select>
      <select className="opener-input" value={targetNode} onChange={(e) => setTargetNode(e.target.value)} style={{ marginTop: 6 }}>
        <option value="">Select target node...</option>
        {nodes.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.kind})</option>)}
      </select>
      <button className="opener-btn" onClick={handlePropose} disabled={!targetNode || !rationale} style={{ marginTop: 8, width: "100%" }}>
        Propose Plan
      </button>
      {result && <p style={{ marginTop: 8, fontSize: 12, color: result.startsWith("Error") ? "var(--error)" : "var(--success)" }}>{result}</p>}
    </div>
  );
}

// ── Diff Panel ──
function DiffPanelFull({ onDiff, changedCount }: { onDiff: (ref: string) => void; changedCount: number }) {
  const [ref, setRef] = useState("HEAD~1");
  return (
    <div className="sidebar-section">
      <h2>Diff Overlay</h2>
      <div className="opener-form">
        <input className="opener-input" type="text" placeholder="HEAD~1" value={ref} onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onDiff(ref); }} />
        <button className="opener-btn" onClick={() => onDiff(ref)}>Diff</button>
      </div>
      {changedCount > 0 && <p style={{ marginTop: 8, fontSize: 12, color: "var(--warn)" }}>{changedCount} nodes changed (highlighted red)</p>}
    </div>
  );
}

// ── Node Inspector ──
function NodeInspector({ detail, onClose }: { detail: NodeDetail; onClose: () => void }) {
  const { node } = detail;
  return (
    <div className="sidebar-section node-inspector">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Inspector</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>x</button>
      </div>
      <div className="summary-stat"><span className="label">Name</span><span className="value">{node.name}</span></div>
      <div className="summary-stat"><span className="label">Kind</span><span className="value" style={{ color: kindColor(node.kind) }}>{node.kind}</span></div>
      <div className="summary-stat"><span className="label">ID</span><span className="value" style={{ fontSize: 10 }}>{node.id}</span></div>
      {node.filePath && <div className="summary-stat"><span className="label">File</span><span className="value" style={{ fontSize: 10 }}>{node.filePath.split("/").pop()}</span></div>}
      {node.startLine && <div className="summary-stat"><span className="label">Lines</span><span className="value">{node.startLine}–{node.endLine}</span></div>}
      {detail.snippet && <pre className="diff-preview">{detail.snippet}</pre>}
    </div>
  );
}

// ── Event Log ──
function EventLog({ events }: { events: SessionEvent[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [events.length]);

  return (
    <div ref={listRef} style={{ height: "100%", overflowY: "auto" }}>
      <div className="event-log-header">Events ({events.length})</div>
      {events.length === 0 && <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)" }}>No events yet.</div>}
      {events.map((event, i) => {
        const time = new Date(event.at).toLocaleTimeString();
        const detail = Object.entries(event).filter(([k]) => k !== "kind" && k !== "at")
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
        return (
          <div className="event-row" key={i}>
            <span className="event-time">{time}</span>
            <span className="event-kind">{event.kind}</span>
            {detail && <span className="event-detail">{detail}</span>}
          </div>
        );
      })}
    </div>
  );
}
