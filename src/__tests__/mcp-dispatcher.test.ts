// Phase 4 — unit tests for the upgraded McpDispatcher.
//
// The Phase 1 empty-boot test covers zero-action cases.
// This file covers: action registration, tools/call routing,
// error handling, toolCount, and listTools with registered actions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpDispatcher, type ActionHandler } from "../mcp/index.ts";

function makeAction(
  name: string,
  result: { ok: true; data: unknown } | { ok: false; code: string; message: string },
): ActionHandler {
  return {
    name,
    description: `Test action: ${name}`,
    sideEffect: "none",
    async handle() { return result; },
  };
}

function makeThrowingAction(name: string, error: Error): ActionHandler {
  return {
    name,
    description: `Test throwing action: ${name}`,
    sideEffect: "none",
    async handle() { throw error; },
  };
}

describe("McpDispatcher — action registration + tools/call", () => {
  it("registerAction adds a tool to the tool list", () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(makeAction("my.tool", { ok: true, data: 42 }));

    const { tools } = dispatcher.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.name, "my.tool");
  });

  it("listTools returns correct shape for each registered tool", () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(makeAction("alpha", { ok: true, data: null }));
    dispatcher.registerAction(makeAction("beta", { ok: true, data: null }));

    const { tools } = dispatcher.listTools();
    assert.equal(tools.length, 2);
    for (const tool of tools) {
      assert.ok(tool.name);
      assert.ok(tool.description);
      assert.equal(tool.inputSchema.type, "object");
    }
  });

  it("toolCount matches the number of registered actions", () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    assert.equal(dispatcher.toolCount, 0);

    dispatcher.registerAction(makeAction("a", { ok: true, data: null }));
    assert.equal(dispatcher.toolCount, 1);

    dispatcher.registerAction(makeAction("b", { ok: true, data: null }));
    assert.equal(dispatcher.toolCount, 2);
  });

  it("registering two actions with the same name overwrites the first", () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(makeAction("dup", { ok: true, data: "first" }));
    dispatcher.registerAction(makeAction("dup", { ok: true, data: "second" }));

    assert.equal(dispatcher.toolCount, 1);
  });

  it("callTool routes to the correct action and returns its result", async () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(makeAction("graph.summary", { ok: true, data: { totalNodes: 42 } }));

    const result = await dispatcher.callTool("graph.summary", { sessionId: "s1" });
    assert.equal(result.isError, false);
    assert.equal(result.content.length, 1);

    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.totalNodes, 42);
  });

  it("callTool for unknown tool returns isError + unknown-tool code", async () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });

    const result = await dispatcher.callTool("nonexistent.tool", {});
    assert.equal(result.isError, true);

    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "unknown-tool");
    assert.ok(parsed.message.includes("nonexistent.tool"));
  });

  it("callTool on action returning ok:false sets isError true", async () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(makeAction("fail.action", { ok: false, code: "session-not-found", message: "nope" }));

    const result = await dispatcher.callTool("fail.action", {});
    assert.equal(result.isError, true);

    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "session-not-found");
  });

  it("callTool catches thrown errors and returns isError + internal code", async () => {
    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(makeThrowingAction("boom.action", new Error("kaboom")));

    const result = await dispatcher.callTool("boom.action", {});
    assert.equal(result.isError, true);

    const parsed = JSON.parse(result.content[0]!.text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "internal");
    assert.ok(parsed.message.includes("kaboom"));
  });

  it("callTool passes args through to the action handler", async () => {
    let receivedArgs: Record<string, unknown> = {};
    const action: ActionHandler = {
      name: "args.echo",
      description: "Test echo action",
      sideEffect: "none",
      async handle(args) {
        receivedArgs = args;
        return { ok: true, data: args };
      },
    };

    const dispatcher = new McpDispatcher({ name: "test", version: "0.0.0" });
    dispatcher.registerAction(action);

    await dispatcher.callTool("args.echo", { sessionId: "s1", query: "hello" });
    assert.equal(receivedArgs["sessionId"], "s1");
    assert.equal(receivedArgs["query"], "hello");
  });
});
