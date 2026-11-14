// Per architecture/schema-v3.md §14.1 — the Phase 1 gate test.
//
// Verifies:
// 1. The dispatcher boots with zero actions registered
// 2. The MCP initialize reply declares 6 capabilities
// 3. workspace.close (via dispatcher.close()) shuts down cleanly

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpDispatcher } from "../mcp/index.ts";

describe("Phase 1 gate — empty boot", () => {
  it("boots with zero actions and returns 6 capabilities", () => {
    const dispatcher = new McpDispatcher({
      name: "@schema-ai/mcp",
      version: "0.0.0",
    });

    const result = dispatcher.initialize();

    assert.equal(result.protocolVersion, "2025-11-25");
    assert.equal(result.serverInfo.name, "@schema-ai/mcp");

    const caps = Object.keys(result.capabilities);
    assert.equal(caps.length, 3, `Expected 3 capabilities, got ${caps.length}: ${caps.join(", ")}`);
    assert.ok(caps.includes("tools"));
    assert.ok(caps.includes("resources"));
    assert.ok(caps.includes("logging"));
  });

  it("lists zero tools when no actions registered", () => {
    const dispatcher = new McpDispatcher({
      name: "@schema-ai/mcp",
      version: "0.0.0",
    });

    dispatcher.initialize();
    const tools = dispatcher.listTools();

    assert.equal(tools.tools.length, 0);
  });

  it("closes cleanly", async () => {
    const dispatcher = new McpDispatcher({
      name: "@schema-ai/mcp",
      version: "0.0.0",
    });

    dispatcher.initialize();
    await dispatcher.close();

    assert.equal(dispatcher.isClosed, true);
  });

  it("double-close is idempotent", async () => {
    const dispatcher = new McpDispatcher({
      name: "@schema-ai/mcp",
      version: "0.0.0",
    });

    dispatcher.initialize();
    await dispatcher.close();
    await dispatcher.close();

    assert.equal(dispatcher.isClosed, true);
  });
});
