// Cache-key version hashes for extractor and bridge invalidation.
import { createHash } from "node:crypto";

export function computeExtractorVersionHash(extractorIds: readonly { id: string; version: string }[]): string {
  const sorted = [...extractorIds].sort((a, b) => a.id.localeCompare(b.id));
  const input = sorted.map((e) => `${e.id}@${e.version}`).join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function computeBridgesVersionHash(bridgeIds: readonly string[]): string {
  const sorted = [...bridgeIds].sort();
  const input = sorted.join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
