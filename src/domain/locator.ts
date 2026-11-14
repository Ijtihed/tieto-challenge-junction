// Per architecture/schema-v3.md §4.3 + §4.4

export interface Locator {
  readonly scheme: string;
  readonly raw: string;
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function idFromLocator(loc: Locator): string {
  return `${loc.scheme}:${fnv1a64Hex(loc.raw)}`;
}

export function parseLocator(raw: string): Locator {
  const colonIdx = raw.indexOf("://");
  if (colonIdx === -1) return { scheme: "file", raw };
  return { scheme: raw.slice(0, colonIdx), raw };
}
