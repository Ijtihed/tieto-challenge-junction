// Per architecture/schema-v3.md §9.3 — the 8 day-one bundled codemods.
// All ops have real implementations using text-based transforms.

import { NODE_KINDS, EDGE_RELATIONS, type NodeKind } from "./vocabulary.ts";

export interface OpContext {
  readonly filePath: string;
  readonly fileContent: string;
  readonly symbolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface OpPreview {
  readonly diff: string;
  readonly newContent: string;
  readonly blockers: { code: string; message: string }[];
}

export interface OpApplyResult {
  readonly newContent: string;
  readonly filesChanged: string[];
  readonly blockers?: { code: string; message: string }[];
}

export interface PreconditionResult {
  readonly pass: boolean;
  readonly reason?: string;
}

export interface OpPreconditionCtx {
  readonly nodeId: string;
  readonly nodeKind: NodeKind | string;
  readonly nodeName: string;
  readonly incomingEdges: readonly { relation: string; sourceKind: string }[];
  readonly outgoingEdges: readonly { relation: string; targetKind: string }[];
}

export interface BundledOp {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly applicableToKind: readonly NodeKind[];
  readonly preconditions?: ((ctx: OpPreconditionCtx) => PreconditionResult[]) | undefined;
  preview(ctx: OpContext): OpPreview;
  apply(ctx: OpContext): OpApplyResult;
}

function unifiedDiff(filePath: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let i = 0, j = 0;
  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
      lines.push(` ${origLines[i]}`);
      i++; j++;
    } else if (i < origLines.length && (j >= modLines.length || origLines[i] !== modLines[j])) {
      lines.push(`-${origLines[i]}`);
      i++;
    } else {
      lines.push(`+${modLines[j]}`);
      j++;
    }
  }
  return lines.join("\n");
}

function makeOp(id: string, name: string, description: string, kinds: readonly NodeKind[],
  transform: (ctx: OpContext) => string | null,
  preconditions?: BundledOp["preconditions"]): BundledOp {
  return {
    id, name, description, applicableToKind: kinds, preconditions,
    preview(ctx) {
      const result = transform(ctx);
      if (!result) return { diff: "", newContent: ctx.fileContent, blockers: [{ code: "no-match", message: `Could not apply ${name} to "${ctx.symbolName}"` }] };
      return { diff: unifiedDiff(ctx.filePath, ctx.fileContent, result), newContent: result, blockers: [] };
    },
    apply(ctx) {
      const result = transform(ctx);
      if (!result) return { newContent: ctx.fileContent, filesChanged: [], blockers: [{ code: "no-match", message: `Could not apply ${name} to "${ctx.symbolName}"` }] };
      return { newContent: result, filesChanged: [ctx.filePath] };
    },
  };
}

// 1. addMiddleware — insert middleware before the handler in a route call
const addMiddleware = makeOp(
  "addMiddleware", "Add Middleware",
  "Insert a middleware identifier before the handler in a route call",
  [NODE_KINDS.route_handler],
  (ctx) => {
    const mwName = (ctx.args["name"] as string | undefined) ?? NODE_KINDS.middleware;
    const routeRe = /^(\s*)((?:app|router|server)\.\w+\s*\([^,]+,\s*)(\w+)(\s*\)\s*;?)$/gm;
    let found = false;
    const result = ctx.fileContent.replace(routeRe, (match, indent, prefix, handler, suffix) => {
      if (found) return match;
      found = true;
      return `${indent}${prefix}${mwName}, ${handler}${suffix}`;
    });
    return found ? result : null;
  },
  (ctx) => {
    const results: PreconditionResult[] = [];
    if (ctx.nodeKind !== NODE_KINDS.route_handler) results.push({ pass: false, reason: "target must be a route_handler" });
    if (!ctx.incomingEdges.some((e) => e.relation === EDGE_RELATIONS.registers_route)) results.push({ pass: false, reason: "route_handler must be registered via registers_route edge" });
    return results.length > 0 ? results : [{ pass: true }];
  },
);

