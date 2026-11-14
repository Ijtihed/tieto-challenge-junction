// Per `architecture/v1-launch-plan.md` Step 10a-2 + Step 10a
// double-check (§0.6.4 (b) firing-test rule). Pins the
// canvas-utils exports:
//
//   - `RELATION_STYLE` cardinality + monochrome contract +
//     animated-period contract (Step 10a §0.6.2 canonical
//     set)
//   - `countStackedAtOrigin` boundary
//   - `applyGridFallback` correctness
//
// The Step 10a DC found mutation O: dropping `animated: true`
// on `data_flow` was not caught. The new tests below pin
// each relation's animated flag + the contract that all
// animated dasharrays sum to 20 (the CSS animation period).

import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import {
  RELATION_STYLE,
  RELATION_STYLE_KEYS,
  EDGE_STROKE,
  EDGE_STROKE_HEAVY,
  countStackedAtOrigin,
  applyGridFallback,
} from "../components/canvas/canvas-utils";

// ──────────────────────────────────────────────────────────
// RELATION_STYLE canonical pinning (§0.6.2 + §0.6.4 (b))
// ──────────────────────────────────────────────────────────
describe("RELATION_STYLE canonical set", () => {
  it("has exactly 11 entries (Step 10a baseline)", () => {
    // If a new relation is added, both this number + the
    // dependent visual regression baselines need an update.
    // The Step 10a DC documented that Studio's EdgeRelation
    // union has 11 members vs the engine's 17 — that
    // pre-Step-10a drift is tracked separately. This test
    // pins the Studio side at 11.
    expect(RELATION_STYLE_KEYS).toHaveLength(11);
  });

  it("every relation has a stroke colour", () => {
    for (const key of RELATION_STYLE_KEYS) {
      const style = RELATION_STYLE[key];
      expect(style.stroke).toBeTruthy();
    }
  });

  it("monochrome contract: every stroke is EDGE_STROKE or EDGE_STROKE_HEAVY", () => {
    // Per Step 10a-2 design: edges convey relation via
    // line pattern + motion, NOT colour. A future agent who
    // introduces a coloured edge gets caught here.
    const allowed = new Set<string>([EDGE_STROKE, EDGE_STROKE_HEAVY]);
    for (const key of RELATION_STYLE_KEYS) {
      const stroke = RELATION_STYLE[key].stroke;
      expect(allowed.has(stroke)).toBe(true);
    }
  });

  it("EDGE_STROKE values are the canonical greys", () => {
    expect(EDGE_STROKE).toBe("#3E4044");
    expect(EDGE_STROKE_HEAVY).toBe("#6A6C72");
  });

  it("§0.6.4 (b): animated entries have a strokeDasharray", () => {
    for (const key of RELATION_STYLE_KEYS) {
      const style = RELATION_STYLE[key];
      if (style.animated) {
        expect(style.strokeDasharray).toBeTruthy();
      }
    }
  });

  it("§0.6.4 (b): animated dasharrays sum to 20 (CSS period contract)", () => {
    // Per the canvas-utils.ts contract: animated dashes
    // must sum to 20 so the CSS stroke-dashoffset animation
    // loops seamlessly with no jerky reset. A future agent
    // who tweaks a dash pattern without updating the
    // matching keyframe period would visually regress; this
    // test catches the dash side.
    for (const key of RELATION_STYLE_KEYS) {
      const style = RELATION_STYLE[key];
      if (!style.animated || !style.strokeDasharray) continue;
      const sum = style.strokeDasharray
        .split(/\s+/)
        .map((s) => parseInt(s, 10))
        .reduce((a, b) => a + b, 0);
      expect(sum).toBe(20);
    }
  });

  it("§0.6.4 (b): the canonical animated set covers the dynamic relations", () => {
    // applies_middleware + data_flow + rest_contract + grpc_contract
    // are the 4 relations whose semantics are "dynamic" (per
    // research/24 §10.2 — animated edges signal data
    // movement). Pin the canonical set so a future agent who
    // accidentally drops an `animated: true` (e.g. on
    // data_flow) gets caught.
    const animated = RELATION_STYLE_KEYS.filter(
      (k) => RELATION_STYLE[k].animated === true,
    ).sort();
    expect(animated).toEqual([
      "applies_middleware",
      "data_flow",
      "grpc_contract",
      "rest_contract",
    ]);
  });

  it("§0.6.4 (b): static relations do NOT have animated:true", () => {
    // The static set: imports, calls, registers_route,
    // control_flow, sql_contract, reads_field, writes_field.
    // None of these should ever animate (per the contract:
    // motion conveys data-movement semantics, not just
    // 'this edge exists').
    const staticRels = ["imports", "calls", "registers_route", "control_flow", "sql_contract", "reads_field", "writes_field"] as const;
    for (const rel of staticRels) {
      expect(RELATION_STYLE[rel]?.animated).not.toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────
// countStackedAtOrigin (§0.6.4 (c) boundary tests)
// ──────────────────────────────────────────────────────────
describe("countStackedAtOrigin", () => {
  function mkNode(id: string, x: number, y: number): Node {
    return { id, position: { x, y }, data: {} };
  }

  it("counts nodes exactly at (0,0)", () => {
    const nodes = [mkNode("a", 0, 0), mkNode("b", 0, 0), mkNode("c", 100, 100)];
    expect(countStackedAtOrigin(nodes)).toBe(2);
  });

  it("§0.6.4 (c): within tolerance counts as stacked (|x|<1 && |y|<1)", () => {
    expect(countStackedAtOrigin([mkNode("a", 0.5, 0.5)])).toBe(1);
    expect(countStackedAtOrigin([mkNode("a", -0.99, -0.99)])).toBe(1);
  });

  it("§0.6.4 (c): exactly at tolerance does NOT count (strict <1)", () => {
    expect(countStackedAtOrigin([mkNode("a", 1, 0)])).toBe(0);
    expect(countStackedAtOrigin([mkNode("a", 0, 1)])).toBe(0);
  });

  it("empty input → 0", () => {
    expect(countStackedAtOrigin([])).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// applyGridFallback
// ──────────────────────────────────────────────────────────
describe("applyGridFallback", () => {
  function mkNode(id: string, x: number, y: number): Node {
    return { id, position: { x, y }, data: {}, width: 240, height: 80 };
  }

  it("no stuck nodes → returns input unchanged", () => {
    const nodes = [mkNode("a", 100, 100), mkNode("b", 200, 200)];
    const out = applyGridFallback(nodes);
    expect(out).toBe(nodes);
  });

  it("stuck nodes get deterministic grid positions", () => {
    const nodes = [mkNode("a", 0, 0), mkNode("b", 0, 0), mkNode("c", 100, 100)];
    const out = applyGridFallback(nodes);
    // 2 stuck → 2-col grid (ceil(sqrt(2)) = 2 cols). First
    // stuck (k=0) → col 0, row 0 → (0, 0); second stuck
    // (k=1) → col 1, row 0 → (gapX, 0) = (320, 0).
    expect(out[0]!.position).toEqual({ x: 0, y: 0 });
    expect(out[1]!.position).toEqual({ x: 320, y: 0 });
    // c was already at (100,100); should be preserved
    expect(out[2]!.position).toEqual({ x: 100, y: 100 });
  });

  it("§0.6.4 (a) deterministic: same input → same output", () => {
    const nodes = () => [
      mkNode("a", 0, 0),
      mkNode("b", 0, 0),
      mkNode("c", 0, 0),
      mkNode("d", 0, 0),
    ];
    const out1 = applyGridFallback(nodes());
    const out2 = applyGridFallback(nodes());
    expect(out1.map((n) => n.position)).toEqual(out2.map((n) => n.position));
  });
});
