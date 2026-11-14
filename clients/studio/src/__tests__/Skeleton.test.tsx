// Per `architecture/v1-launch-plan.md` Step 10a-4 + §0.6.4
// adversarial verification with refinements (a-g) from day-1.
//
// Tests for the skeleton component library:
//   - <Skeleton/> renders with the expected aria role + label
//   - <SkeletonText/> renders the right number of lines with
//     deterministic widths (snapshot-safe)
//   - <SkeletonCard/> composite renders title + body + footer
//   - <SkeletonCanvas/> renders the canvas-shape placeholder
//
// §0.6.4 (a): the deterministic width array is a pure constant;
// its cycle behaviour is pinned by a direct test.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonText, SkeletonCard } from "../components/skeleton/Skeleton";
import { SkeletonCanvas } from "../components/skeleton/SkeletonCanvas";

describe("<Skeleton/> base component", () => {
  it("renders with default props", () => {
    render(<Skeleton />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-label", "Loading content");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("applies the rounded variant class", () => {
    const { container } = render(<Skeleton rounded="full" />);
    const el = container.querySelector(".schema-skeleton") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.className).toContain("rounded-full");
  });

  it("rounded='none' renders no rounded class", () => {
    const { container } = render(<Skeleton rounded="none" />);
    const el = container.querySelector(".schema-skeleton") as HTMLElement;
    expect(el.className).not.toMatch(/rounded-/);
  });

  it("converts numeric width/height to px", () => {
    const { container } = render(<Skeleton width={120} height={48} />);
    const el = container.querySelector(".schema-skeleton") as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("48px");
  });

  it("custom ariaLabel applied", () => {
    render(<Skeleton ariaLabel="Loading inspector" />);
    expect(screen.getByLabelText("Loading inspector")).toBeInTheDocument();
  });
});

describe("<SkeletonText/>", () => {
  it("renders 3 lines by default", () => {
    const { container } = render(<SkeletonText />);
    // 1 outer status + 3 line statuses = 4 total
    expect(container.querySelectorAll(".schema-skeleton")).toHaveLength(3);
  });

  it("renders N lines when passed", () => {
    const { container } = render(<SkeletonText lines={7} />);
    expect(container.querySelectorAll(".schema-skeleton")).toHaveLength(7);
  });

  it("§0.6.4 (a): deterministic width cycle (snapshot-safe)", () => {
    // The widths array is `["100%", "90%", "95%", "85%"]`.
    // Pin the cycle: line 5 should reuse line 1's width.
    const { container } = render(<SkeletonText lines={5} />);
    const lines = container.querySelectorAll(".schema-skeleton") as NodeListOf<HTMLElement>;
    expect(lines).toHaveLength(5);
    expect(lines[0]!.style.width).toBe("100%");
    expect(lines[1]!.style.width).toBe("90%");
    expect(lines[2]!.style.width).toBe("95%");
    expect(lines[3]!.style.width).toBe("85%");
    // Line 5 cycles back to "100%" (index 4 mod 4 = 0)
    expect(lines[4]!.style.width).toBe("100%");
  });

  it("zero lines renders an empty container", () => {
    const { container } = render(<SkeletonText lines={0} />);
    expect(container.querySelectorAll(".schema-skeleton")).toHaveLength(0);
  });
});

describe("<SkeletonCard/> composite", () => {
  it("renders title + body + footer", () => {
    render(<SkeletonCard title lines={2} footer={<div data-testid="custom-footer">Footer</div>} />);
    expect(screen.getByLabelText("Loading panel")).toBeInTheDocument();
    expect(screen.getByTestId("custom-footer")).toBeInTheDocument();
  });

  it("omits title when title=false", () => {
    const { container } = render(<SkeletonCard title={false} lines={2} />);
    // Title would be a 60%-width line; body has 90/95/85 widths
    // (2 lines = "100%", "90%"). Without title we get exactly 2.
    const lines = container.querySelectorAll(".schema-skeleton") as NodeListOf<HTMLElement>;
    expect(lines).toHaveLength(2);
  });

  it("omits footer when not given", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelector('[data-testid="custom-footer"]')).toBeNull();
  });
});

describe("<SkeletonCanvas/>", () => {
  it("renders 4 cluster placeholders + centre overlay", () => {
    const { container } = render(<SkeletonCanvas />);
    // 4 cluster boundaries (one per grid cell)
    const cluster = container.querySelectorAll('[aria-label="Cluster boundary placeholder"]');
    expect(cluster).toHaveLength(4);
  });

  // Step 10a DC §0.6.4 (d): pin the cluster-placeholder CSS
  // class name. style.css declares `.schema-skeleton-soft` +
  // SkeletonCanvas.tsx applies it to the 4 cluster
  // placeholders. If either side renames without the other,
  // the placeholders stop shimmering. This test pins the
  // contract.
  it("§0.6.4 (d): cluster placeholders carry the schema-skeleton-soft class", () => {
    const { container } = render(<SkeletonCanvas />);
    const softEls = container.querySelectorAll(".schema-skeleton-soft");
    expect(softEls).toHaveLength(4);
  });

  it("uses default message (appears in the visible text + aria-label)", () => {
    render(<SkeletonCanvas />);
    // The default "Loading canvas..." appears in BOTH the
    // root aria-label AND the visible <p>. Confirm at least
    // one of each is rendered.
    expect(screen.getAllByText("Loading canvas...").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText("Loading canvas...").length).toBeGreaterThanOrEqual(1);
  });

  it("accepts a custom message", () => {
    render(<SkeletonCanvas message="Re-extracting…" />);
    expect(screen.getAllByText("Re-extracting…").length).toBeGreaterThanOrEqual(1);
  });

  it("sets aria-label on the root element to the message", () => {
    render(<SkeletonCanvas message="Rebuilding atlas" />);
    expect(screen.getAllByLabelText("Rebuilding atlas").length).toBeGreaterThanOrEqual(1);
  });
});
