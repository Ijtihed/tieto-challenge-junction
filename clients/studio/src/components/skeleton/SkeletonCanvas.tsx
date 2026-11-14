// Per `architecture/v1-launch-plan.md` Step 10a-4.
//
// Canvas-shaped loading skeleton. Replaces the bare
// "Loading canvas..." text fallback while the lazy-imported
// `<GraphCanvas/>` chunk is fetching. Renders 4 cluster
// placeholder boxes in a grid pattern so the user sees the
// canvas shape immediately rather than text.

import { Skeleton } from "./Skeleton";
import SchemaLogo from "@/components/SchemaLogo";

interface SkeletonCanvasProps {
  /** Optional override for the progress message. */
  readonly message?: string;
}

/** Canvas-loading skeleton. Three layers:
 *   - Centre logo + indeterminate progress bar (existing UX)
 *   - 4 cluster-shape skeletons (new — gives the canvas
 *     visual presence during the chunk fetch)
 *   - Subtle background grid (CSS dots, no JS) */
export function SkeletonCanvas({ message = "Loading canvas..." }: SkeletonCanvasProps) {
  return (
    <div
      role="status"
      aria-label={message}
      className="relative w-full h-full bg-surface flex items-center justify-center overflow-hidden"
    >
      {/* Background grid — deliberately faint */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(150,150,160,0.15) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Cluster skeletons — a 2x2 grid so the canvas has
          architectural presence while loading. Deliberately
          positioned with absolute values so Playwright
          snapshots stay deterministic. */}
      <div className="absolute inset-0 grid grid-cols-2 gap-12 p-16 pointer-events-none opacity-60">
        <Skeleton
          height="100%"
          rounded="lg"
          className="schema-skeleton-soft"
          ariaLabel="Cluster boundary placeholder"
        />
        <Skeleton
          height="100%"
          rounded="lg"
          className="schema-skeleton-soft"
          ariaLabel="Cluster boundary placeholder"
        />
        <Skeleton
          height="100%"
          rounded="lg"
          className="schema-skeleton-soft"
          ariaLabel="Cluster boundary placeholder"
        />
        <Skeleton
          height="100%"
          rounded="lg"
          className="schema-skeleton-soft"
          ariaLabel="Cluster boundary placeholder"
        />
      </div>

      {/* Centre overlay — logo + indeterminate progress */}
      <div className="relative z-10 flex flex-col items-center gap-4">
        <SchemaLogo className="w-10 h-10 opacity-30" />
        <div className="flex flex-col gap-2 items-center">
          <div className="w-48 h-2 bg-surface-container rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-schema-accent/40 rounded-full animate-pulse" />
          </div>
          <p className="text-xs text-on-surface-faint">{message}</p>
        </div>
      </div>
    </div>
  );
}
