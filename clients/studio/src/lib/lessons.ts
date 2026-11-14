import type { State } from "@/state/store";

export interface Objective {
  id: string;
  label: string;
  /** Becomes true when the objective has been completed in the current state. */
  check: (state: State) => boolean;
}

/** Per `architecture/v1-launch-plan.md` Step 10a-3.
 *
 *  `LessonScript` carries the ordered mutations a lesson's
 *  "show me" affordance plays back. Callers (e.g. a lesson UI
 *  component) drive it via `playLesson(script, getState)`,
 *  passing the store accessor explicitly. This replaces the
 *  pre-Step-10a pattern where `script()` lazy-imported the
 *  store internally — that lazy import was the source of the
 *  Vite "store.ts is dynamically imported by lessons.ts but
 *  also statically imported by 31 callers" build warning.
 *
 *  The inversion-of-control move means lessons.ts is now
 *  store-agnostic at the import level: it imports only
 *  `type State`, which Vite happily tree-shakes. The build
 *  warning is gone + lessons.ts is unit-testable without
 *  touching the Zustand store. */
export type LessonScriptStep = {
  run: (s: State) => void | Promise<void>;
  delay: number;
};

export type LessonScript = readonly LessonScriptStep[];

export interface Lesson {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  estMinutes: number;
  intro: string[];
  objectives: Objective[];
  hint: string;
  successMessage: string;
  /** Ordered mutation sequence for the "show me" affordance.
   *  Lessons declare it; callers play it via `playLesson()`. */
  showMe?: LessonScript;
}

/** Pure-data helper: returns the script as-is so the
 *  declarations below stay readable. */
function script(steps: LessonScriptStep[]): LessonScript {
  return steps;
}

/** Play a `LessonScript`. Caller supplies a store accessor so
 *  this module doesn't import `useStore` (which would
 *  re-introduce the dual-import warning).
 *
 *  Returns a promise that resolves once all steps complete. */
export async function playLesson(
  steps: LessonScript,
  getState: () => State,
): Promise<void> {
  for (const step of steps) {
    const result = step.run(getState());
    if (result && typeof (result as Promise<void>).then === "function") {
      await result;
    }
    await new Promise((r) => setTimeout(r, step.delay));
  }
}

