// Per architecture/schema-v3.md §17.6 + architecture/specs/semantic-diff.md §4
// FNV-1a 32-bit hash of a function body's structural content (excluding comments
// and whitespace). Used by semantic diff to detect renames, moves, and extractions.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

export function bodyFingerprint(bodyText: string): number {
  const normalized = bodyText
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/#[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return fnv1a32(normalized);
}
