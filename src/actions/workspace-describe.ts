// Per architecture/schema-v3.md §5.3 action 2
import { getSession } from "../session/index.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  py: "python",
  go: "go",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  rs: "rust",
  proto: "protobuf",
  sql: "sql",
};

const ACTIVE_EXTRACTORS = [
  { id: "extractor-typescript", languages: ["typescript", "javascript"] },
  { id: "extractor-python", languages: ["python"] },
  { id: "extractor-go", languages: ["go"] },
  { id: "extractor-java-kotlin", languages: ["java", "kotlin"] },
  { id: "extractor-ruby", languages: ["ruby"] },
  { id: "extractor-rust", languages: ["rust"] },
  { id: "extractor-generic-config", languages: ["protobuf", "openapi", "sql"] },
];

export const workspaceDescribe = {
  name: "workspace.describe" as const,
  description: "Describe the current workspace session including detected languages, extractors, samplers, and wire format metadata.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
    },
    required: ["sessionId"],
  },

  async handle(args: Record<string, unknown>) {
    const sessionId = args["sessionId"] as string | undefined;
    if (!sessionId) {
      return { ok: false as const, code: "invalid-args", message: "sessionId is required" };
    }

    const session = getSession(sessionId);
    if (!session) {
      return { ok: false as const, code: "session-not-found", message: `No session with id ${sessionId}` };
    }
    if (session.closed) {
      return { ok: false as const, code: "session-closed", message: `Session ${sessionId} is closed` };
    }

    session.lastActivityAt = Date.now();
    const graph = session.graph;
    const allNodes = graph.repos.flatMap((r) => r.nodes);
    const languages = [...new Set(allNodes.flatMap((n) => {
      const ext = n.filePath?.split(".").pop();
      if (ext && EXT_TO_LANG[ext]) return [EXT_TO_LANG[ext]!];
      return [];
    }))];

    return {
      ok: true as const,
      data: {
        rootUris: [...session.workspaceUris],
        languages,
        frameworks: [] as string[],
        buildSystem: null as string | null,
        monorepo: session.monorepo || session.workspaceUris.length > 1,
        archetype: session.archetype,
        extractors: ACTIVE_EXTRACTORS.map((e) => ({
          id: e.id, version: "0.0.0", languages: e.languages, "frameworks-detected": [] as string[],
        })),
        samplers: session.samplerPrefs.map((s) => {
          const envKeys: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };
          const key = envKeys[s];
          const available = s === "mock" || (key ? !!process.env[key] : false);
          return { id: `sampler-${s}`, vendor: s, available, reason: available ? undefined : (key ? `Set ${key}` : undefined) };
        }),
        wireFormatVersion: CURRENT_WIRE_VERSION,
        schemaVersion: "0.0.0",
        extractorBaseline: { extractedAt: Date.now(), hash: "" },
        testRunners: [] as { kind: string; command: string; cwd: string }[],
      },
    };
  },
};