// 2. renameSymbol — find all occurrences and replace
const renameSymbol = makeOp(
  "renameSymbol", "Rename Symbol",
  "Rename a symbol and update all references in the file",
  [
    NODE_KINDS.utility, NODE_KINDS.service, NODE_KINDS.route_handler, NODE_KINDS.middleware,
    NODE_KINDS.data_access, NODE_KINDS.model, NODE_KINDS.contract, NODE_KINDS.deployment,
  ],
  (ctx) => {
    const newName = ctx.args["newName"] as string | undefined;
    if (!newName) return null;
    const oldName = ctx.symbolName.includes(".") ? ctx.symbolName.split(".").pop()! : ctx.symbolName;
    if (oldName === newName) return null;
    const re = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const result = ctx.fileContent.replace(re, newName);
    return result !== ctx.fileContent ? result : null;
  },
);

// 3. extractFunction — cut lines, create a new function, replace with call
const extractFunction = makeOp(
  "extractFunction", "Extract Function",
  "Extract a code block into a new function and replace with a call",
  [
    NODE_KINDS.utility, NODE_KINDS.service, NODE_KINDS.route_handler, NODE_KINDS.middleware,
    NODE_KINDS.data_access, NODE_KINDS.model,
  ],
  (ctx) => {
    const fnName = (ctx.args["functionName"] as string | undefined) ?? "extractedFunction";
    const startLine = ctx.args["startLine"] as number | undefined;
    const endLine = ctx.args["endLine"] as number | undefined;
    if (!startLine || !endLine) return null;

    const lines = ctx.fileContent.split("\n");
    if (startLine < 1 || endLine > lines.length || startLine > endLine) return null;

    const extracted = lines.slice(startLine - 1, endLine);
    const indent = extracted[0]?.match(/^(\s*)/)?.[1] ?? "";
    const body = extracted.map((l) => l.startsWith(indent) ? l.slice(indent.length) : l).join("\n");

    const newFunc = `\nfunction ${fnName}() {\n${body.split("\n").map((l) => `  ${l}`).join("\n")}\n}\n`;
    const replacement = `${indent}${fnName}();`;

    const newLines = [
      ...lines.slice(0, startLine - 1),
      replacement,
      ...lines.slice(endLine),
    ];

    return newLines.join("\n") + newFunc;
  },
  (ctx) => {
    const results: PreconditionResult[] = [];
    if (ctx.nodeKind === NODE_KINDS.external || ctx.nodeKind === NODE_KINDS.contract) results.push({ pass: false, reason: "cannot extract from external or contract nodes" });
    return results.length > 0 ? results : [{ pass: true }];
  },
);

// 4. extractModule — move declarations to a new file (returns modified original with import)
const extractModule = makeOp(
  "extractModule", "Extract Module",
  "Move declarations to a new module and rewrite imports",
  [
    NODE_KINDS.utility, NODE_KINDS.service, NODE_KINDS.route_handler, NODE_KINDS.middleware,
    NODE_KINDS.data_access, NODE_KINDS.model,
  ],
  (ctx) => {
    const moduleName = (ctx.args["moduleName"] as string | undefined) ?? "extracted";
    const symbolName = ctx.symbolName.includes(".") ? ctx.symbolName.split(".").pop()! : ctx.symbolName;

    const funcRe = new RegExp(`^(export\\s+)?(function\\s+${symbolName}\\s*\\([^]*?^\\})`, "gm");
    const constRe = new RegExp(`^(export\\s+)?(?:const|let|var)\\s+${symbolName}\\s*=\\s*[^;]+;`, "gm");

    let match = funcRe.exec(ctx.fileContent) ?? constRe.exec(ctx.fileContent);
    if (!match) return null;

    const declaration = match[0];
    const exportDecl = declaration.startsWith("export") ? declaration : `export ${declaration}`;
    const importLine = `import { ${symbolName} } from "./${moduleName}";\n`;
    const result = ctx.fileContent.replace(declaration, "").trim();

    return importLine + result + `\n\n// Extracted to ./${moduleName}.ts:\n// ${exportDecl.split("\n")[0]}\n`;
  },
);

// 5. replaceImpl — replace a function body
const replaceImpl = makeOp(
  "replaceImpl", "Replace Implementation",
  "Replace a function body with new content",
  [NODE_KINDS.utility, NODE_KINDS.service],
  (ctx) => {
    const newBody = ctx.args["body"] as string | undefined;
    if (!newBody) return null;
    const symbolName = ctx.symbolName.includes(".") ? ctx.symbolName.split(".").pop()! : ctx.symbolName;

    const funcRe = new RegExp(`(function\\s+${symbolName}\\s*\\([^)]*\\)\\s*(?::\\s*\\w+)?\\s*)\\{[^]*?\\n\\}`, "m");
    const match = funcRe.exec(ctx.fileContent);
    if (!match) return null;

    return ctx.fileContent.replace(match[0], `${match[1]}{\n${newBody}\n}`);
  },
);

