/**
 * Stable repo-key derivation, runtime-agnostic.
 *
 * Used by both the canvas (browser) and /api/positions (server). Pure
 * arithmetic so it works in every JS runtime without crypto imports
 * and without BigInt (we target ES2017).
 *
 * Algorithm: FNV-1a 32-bit run twice with different seeds → 64-bit
 * output, hex-encoded as 16 chars. Collision rate is negligible for
 * the ≤ 10k repos-per-user bound this product cares about.
 *
 * IMPORTANT: changing this function silently invalidates everyone's
 * stored layouts. Don't change it without a migration plan.
 */

export function deriveRepoKey(input: {
  label: string;
  rootPath?: string | null;
}): string {
  // Concatenate with a separator that's vanishingly unlikely to
  // appear in either input, so "foo" + "bar" can't collide with
  // "foo\x1f" + "bar".
  const text = `${input.label || ""}\x1f${input.rootPath || "<no-root>"}`;
  const a = fnv1a32(text, 0x811c9dc5);
  const b = fnv1a32(text, 0x05f29f3d);
  return toHex32(a) + toHex32(b);
}

/** 32-bit FNV-1a. Number-based, identical output across runtimes. */
function fnv1a32(text: string, seed: number): number {
  // `>>> 0` keeps `hash` an unsigned 32-bit; `Math.imul` does the
  // 32-bit multiply correctly (JS Number multiply loses precision
  // around the 53-bit boundary).
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toHex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}
