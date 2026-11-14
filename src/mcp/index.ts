// Per architecture/schema-v3.md §3.10
// Note: serve.ts is a standalone entry point — NOT re-exported here
// to avoid side effects (it calls main() at module scope).
export { McpDispatcher, type McpServerInfo, type McpCapabilities, type ActionHandler, type ToolInfo, type ToolCallResult } from "./dispatcher.ts";
export { createHttpTransport, type HttpTransport, type TransportHttpOptions } from "./transport-http.ts";
export { createStdioTransport, type StdioTransport } from "./transport-stdio.ts";
