// Per architecture/specs/graph-persistence.md §6 + Step 6 of
// architecture/v1-launch-plan.md.
//
// Deletes a persisted snapshot by id. Step 6: snapshots may have
// overlay descendants linked via `parent_snapshot_id`. The schema's
// `ON DELETE CASCADE` removes descendants automatically when a
// parent is deleted, but the action surfaces the cascade count so
// callers can show "Deleted snapshot #5 + 3 overlays" instead of
// the silent recursive delete.

import { getSession } from "../session/index.ts";
import { openStore } from "../domain/persistence/store.ts";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".schema", "graph-cache.db");

export const graphDeleteSnapshot = {
  name: "graph.delete_snapshot" as const,
  description: "Delete a persisted graph snapshot by ID. If the snapshot has overlay descendants, they are cascade-deleted; the response surfaces the descendant ids in `cascadedIds`.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      snapshotId: { type: "number" },
    },
    required: ["sessionId", "snapshotId"],
  },
  async handle(args: Record<string, unknown>) {
    const sessionId = args.sessionId as string;
    const snapshotId = args.snapshotId as number;
    if (!sessionId) return { ok: false as const, code: "MISSING_ARG", message: "sessionId required" };
    if (snapshotId == null) return { ok: false as const, code: "MISSING_ARG", message: "snapshotId required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "SESSION_NOT_FOUND", message: `No session: ${sessionId}` };

    const workspacePath = session.workspaceUris[0]?.replace("file://", "") ?? "";
    if (!workspacePath) return { ok: false as const, code: "NO_WORKSPACE", message: "No workspace URI in session" };

    let store;
    try {
      store = openStore(DB_PATH);
      // Pre-compute the cascade set so the response can carry it.
      // The CASCADE is performed inside the SQL DELETE itself; we
      // only enumerate IDs here for the wire payload.
      const before = store.listSnapshots(workspacePath);
      const cascadedIds = collectDescendants(before, snapshotId);
      const deleted = store.deleteSnapshot(snapshotId);
      return {
        ok: true as const,
        data: {
          deleted,
          snapshotId,
          cascadedIds,
        },
      };
    } catch (err) {
      return { ok: false as const, code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) };
    } finally {
      store?.close();
    }
  },
};

/** Walk forward from a parent id through the snapshot list,
 *  collecting all descendants (children, grandchildren, ...) but
 *  NOT the parent itself. Exported for testability. */
export function collectDescendants(
  snapshots: readonly { id: number; parentSnapshotId: number | null }[],
  parentId: number,
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const s of snapshots) {
    if (s.parentSnapshotId !== null) {
      const arr = childrenByParent.get(s.parentSnapshotId) ?? [];
      arr.push(s.id);
      childrenByParent.set(s.parentSnapshotId, arr);
    }
  }
  const out: number[] = [];
  const visited = new Set<number>();
  const worklist: number[] = [parentId];
  while (worklist.length > 0) {
    const cur = worklist.pop()!;
    const children = childrenByParent.get(cur) ?? [];
    for (const child of children) {
      if (visited.has(child)) continue;
      visited.add(child);
      out.push(child);
      worklist.push(child);
    }
  }
  return out;
}
