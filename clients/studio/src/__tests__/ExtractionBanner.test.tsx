// Per `architecture/v1-launch-plan.md` Step 2 — proves the Step 1
// banner contract: hidden when there are no failures, surfaces the
// reason breakdown when there are, expandable for detail,
// dismissible. This is the regression net for Step 1's UI surface:
// if the banner silently stops appearing on a failing extraction,
// the silent-drop bug effectively comes back even if the engine
// still reports it.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ExtractionBanner from "../components/workspace/ExtractionBanner";
import { useStore, type ExtractionStatsClient } from "../state/store";

function makeStats(opts: {
  attempted?: number;
  parsed?: number;
  failures: Array<{
    filePath: string;
    reason: "too-large" | "generated" | "parse-failed" | "read-failed";
    extractorId: string;
    detail?: string;
  }>;
}): ExtractionStatsClient {
  const attempted = opts.attempted ?? 100;
  const parsed = opts.parsed ?? attempted - opts.failures.length;
  return {
    filesAttempted: attempted,
    filesParsed: parsed,
    filesSkipped: opts.failures.length,
    failures: opts.failures,
    perExtractor: [],
  };
}

beforeEach(() => {
  useStore.setState({
    extractionStats: null,
    extractionBannerDismissed: false,
  });
  cleanup();
});

describe("ExtractionBanner — visibility", () => {
  it("renders nothing when extractionStats is null", () => {
    const { container } = render(<ExtractionBanner />);
    expect(container.querySelector('[data-testid="extraction-banner"]')).toBeNull();
  });

  it("renders nothing when failures.length === 0", () => {
    useStore.setState({
      extractionStats: makeStats({ attempted: 50, parsed: 50, failures: [] }),
    });
    const { container } = render(<ExtractionBanner />);
    expect(container.querySelector('[data-testid="extraction-banner"]')).toBeNull();
  });

  it("renders nothing when user has dismissed the banner", () => {
    useStore.setState({
      extractionStats: makeStats({
        failures: [
          { filePath: "/x/big.ts", reason: "too-large", extractorId: "extractor-typescript" },
        ],
      }),
      extractionBannerDismissed: true,
    });
    const { container } = render(<ExtractionBanner />);
    expect(container.querySelector('[data-testid="extraction-banner"]')).toBeNull();
  });
});

describe("ExtractionBanner — content", () => {
  it("shows the headline and the per-reason breakdown when failures exist", () => {
    useStore.setState({
      extractionStats: makeStats({
        attempted: 10,
        parsed: 7,
        failures: [
          { filePath: "/a.ts", reason: "too-large", extractorId: "extractor-typescript" },
          { filePath: "/b.ts", reason: "too-large", extractorId: "extractor-typescript" },
          { filePath: "/c.ts", reason: "parse-failed", extractorId: "extractor-python", detail: "Invalid argument" },
        ],
      }),
    });
    render(<ExtractionBanner />);
    expect(screen.getByText(/3 of 10 files skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/2 too large/i)).toBeInTheDocument();
    expect(screen.getByText(/1 parse failed/i)).toBeInTheDocument();
  });

  it("expands to show per-failure detail when 'show details' is clicked", () => {
    useStore.setState({
      extractionStats: makeStats({
        failures: [
          { filePath: "/src/Big.tsx", reason: "too-large", extractorId: "extractor-typescript", detail: "8 MB" },
        ],
      }),
    });
    render(<ExtractionBanner />);
    expect(screen.queryByText("/src/Big.tsx")).toBeNull();
    fireEvent.click(screen.getByText(/show details/i));
    expect(screen.getByText(/\/src\/Big\.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/extractor-typescript/)).toBeInTheDocument();
  });

  it("dismiss button hides the banner and sets extractionBannerDismissed", () => {
    useStore.setState({
      extractionStats: makeStats({
        failures: [
          { filePath: "/x.ts", reason: "parse-failed", extractorId: "extractor-typescript" },
        ],
      }),
    });
    render(<ExtractionBanner />);
    expect(screen.getByTestId("extraction-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/dismiss/i));
    expect(screen.queryByTestId("extraction-banner")).toBeNull();
    expect(useStore.getState().extractionBannerDismissed).toBe(true);
  });

  it("caps the displayed detail list at 50 with an overflow row", () => {
    const many = Array.from({ length: 65 }, (_, i) => ({
      filePath: `/f${i}.ts`,
      reason: "parse-failed" as const,
      extractorId: "extractor-typescript",
    }));
    useStore.setState({
      extractionStats: makeStats({ attempted: 100, parsed: 35, failures: many }),
    });
    render(<ExtractionBanner />);
    fireEvent.click(screen.getByText(/show details/i));
    expect(screen.getByText(/and 15 more/i)).toBeInTheDocument();
  });
});
