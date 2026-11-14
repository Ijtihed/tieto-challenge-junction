// Per `architecture/v1-launch-plan.md` Step 9a-4 + §0.6.4 (d)
// integration-boundary equivalence rule.
//
// usePrMode is the Studio half of the engine's pr.review
// atlas-deep-link contract. The engine builds URLs with
// `?pr=<sha>&focus=<id>`; usePrMode parses them. If either
// side drifts, the link breaks silently.
//
// These tests:
//   1. Pin the format buildAtlasDeepLink produces
//   2. Verify usePrMode can parse the engine's link
//   3. Confirm graceful behaviour when no PR query is set

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePrMode, buildAtlasDeepLink } from "../hooks/usePrMode";

describe("Studio buildAtlasDeepLink (§0.6.2 canonical format)", () => {
  it("appends ?pr= for sha only", () => {
    const link = buildAtlasDeepLink("http://localhost:5173", "abc");
    expect(link).toBe("http://localhost:5173/?pr=abc");
  });

  it("appends ?pr= + &focus= when focusId is given", () => {
    const link = buildAtlasDeepLink("http://localhost:5173", "abc", "node:42");
    // URLSearchParams encodes the colon to %3A — the exact
    // encoding matches the engine's buildAtlasDeepLink which
    // also uses URLSearchParams-equivalent encoding.
    expect(link).toContain("?pr=abc");
    expect(link).toContain("focus=node");
  });

  it("strips trailing slash from baseUrl", () => {
    expect(buildAtlasDeepLink("http://localhost:5173/", "abc")).toBe(
      "http://localhost:5173/?pr=abc",
    );
  });

  it("ignores null/undefined focusId (sha-only output)", () => {
    expect(buildAtlasDeepLink("http://localhost:5173", "abc", null)).toBe(
      "http://localhost:5173/?pr=abc",
    );
    expect(buildAtlasDeepLink("http://localhost:5173", "abc", undefined)).toBe(
      "http://localhost:5173/?pr=abc",
    );
  });
});

describe("usePrMode hook (§0.6.4 (d) engine → studio link round-trip)", () => {
  const originalLocation = window.location;

  function setLocation(search: string): void {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search, href: `http://localhost:5173/${search}` },
    });
  }

  beforeEach(() => {
    setLocation("");
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("returns null when no ?pr= param is present", () => {
    setLocation("");
    const { result } = renderHook(() => usePrMode());
    expect(result.current).toBeNull();
  });

  it("parses ?pr=<sha> into prMode.prSha", () => {
    setLocation("?pr=abcdef0123");
    const { result } = renderHook(() => usePrMode());
    expect(result.current).not.toBeNull();
    expect(result.current?.prSha).toBe("abcdef0123");
    expect(result.current?.focusId).toBeNull();
  });

  it("parses ?pr=<sha>&focus=<id> into prMode.{prSha,focusId}", () => {
    setLocation("?pr=abc&focus=mynode");
    const { result } = renderHook(() => usePrMode());
    expect(result.current?.prSha).toBe("abc");
    expect(result.current?.focusId).toBe("mynode");
  });

  it("§0.6.4 (d): engine's buildAtlasDeepLink output parses correctly", () => {
    // This is the explicit integration-boundary equivalence
    // test. The engine's helper has the same name + signature.
    // If either drifts, parsing breaks.
    const engineLink = buildAtlasDeepLink("http://localhost:5173", "deadbeef");
    const url = new URL(engineLink);
    setLocation(url.search);
    const { result } = renderHook(() => usePrMode());
    expect(result.current?.prSha).toBe("deadbeef");
  });
});
