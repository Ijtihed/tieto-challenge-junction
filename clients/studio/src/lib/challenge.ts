// Challenge mode: Studio opens one repo and only shows the agent-PR review flow.
// Set VITE_CHALLENGE_MODE=0 to get the full Studio back.
export const CHALLENGE_MODE = import.meta.env.VITE_CHALLENGE_MODE !== "0";
// The repo under review: VITE_CHALLENGE_REPO if set, else the server's default
// (SCHEMA_TRUST_REPO or ~/junction26-messagepack-csharp), then whatever path was opened.
let repo: string = import.meta.env.VITE_CHALLENGE_REPO ?? "";
export const challengeRepo = () => repo;
export const setChallengeRepo = (path: string) => { repo = path; };

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Node id of a file node, matching the server's idFromLocator for `file://` locators. */
export function fileNodeId(rootPath: string, relPath: string): string {
  return `file:${fnv1a64Hex(`file://${rootPath}/${relPath}`)}`;
}
