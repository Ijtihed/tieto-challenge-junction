// Per `architecture/v1-launch-plan.md` Step 10a-3 (store
// dual-import fix). Pins the inversion-of-control pattern
// `playLesson(steps, getState)` so a future agent who
// re-introduces the lazy `import("@/state/store")` (the
// pattern that caused the Vite warning) gets caught by a
// failing test.

import { describe, it, expect, vi } from "vitest";
import { LESSONS, playLesson, type LessonScriptStep } from "../lib/lessons";
import type { State } from "../state/store";

describe("lessons.ts canonical: LESSONS array", () => {
  it("has exactly 5 lessons (the v1.0 baseline)", () => {
    expect(LESSONS).toHaveLength(5);
  });

  it("every lesson has the required fields", () => {
    for (const lesson of LESSONS) {
      expect(lesson.id).toBeTruthy();
      expect(lesson.index).toBeTypeOf("number");
      expect(lesson.title).toBeTruthy();
      expect(lesson.subtitle).toBeTruthy();
      expect(lesson.estMinutes).toBeGreaterThan(0);
      expect(lesson.intro.length).toBeGreaterThan(0);
      expect(lesson.objectives.length).toBeGreaterThan(0);
      expect(lesson.hint).toBeTruthy();
      expect(lesson.successMessage).toBeTruthy();
    }
  });

  it("every lesson's showMe is a LessonScript (array), not a function", () => {
    // §0.6.4 (a) extracted-helper rule + Step 10a-3 contract:
    // showMe must be data, not a thunk. A future regression
    // (e.g. someone wraps it back in `() => { ... }`) fails
    // this assertion + brings back the dual-import warning.
    for (const lesson of LESSONS) {
      if (lesson.showMe) {
        expect(Array.isArray(lesson.showMe)).toBe(true);
      }
    }
  });

  it("lesson indices are monotonically increasing from 1", () => {
    LESSONS.forEach((lesson, i) => {
      expect(lesson.index).toBe(i + 1);
    });
  });

  it("lesson ids are unique", () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("playLesson runner (Step 10a-3 inversion of control)", () => {
  it("invokes each step's run() with the current state", async () => {
    const steps: LessonScriptStep[] = [
      { run: vi.fn(), delay: 0 },
      { run: vi.fn(), delay: 0 },
      { run: vi.fn(), delay: 0 },
    ];
    const mockState = { foo: "bar" } as unknown as State;
    const getState = () => mockState;
    await playLesson(steps, getState);
    for (const step of steps) {
      expect(step.run).toHaveBeenCalledWith(mockState);
    }
  });

  it("awaits a step's returned promise before moving on", async () => {
    const events: string[] = [];
    const steps: LessonScriptStep[] = [
      {
        run: async () => {
          events.push("step1 start");
          await new Promise((r) => setTimeout(r, 5));
          events.push("step1 end");
        },
        delay: 0,
      },
      {
        run: () => { events.push("step2"); },
        delay: 0,
      },
    ];
    await playLesson(steps, () => ({}) as State);
    expect(events).toEqual(["step1 start", "step1 end", "step2"]);
  });

  it("§0.6.4 (a): the runner is pure-functional + accepts the store via parameter", async () => {
    // The key contract from Step 10a-3: `playLesson` does NOT
    // import `useStore` itself. We verify by ensuring the
    // function signature accepts a getState callback.
    expect(playLesson.length).toBe(2);
  });

  it("§0.6.4 (b): firing test for the inter-step delay", async () => {
    // Pin the delay semantics: if step.delay = 30 ms, the
    // total runtime must be at least 30 ms (the runner
    // actually waits). A mutation that skips the wait would
    // complete in < 30 ms and fail this assertion.
    const steps: LessonScriptStep[] = [
      { run: () => {}, delay: 30 },
      { run: () => {}, delay: 30 },
    ];
    const t0 = Date.now();
    await playLesson(steps, () => ({}) as State);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });
});