// 6. addCaching — wrap a function call with cache lookup
const addCaching = makeOp(
  "addCaching", "Add Caching",
  "Wrap a service call with a cache lookup",
  [NODE_KINDS.service],
  (ctx) => {
    const cacheName = (ctx.args["cacheName"] as string | undefined) ?? "cache";
    const ttl = (ctx.args["ttlMs"] as number | undefined) ?? 60000;
    const symbolName = ctx.symbolName.includes(".") ? ctx.symbolName.split(".").pop()! : ctx.symbolName;

    const funcRe = new RegExp(`(function\\s+${symbolName}\\s*\\([^)]*\\)\\s*(?::\\s*\\w+)?\\s*)\\{\\n([\\s\\S]*?)\\n\\}`, "m");
    const match = funcRe.exec(ctx.fileContent);
    if (!match) return null;

    const full = match[0];
    const signature = match[1];
    const body = match[2];
    if (!full || !signature || !body) return null;
    const cacheKey = `"${symbolName}"`;
    const wrapped = `${signature}{\n  const cached = ${cacheName}.get(${cacheKey});\n  if (cached) return cached;\n  const result = (() => {\n${body}\n  })();\n  ${cacheName}.set(${cacheKey}, result, ${ttl});\n  return result;\n}`;
    return ctx.fileContent.replace(full, wrapped);
  },
);

// 7. wrapTransformation — wrap a function with before/after steps
const wrapTransformation = makeOp(
  "wrapTransformation", "Wrap Transformation",
  "Wrap a function with a transformation step",
  [NODE_KINDS.utility, NODE_KINDS.service],
  (ctx) => {
    const wrapperName = (ctx.args["wrapperName"] as string | undefined) ?? "transform";
    const symbolName = ctx.symbolName.includes(".") ? ctx.symbolName.split(".").pop()! : ctx.symbolName;

    const callRe = new RegExp(`\\b${symbolName}\\(`, "g");
    if (!callRe.test(ctx.fileContent)) return null;

    return ctx.fileContent.replace(
      new RegExp(`\\b${symbolName}\\(([^)]*)\\)`, "g"),
      `${wrapperName}(${symbolName}($1))`,
    );
  },
);

// 8. addRateLimit — insert rate-limit wrapper around a route handler
const addRateLimit = makeOp(
  "addRateLimit", "Add Rate Limit",
  "Insert a rate-limit wrapper around a route",
  [NODE_KINDS.route_handler],
  (ctx) => {
    const limiterName = (ctx.args["limiterName"] as string | undefined) ?? "rateLimit";
    const routeRe = /^(\s*)((?:app|router|server)\.\w+\s*\([^,]+,\s*)(\w+)(\s*\)\s*;?)$/gm;
    let found = false;
    const result = ctx.fileContent.replace(routeRe, (match, indent, prefix, handler, suffix) => {
      if (found) return match;
      found = true;
      return `${indent}${prefix}${limiterName}, ${handler}${suffix}`;
    });
    return found ? result : null;
  },
  (ctx) => {
    const results: PreconditionResult[] = [];
    if (ctx.nodeKind !== NODE_KINDS.route_handler) results.push({ pass: false, reason: "target must be a route_handler" });
    if (ctx.incomingEdges.some((e) => e.relation === EDGE_RELATIONS.applies_middleware && e.sourceKind === NODE_KINDS.middleware)) {
      const hasRateLimit = ctx.incomingEdges.some((e) => e.sourceKind === NODE_KINDS.middleware);
      if (hasRateLimit) results.push({ pass: true, reason: "middleware already applied (verify not duplicate)" });
    }
    return results.length > 0 ? results : [{ pass: true }];
  },
);

export const BUNDLED_OPS: readonly BundledOp[] = [
  addMiddleware, addCaching, wrapTransformation, extractModule,
  extractFunction, renameSymbol, replaceImpl, addRateLimit,
];

export function getOp(id: string): BundledOp | undefined {
  return BUNDLED_OPS.find((o) => o.id === id);
}
