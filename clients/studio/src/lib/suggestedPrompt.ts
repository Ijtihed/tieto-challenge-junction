/**
 * Suggested-prompt grammar parser. Pure function shared between the
 * VS Code extension's CodeActionsProvider (`packages/vscode-extension/
 * src/codeActions.ts`) and the planner's prompt parsing in `src/
 * server/planner/prompts/v1.ts`.
 *
 * Schema's built-in rules emit a `suggestedPrompt` string in two
 * shapes; this parser detects the op-form variant and extracts the
 * op name + label + params.
 *
 *   1. Op-form:
 *      "Apply requireAuth to GET /todos · op:addMiddleware middleware=requireAuth middlewareFile=src/auth/middleware.ts"
 *      → { opName: "addMiddleware", label: "Apply requireAuth to GET /todos",
 *          params: { middleware: "requireAuth", middlewareFile: "src/auth/middleware.ts" } }
 *
 *   2. Prose-only:
 *      "Don't import from src/payments inside src/auth"
 *      → null  (no op: token; caller falls back to free-form prompt)
 *
 * Returns null when the prompt has no `op:` token; that's the signal
 * for callers to use the prose / open-in-Schema fallback.
 */

export interface ParsedSuggestedPrompt {
  opName: string;
  label: string;
  params: Record<string, string>;
}

export function parseSuggestedPrompt(
  prompt: string,
): ParsedSuggestedPrompt | null {
  if (typeof prompt !== "string" || !prompt.includes("op:")) return null;
  const opIdx = prompt.indexOf("op:");
  const label = prompt.slice(0, opIdx).replace(/[·•|]\s*$/, "").trim();
  const opTail = prompt.slice(opIdx + "op:".length).trim();
  const tokens = opTail.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const opName = tokens[0];
  const params: Record<string, string> = {};
  for (const tok of tokens.slice(1)) {
    const eq = tok.indexOf("=");
    if (eq <= 0) continue;
    params[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return { opName, label, params };
}
