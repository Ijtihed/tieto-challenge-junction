// Thin MCP client over HTTP — per architecture §3.11 (wire only, no source import).

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

let nextId = 1;
let statusListener: ((s: "connected" | "disconnected") => void) | null = null;

/** Lets the app reflect real connectivity from every call, not only Studio's own API adapter. */
export function onMcpStatus(fn: (s: "connected" | "disconnected") => void) { statusListener = fn; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mcpCall<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  // Retry briefly so a server restart doesn't surface as a broken UI.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      });
      if (res.status < 500) break;
    } catch {
      res = null;
    }
    await sleep(600 * (attempt + 1));
  }
  if (!res) { statusListener?.("disconnected"); throw new Error("Schema server is not reachable"); }
  statusListener?.("connected");
  if (!res.ok) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as JsonRpcResponse;
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await mcpCall<{
    content: { type: string; text: string }[];
    isError: boolean;
  }>("tools/call", { name, arguments: args });
  const text = result.content[0]?.text;
  if (!text) throw new Error("Empty response from server");
  const parsed = JSON.parse(text) as { ok: boolean; data?: T; message?: string };
  if (!parsed.ok) throw new Error(parsed.message ?? "Action failed");
  return parsed.data as T;
}

export function subscribeEvents(
  sessionId: string,
  onEvent: (event: Record<string, unknown>) => void,
  onStatus?: (status: "connected" | "reconnecting" | "error") => void,
): () => void {
  const source = new EventSource(`/mcp/events/${sessionId}`);
  source.onopen = () => {
    onStatus?.("connected");
  };
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data as string));
    } catch {
      /* ignore parse errors */
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CONNECTING) {
      onStatus?.("reconnecting");
    } else {
      onStatus?.("error");
    }
  };
  return () => source.close();
}
