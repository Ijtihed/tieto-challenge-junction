// Per `architecture/v1-launch-plan.md` Step 9a work item 4.
//
// PR-mode banner. Renders at the top of Studio when the URL
// contains `?pr=<sha>`. Carries the same hybrid-strict
// framing as the engine's `pr.review` output:
//
//   - "Reviewing PR <short-sha>" header
//   - "Schema does not have merge authority" disclaimer
//   - An "exit PR mode" button that reloads Studio without
//     the query string
//
// Per research/26 §6: hybrid-strict empirical data (40% fewer
// defects, 55% faster, NO merge authority) is the binding
// framing. The banner makes that explicit at the UI level too,
// not just in the engine's markdown.

import type { PrMode } from "@/hooks/usePrMode";

interface Props {
  readonly prMode: PrMode;
}

export function PrModeBanner({ prMode }: Props) {
  const exitPrMode = () => {
    if (typeof window === "undefined") return;
    // Strip the query string + reload. Preserves any path-
    // based routing while clearing PR mode.
    const url = new URL(window.location.href);
    url.search = "";
    window.location.assign(url.toString());
  };

  return (
    <div
      role="status"
      aria-label="PR review mode"
      className="px-4 py-2 text-xs font-[JetBrains_Mono] flex items-center justify-between gap-3 shrink-0 bg-blue-950/60 text-blue-100 border-b border-blue-800/60"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-800/50 text-blue-100 uppercase tracking-wide text-[10px] font-semibold">
          PR review
        </span>
        <span className="text-blue-200">
          Reviewing <code className="font-bold">{prMode.prSha.slice(0, 12)}</code>
          {prMode.focusId ? (
            <>
              {" · focus on "}
              <code className="font-bold">{prMode.focusId}</code>
            </>
          ) : null}
        </span>
        <span className="text-blue-300/70 italic">
          Schema is advisory — humans hold merge authority.
        </span>
      </div>
      <button
        type="button"
        onClick={exitPrMode}
        className="underline underline-offset-2 hover:text-white transition-colors text-blue-200"
      >
        exit PR mode
      </button>
    </div>
  );
}
