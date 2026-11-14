// Per `architecture/v1-launch-plan.md` Step 10a-4.
//
// Skeleton component library. Replaces bare "Loading..." text
// with content-shaped placeholders that pulse subtly. The
// shimmer is CSS-only (no framer-motion required) so it stays
// cheap and renders deterministically for visual-regression
// snapshots.
//
// Three building blocks:
//   - `<Skeleton/>` — generic shimmering rounded rect
//   - `<SkeletonText/>` — a stack of N text lines with
//     variable widths so the result looks paragraph-like
//   - `<SkeletonCard/>` — header + body composite for panel-
//     style loading states
//
// Composite components live in sibling files (e.g.
// `<SkeletonCanvas/>`, `<SkeletonPanel/>`) so panel-specific
// shapes are co-located with their consumers.
//
// All skeletons render the same content shape on every render
// (no random widths) so Playwright visual regression
// (Step 10a-6) produces stable snapshots.

import type { ReactNode } from "react";

interface SkeletonProps {
  /** Width in px or any valid CSS width. Default "100%". */
  readonly width?: string | number;
  /** Height in px or any valid CSS height. Default "1em". */
  readonly height?: string | number;
  /** Border radius. Default "rounded-md" (matches Tailwind
   *  default). Pass "rounded-full" for circular shapes. */
  readonly rounded?: "sm" | "md" | "lg" | "full" | "none";
  /** Additional class names; merged with the base skeleton
   *  classes. */
  readonly className?: string;
  /** Accessibility label for the loading state. */
  readonly ariaLabel?: string;
}

const ROUNDED_CLASSES = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
  none: "",
} as const;

/** Single skeleton element. Renders a `<div>` with the
 *  `schema-skeleton-pulse` animation. */
export function Skeleton({
  width = "100%",
  height = "1em",
  rounded = "md",
  className = "",
  ariaLabel = "Loading content",
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      className={`schema-skeleton bg-surface-container ${ROUNDED_CLASSES[rounded]} ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}

interface SkeletonTextProps {
  /** Number of lines to render. Default 3. Caller picks this
   *  so the placeholder matches the expected paragraph size. */
  readonly lines?: number;
  /** Optional className for the wrapping container. */
  readonly className?: string;
  /** Accessibility label. */
  readonly ariaLabel?: string;
}

/** A stack of skeleton text lines with deterministic varying
 *  widths (`100%`, `90%`, `95%`, `85%`, …) so the result
 *  looks paragraph-like without random jitter. Variety is
 *  purely cosmetic — no real text is rendered. */
export function SkeletonText({
  lines = 3,
  className = "",
  ariaLabel = "Loading text",
}: SkeletonTextProps) {
  // Deterministic widths so Playwright snapshots are stable.
  // The sequence cycles every 4 lines.
  const widths = ["100%", "90%", "95%", "85%"];
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-label={ariaLabel} role="status">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={widths[i % widths.length]}
          height="0.85em"
          rounded="sm"
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  /** Optional title-line skeleton. Pass `false` to omit. */
  readonly title?: boolean;
  /** Number of body text lines. Default 3. */
  readonly lines?: number;
  /** Optional className for the wrapping container. */
  readonly className?: string;
  /** Footer content (e.g. another skeleton). Pass any
   *  ReactNode. */
  readonly footer?: ReactNode;
}

/** Composite card-shape skeleton: title + body text + optional
 *  footer. Used by panel-style loading states. */
export function SkeletonCard({
  title = true,
  lines = 3,
  className = "",
  footer,
}: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label="Loading panel"
      className={`flex flex-col gap-3 p-4 bg-surface-container/40 rounded-lg ${className}`}
    >
      {title ? <Skeleton width="60%" height="1.2em" rounded="sm" /> : null}
      <SkeletonText lines={lines} />
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}
