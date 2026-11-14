"use client";

// Per `architecture/v1-launch-plan.md` Step 1 (extraction failures) +
// Step 4 (filter breakdown). Surfaces:
//   - parse failures from the most-recent workspace.open
//   - per-reason filter breakdown (gitignored, codegen, binary, …)
// Renders nothing when there are no failures AND no filtered files.
// Step 2 extracted this component from App.tsx so it could carry
// its own unit test surface; Step 4 extends the details section to
// include the filter breakdown.

import { useState } from "react";
import { useStore } from "@/state/store";

export default function ExtractionBanner() {
  const stats = useStore((s) => s.extractionStats);
  const dismissed = useStore((s) => s.extractionBannerDismissed);
  const dismiss = useStore((s) => s.dismissExtractionBanner);
  const [expanded, setExpanded] = useState(false);

  if (!stats || dismissed) return null;

  const failureCount = stats.failures.length;
  const filteredTotal = stats.filtered
    ? Object.values(stats.filtered).reduce((a, b) => a + b, 0)
    : 0;
  if (failureCount === 0 && filteredTotal === 0) return null;

  // ── Headline summary ──────────────────────────────────────
  // Tone the banner color to severity: failures are amber/yellow
  // (something went wrong); filter-only is neutral grey (just
  // FYI).
  const isFailure = failureCount > 0;
  const palette = isFailure
    ? {
        bg: "bg-yellow-900/30",
        border: "border-yellow-800/40",
        text: "text-yellow-200",
        accent: "text-yellow-300/80",
        muted: "text-yellow-300/70",
        hover: "hover:text-yellow-50",
        dot: "bg-yellow-400",
      }
    : {
        bg: "bg-neutral-900/40",
        border: "border-neutral-700/40",
        text: "text-neutral-300",
        accent: "text-neutral-400",
        muted: "text-neutral-400",
        hover: "hover:text-neutral-100",
        dot: "bg-neutral-500",
      };

  // Per-failure-reason breakdown (Step 1).
  const byFailureReason = new Map<string, number>();
  for (const f of stats.failures) {
    byFailureReason.set(f.reason, (byFailureReason.get(f.reason) ?? 0) + 1);
  }
  const failureSummary = [...byFailureReason.entries()]
    .map(([reason, count]) => `${count} ${reason.replace(/-/g, " ")}`)
    .join(", ");

  // Per-filter-reason breakdown (Step 4). Reasons with 0 counts
  // are dropped from the summary line so the headline stays
  // short on most repos.
  const filterEntries = stats.filtered
    ? Object.entries(stats.filtered).filter(([, n]) => n > 0)
    : [];
  const filterSummary = filterEntries
    .map(([reason, count]) => `${count} ${reason.replace(/-/g, " ")}`)
    .join(", ");

  // Headline text varies by what's present.
  let headline = "";
  if (isFailure && filteredTotal > 0) {
    headline = `${failureCount} of ${stats.filesAttempted} files failed, ${filteredTotal} filtered`;
  } else if (isFailure) {
    headline = `${failureCount} of ${stats.filesAttempted} files skipped during extraction`;
  } else {
    headline = `${filteredTotal} files filtered (gitignore + generated + binary)`;
  }

  const detailLines = (stats.filteredSample ?? []).slice(0, 50);

  return (
    <div
      data-testid="extraction-banner"
      data-banner-variant={isFailure ? "failure" : "filter"}
      className={`${palette.bg} ${palette.text} border-b ${palette.border} text-xs font-[JetBrains_Mono] shrink-0`}
    >
      <div className="px-4 py-1.5 flex items-center justify-center gap-2">
        <span className={`w-2 h-2 rounded-full ${palette.dot}`} />
        <span>
          {headline}
          {isFailure && failureSummary ? (
            <span className={`${palette.accent}`}> &nbsp;·&nbsp; {failureSummary}</span>
          ) : null}
          {!isFailure && filterSummary ? (
            <span className={`${palette.accent}`}> &nbsp;·&nbsp; {filterSummary}</span>
          ) : null}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`ml-2 underline underline-offset-2 ${palette.hover} transition-colors`}
        >
          {expanded ? "hide details" : "show details"}
        </button>
        <button
          onClick={dismiss}
          className={`ml-2 ${palette.muted} ${palette.hover} transition-colors`}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-2 max-h-48 overflow-y-auto">
          {failureCount > 0 && (
            <div className="mb-2">
              <div className={`text-[10px] uppercase tracking-wider ${palette.muted} mb-1`}>
                Failures ({failureCount})
              </div>
              <ul className="text-[11px] space-y-0.5">
                {stats.failures.slice(0, 50).map((f, i) => (
                  <li key={i} className="font-mono">
                    <span className={palette.accent}>[{f.reason}]</span>{" "}
                    <span className={palette.muted}>{f.extractorId}</span>{" "}
                    <span>{f.filePath}</span>
                    {f.detail ? <span className={palette.accent}> — {f.detail}</span> : null}
                  </li>
                ))}
                {stats.failures.length > 50 && (
                  <li className={`italic ${palette.muted}`}>
                    …and {stats.failures.length - 50} more
                  </li>
                )}
              </ul>
            </div>
          )}
          {filteredTotal > 0 && detailLines.length > 0 && (
            <div>
              <div className={`text-[10px] uppercase tracking-wider ${palette.muted} mb-1`}>
                Filtered ({filteredTotal})
              </div>
              <ul className="text-[11px] space-y-0.5">
                {detailLines.map((f, i) => (
                  <li key={i} className="font-mono">
                    <span className={palette.accent}>[{f.reason}]</span>{" "}
                    <span>{f.filePath}</span>
                    {f.detail ? <span className={palette.accent}> — {f.detail}</span> : null}
                  </li>
                ))}
                {filteredTotal > detailLines.length && (
                  <li className={`italic ${palette.muted}`}>
                    …and {filteredTotal - detailLines.length} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
