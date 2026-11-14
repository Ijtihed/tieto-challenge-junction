// Per `architecture/v1-launch-plan.md` Step 9a work item 4.
//
// PR-mode hook: parses the `?pr=<sha>&focus=<nodeId>` query
// string from `window.location` once on mount. Used by:
//   - <PrModeBanner /> to render the hybrid-strict banner
//   - <App /> to drive an initial node selection
//
// The hook is intentionally read-only: PR mode is set by the
// URL (a reviewer clicks the "View on atlas" link in a Schema
// PR comment), not by Studio UI. Exiting PR mode reloads
// Studio without the query string — see the banner's "exit"
// button.

import { useEffect, useState } from "react";

export interface PrMode {
  readonly prSha: string;
  readonly focusId: string | null;
}

/** Read the PR-mode parameters from `window.location.search`
 *  exactly once on mount. Returns null when no `?pr=` param
 *  is present (default Studio mode).
 *
 *  **Why a hook + useEffect** (not just a module-level
 *  constant): in test/SSR environments `window` is undefined,
 *  and a module-level read would crash. The hook defers the
 *  read to mount, mirroring the existing
 *  `bindMcpStatus` / `probeMcpHealth` pattern. */
export function usePrMode(): PrMode | null {
  const [prMode, setPrMode] = useState<PrMode | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const prSha = params.get("pr");
    if (!prSha) return;
    const focusId = params.get("focus");
    setPrMode({ prSha, focusId });
  }, []);

  return prMode;
}

/** Build a Studio URL for a given PR sha + optional focus
 *  node id. Used by the engine's `pr.review` markdown links
 *  + (in tests) by direct constructions. Mirrors the engine's
 *  `buildAtlasDeepLink` exactly so the two layers can't drift.
 *
 *  Per §0.6.4 (d): integration-boundary equivalence — the
 *  engine + studio agree on the link format. Pinned by a
 *  cross-layer test. */
export function buildAtlasDeepLink(
  baseUrl: string,
  prSha: string,
  focusId?: string | null,
): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ pr: prSha });
  if (focusId) params.set("focus", focusId);
  return `${trimmed}/?${params.toString()}`;
}