export const LESSONS: Lesson[] = [
  {
    id: "01-the-graph",
    index: 1,
    title: "The graph",
    subtitle: "Why Schema reads code as a graph, not a folder tree.",
    estMinutes: 2,
    intro: [
      "Schema doesn't care which folder a file is in. It cares which functions call which, what fronts an HTTP route, what touches the database, and where the seams are.",
      "It builds a typed graph: routes, services, middleware, data access, models. The same graph renders at three altitudes — **Architecture** (one card per cluster), **Modules** (one card per file), **Detail** (every function inside its cluster frame).",
      "Watch the graph zoom from clusters down to a single function. That single function is `requireAuth` — the JWT middleware that gates this app's protected routes. Hold onto that name.",
    ],
    objectives: [
      {
        id: "level-1",
        label: "Architecture: 5 clusters, ~30 nodes, all of it at a glance.",
        check: (s) => s.level === 1,
      },
      {
        id: "drill-auth",
        label: "Drill: zoom into one cluster to see its files.",
        check: (s) => s.drillPath.some((d) => d.id === "cluster:auth"),
      },
      {
        id: "find-requireAuth",
        label: "Inspect: a single function, with its callers and callees.",
        check: (s) =>
          s.selectedNodeId === "fn:src/middleware/auth.ts:requireAuth",
      },
    ],
    hint: "You can drive this yourself: click 'Architecture' in the top bar, double-click the Auth card to drill in, then click `requireAuth`.",
    successMessage:
      "That's the loop. The graph is the unit of navigation, and any function in your repo is one to three clicks away.",
    showMe: script([
      { delay: 600, run: (s) => s.goToLevel(1) },
      {
        delay: 700,
        run: (s) =>
          s.drillInto({ id: "cluster:auth", label: "Auth", level: 1 }),
      },
      {
        delay: 700,
        run: (s) =>
          s.drillInto({
            id: "module:src/middleware/auth.ts",
            label: "auth.ts",
            level: 2,
          }),
      },
      {
        delay: 500,
        run: (s) =>
          s.selectNode("fn:src/middleware/auth.ts:requireAuth"),
      },
    ]),
  },

  {
    id: "02-find-the-smell",
    index: 2,
    title: "Insights",
    subtitle: "Why Schema flags architectural problems automatically.",
    estMinutes: 2,
    intro: [
      "After every extraction or applied plan, Schema runs an insight pass over the graph: it looks for asymmetries (routes that should look alike but don't), missing edges, dead clusters, suspicious authorization gaps.",
      "Each insight comes with a **suggested prompt** so you can fix it with one click instead of describing the same problem in your own words.",
      "Watch this: Insights opens, hovers the high-severity card (the canvas highlights the routes it's worried about), then clicks the suggested prompt — and the planner kicks off. Three of the four routes in this repo require auth. One doesn't. That's the smell.",
    ],
    objectives: [
      {
        id: "open-insights",
        label: "Insights panel: every architectural smell at a glance.",
        check: (s) => s.sidePanelView === "insights",
      },
      {
        id: "hover-high",
        label: "Hover: see exactly which nodes the insight is about.",
        check: (s) =>
          s.hoverInsightTargets.has("route:src/routes/todos.ts:GET:/todos:14"),
      },
      {
        id: "load-prompt",
        label: "Click: the planner starts on a suggested prompt.",
        check: (s) => s.planPhase === "streaming" || s.planPhase === "preview",
      },
    ],
    hint: "Try it yourself: click the lightbulb icon on the slim left rail, hover the auth-asymmetry card, then click it.",
    successMessage:
      "Schema found the gap before you had to look for it: GET /todos and DELETE /todos/:id are missing the auth middleware their sibling POST has.",
    showMe: script([
      { delay: 500, run: (s) => s.setSidePanelView("insights") },
      {
        delay: 700,
        run: (s) => {
          // Find the auth-asymmetry insight and pretend the user hovered it
          const ins = s.insights.find((i) => i.id === "ins:auth-asymmetry");
          if (ins) s.hoverInsight(ins);
        },
      },
      {
        delay: 700,
        run: (s) => {
          const ins = s.insights.find((i) => i.id === "ins:auth-asymmetry");
          if (ins) s.submitPrompt(ins.suggestedPrompt);
        },
      },
    ]),
  },

  {
    id: "03-apply-a-fix",
    index: 3,
    title: "Apply",
    subtitle: "Why Schema's plans are typed AST steps, not freeform text.",
    estMinutes: 3,
    intro: [
      "When the planner returns, you get an ordered list of **typed ops**: `addMiddleware`, `addCaching`, `wrapTransformation`, `extractModule`. Each step targets a specific graph node by id. No prose. No 'find this string and replace it.'",
      "When you approve, Schema applies each step in order and runs your test suite between every one. A red test rolls the step back, leaving the working tree clean. Steps that pass flash green where they land on the canvas, so you can watch the architecture mutate in real time.",
      "Watch the plan stream in, get applied, and the canvas flash green on the two routes that just got `requireAuth`.",
    ],
    objectives: [
      {
        id: "preview",
        label: "Preview: a typed list of AST steps, ready to read.",
        check: (s) =>
          s.planPhase === "preview" && (s.plan?.steps.length ?? 0) >= 1,
      },
      {
        id: "approve",
        label: "Approve: each step runs through your test suite.",
        check: (s) => s.planPhase === "running" || s.planPhase === "done",
      },
      {
        id: "done",
        label: "Done: green flash on the canvas where the edges landed.",
        check: (s) => s.planPhase === "done",
      },
    ],
    hint: "Try it yourself: click 'apply →' in the plan panel.",
    successMessage:
      "Two routes patched. The auth gap is closed. The plan kept your working tree consistent the whole way through.",
    showMe: script([
      {
        delay: 500,
        run: (s) =>
          s.submitPrompt(
            "Apply requireAuth middleware to every route that doesn't already have it.",
          ),
      },
      // submitPrompt is async and only resolves once preview is reached;
      // we wait long enough for the streaming animation to finish.
      { delay: 2000, run: () => {} },
      { delay: 600, run: (s) => s.approvePlan() },
      // approvePlan runs the full per-step animation; this delay is long
      // enough to fall through to "done".
      { delay: 6000, run: () => {} },
    ]),
  },

  {
    id: "04-undo-and-rules",
    index: 4,
    title: "Undo + rules",
    subtitle: "Why a plan is always reversible, and rules are how you keep it.",
    estMinutes: 2,
    intro: [
      "Every plan that lands snapshots the previous working graph. **Undo** restores it, including any rule violations the plan had closed. Nothing is ever lost.",
      "Rules let you turn 'we always do X' into a one-line invariant. They re-evaluate after every applied plan, so the moment something drifts, you see the violation, and the planner already has a suggested fix.",
      "Watch this: the auth fix from lesson 3 gets undone — and the rule violation reappears, because the rule says every route under `/todos` needs `requireAuth`. The Rules panel opens so you can see the rule that flagged it.",
    ],
    objectives: [
      {
        id: "undo",
        label: "Undo: working tree restored, violations come back.",
        check: (s) =>
          s.lessonAppliedCount > 0 &&
          s.undoStack.length === 0 &&
          s.violations.length >= 1,
      },
      {
        id: "open-rules",
        label: "Rules panel: every architectural invariant in one place.",
        check: (s) => s.sidePanelView === "rules",
      },
      {
        id: "see-violation",
        label: "Violation: the rule fires the moment the gap reopens.",
        check: (s) =>
          s.violations.some(
            (v) =>
              v.ruleId === "rule:every-route-has-auth" ||
              v.ruleId === "rule:routes-need-auth-under-protected-paths",
          ),
      },
    ],
    hint: "Try it yourself: open History (clock icon), click 'undo last plan', then switch to the Rules panel.",
    successMessage:
      "That's the safety net: no destructive change is final, and a rule turns 'don't regress' into a build-time check.",
    showMe: script([
      // Pre-condition: this lesson assumes a plan has been applied. If not,
      // run one quickly so undo has something to do.
      {
        delay: 0,
        run: async (s) => {
          if (s.undoStack.length === 0 && s.violations.length > 0) {
            await s.submitPrompt(
              "Apply requireAuth middleware to every route that doesn't already have it.",
            );
          }
        },
      },
      { delay: 2400, run: () => {} },
      {
        delay: 0,
        run: async (s) => {
          if (s.planPhase === "preview") await s.approvePlan();
        },
      },
      { delay: 6500, run: () => {} },
      { delay: 600, run: (s) => s.undoLast() },
      { delay: 600, run: (s) => s.setSidePanelView("rules") },
    ]),
  },

  {
    id: "05-power-moves",
    index: 5,
    title: "Speed",
    subtitle: "⌘K finds anything. ? remembers what you forgot.",
    estMinutes: 2,
    intro: [
      "**⌘K** is the universal command bar: every function, every route, every file, every action — typed prompts included. Once you internalise it, the mouse is a fallback.",
      "**?** opens the cheat sheet with every shortcut on one screen. Glance once, then you never need it again.",
      "Watch the palette open, jump straight to `verifyToken` (a function nine clicks away on the canvas), and the cheat sheet comes up.",
    ],
    objectives: [
      {
        id: "search-open",
        label: "⌘K opens the command bar from anywhere.",
        check: (s) => s.searchOpen,
      },
      {
        id: "select-from-search",
        label: "Search jumps you to any function in one keystroke.",
        check: (s) =>
          s.selectedNodeId === "fn:src/services/authService.ts:verifyToken",
      },
      {
        id: "cheat-sheet",
        label: "? lists every shortcut on one screen.",
        check: (s) => s.cheatSheetOpen,
      },
    ],
    hint: "Try it yourself: ⌘K (Ctrl+K on Windows / Linux) → type 'verify' → Enter. Then press ?.",
    successMessage:
      "That's it. You've seen the loop end-to-end: read the graph, get an insight, apply a typed plan, undo, defend with a rule, navigate at speed. The next repo is yours.",
    showMe: script([
      { delay: 500, run: (s) => s.setSearchOpen(true) },
      { delay: 700, run: () => {} },
      {
        delay: 500,
        run: (s) => {
          s.setSearchOpen(false);
          s.selectNode("fn:src/services/authService.ts:verifyToken");
        },
      },
      { delay: 800, run: (s) => s.setCheatSheetOpen(true) },
    ]),
  },
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function nextLesson(currentId: string): Lesson | undefined {
  const idx = LESSONS.findIndex((l) => l.id === currentId);
  if (idx < 0) return undefined;
  return LESSONS[idx + 1];
}

export function prevLesson(currentId: string): Lesson | undefined {
  const idx = LESSONS.findIndex((l) => l.id === currentId);
  if (idx <= 0) return undefined;
  return LESSONS[idx - 1];
}
