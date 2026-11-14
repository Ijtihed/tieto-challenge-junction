import { createHash } from "node:crypto";

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function computeChangedFiles(
  previousHashes: ReadonlyMap<string, string>,
  currentFiles: Map<string, string>,
): { changedFiles: Set<string>; newHashes: Map<string, string> } {
  const changedFiles = new Set<string>();
  const newHashes = new Map<string, string>();

  for (const [path, content] of currentFiles) {
    const hash = contentHash(content);
    newHashes.set(path, hash);
    const prev = previousHashes.get(path);
    if (!prev || prev !== hash) {
      changedFiles.add(path);
    }
  }

  for (const [path] of previousHashes) {
    if (!currentFiles.has(path)) {
      changedFiles.add(path);
    }
  }

  return { changedFiles, newHashes };
}
