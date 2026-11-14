// Per architecture/specs/graph-persistence.md §6 + Step 6 of
// architecture/v1-launch-plan.md.
//
// Lists persisted snapshots for the active workspace. Step 6
// extends the payload with the overlay chain shape:
//  - Each snapshot carries `parentSnapshotId` (or null) and
//    `overlayUnits` (per-file unit set; empty for bases).
//  - The response also includes a flat `chains` array mapping
//    each base id to its ordered descendants (leaf → base) so a
//    UI can render the chain as a tree without a second
//    round-trip.

import { getSession } from "../session/index.ts";
import { openStore } from "../domain/persistence/store.ts";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".schema", "graph-cache.db");

/** Per `architecture/v1-launch-plan.md` Step 6 + the §0.6.4
 *  double-check addendum.
 *
 *  Pure helper that computes the chain-shape part of
 *  `graph.list_snapshots` response. Extracted so it can be
 *  unit-tested without spinning up a session + store: a future
 *  agent who refactors the action's chain construction gets
 *  caught by this test instead of needing to read the action's
 *  body to understand the contract.
 *
 *  Returns `{ leafId, ids }` pairs where `ids` is leaf → base. A
 *  leaf is a snapshot with no children. Snapshots already covered
 *  by a previously-emitted chain are skipped (so two leaves
 *  sharing a base produce one chain rooted at the more recent
 *  leaf — this can happen briefly during overlay creation). */
export function buildSnapshotChains(
  snapshots: readonly { id: number; parentSnapshotId: number | null }[],
  walkChain: (leafId: number) => readonly number[],
): { leafId: number; ids: readonly number[] }[] {
  const childrenByParent = new Map<number, number[]>();
  for (const s of snapshots) {
    if (s.parentSnapshotId !== null) {
      const arr = childrenByParent.get(s.parentSnapshotId) ?? [];
      arr.push(s.id);
      childrenByParent.set(s.parentSnapshotId, arr);
    }
  }
  const leaves = snapshots.filter((s) => !childrenByParent.has(s.id));
  const chains: { leafId: number; ids: readonly number[] }[] = [];
  const seen = new Set<number>();
  for (const leaf of leaves) {
    if (seen.has(leaf.id)) continue;
    const chain = walkChain(leaf.id);
    for (const id of chain) seen.add(id);
    chains.push({ leafId: leaf.id, ids: chain });
  }
  return chains;
}

export const graphListSnapshots = {
  name: "graph.list_snapshots" as const,
  description: "List persisted graph snapshots for the current workspace, including overlay chains per `architecture/v1-launch-plan.md` Step 6.",
  sideEffect: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
    },
    required: ["sessionId"],
  },
  async handle(args: Record<string, unknown>) {
    const sessionId = args.sessionId as string;
    if (!sessionId) return { ok: false as const, code: "MISSING_ARG", message: "sessionId required" };

    const session = getSession(sessionId);
    if (!session) return { ok: false as const, code: "SESSION_NOT_FOUND", message: `No session: ${sessionId}` };

    const workspacePath = session.workspaceUris[0]?.replace("file://", "") ?? "";
    if (!workspacePath) return { ok: false as const, code: "NO_WORKSPACE", message: "No workspace URI in session" };

    let store;
    try {
      store = openStore(DB_PATH);
      const snapshots = store.listSnapshots(workspacePath);
      const chains = buildSnapshotChains(snapshots, (id) => store!.getChain(id));
      return {
        ok: true as const,
        data: {
          snapshots,
          chains,
        },
      };
    } catch (err) {
      return { ok: false as const, code: "STORE_ERROR", message: err instanceof Error ? err.message : String(err) };
    } finally {
      store?.close();
    }
  },
};
