// ops.signatures — exposes the refinement-type signatures for all registered ops.
import { getSession } from "../session/index.ts";
import { allSignatures, checkSequence } from "../domain/op-signatures.ts";

export const opsSignatures = {
  name: "ops.signatures" as const,
  description: "List refinement-type signatures for all ops, including pre/post-conditions, required args, and optional composition check.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The active session ID" },
      checkSequence: {
        type: "array",
        items: { type: "string" },
        description: "Optional: op IDs to check pairwise composition",
      },
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

    const signatures = allSignatures().map((sig) => ({
      opId: sig.opId,
      preconditions: sig.preconditions.map((c) => ({ ...c })),
      postconditions: sig.postconditions.map((e) => ({ ...e })),
      requiredArgs: sig.requiredArgs,
    }));

    const seqInput = args["checkSequence"] as string[] | undefined;
    let sequenceResult: ReturnType<typeof checkSequence> | undefined;
    if (seqInput && seqInput.length >= 2) {
      sequenceResult = checkSequence(seqInput);
    }

    return {
      ok: true as const,
      data: {
        signatures,
        sequenceCheck: sequenceResult ?? null,
      },
    };
  },
};
