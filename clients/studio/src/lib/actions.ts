import type { State } from "@/state/store";

export interface ActionItem {
  id: string;
  label: string;
  /** Tags help fuzzy match — e.g. "level architecture cluster". */
  tags: string[];
  /** Optional keyboard shortcut hint. */
  shortcut?: string;
  /** True when the action is currently meaningful. */
  enabled?: (s: State) => boolean;
  /** Returns true if the action could be invoked — useful for filtering out
   *  irrelevant suggestions (e.g. "undo" when the stack is empty). */
  visible?: (s: State) => boolean;
  run: (s: State) => void;
}

export const ACTIONS: ActionItem[] = [
  {
    id: "level:architecture",
    label: "Switch to Architecture",
    tags: ["level architecture clusters l1"],
    shortcut: "1",
    run: (s) => s.goToLevel(1),
  },
  {
    id: "level:modules",
    label: "Switch to Modules",
    tags: ["level modules files l2"],
    shortcut: "2",
    run: (s) => s.goToLevel(2),
  },
  {
    id: "level:detail",
    label: "Switch to Detail",
    tags: ["level detail functions l3"],
    shortcut: "3",
    run: (s) => s.goToLevel(3),
  },
  {
    id: "panel:problems",
    label: "Open Problems panel",
    tags: ["panel problems violations insights"],
    shortcut: "i",
    run: (s) => s.setSidePanelView("problems"),
  },
  {
    id: "panel:rules",
    label: "Open Rules panel",
    tags: ["panel rules constraints violations"],
    shortcut: "r",
    run: (s) => s.setSidePanelView("rules"),
  },
  {
    id: "panel:history",
    label: "Open History panel",
    tags: ["panel history past plans"],
    shortcut: "h",
    run: (s) => s.setSidePanelView("history"),
  },
  {
    id: "panel:about",
    label: "Open About panel",
    tags: ["panel about summary readme"],
    shortcut: "a",
    run: (s) => s.setSidePanelView("summary"),
  },
  {
    id: "panel:close",
    label: "Close side panel",
    tags: ["panel close hide"],
    shortcut: "esc",
    visible: (s) => s.sidePanelView !== null,
    run: (s) => {
      s.setSidePanelView(null);
      if (s.selectedNodeId) s.selectNode(null);
    },
  },
  {
    id: "go:home",
    label: "Go home (level 1, no drill path)",
    tags: ["home top level"],
    shortcut: "⌫",
    run: (s) => s.popToSegment(-1),
  },
  {
    id: "plan:undo",
    label: "Undo last applied plan",
    tags: ["undo rollback revert"],
    shortcut: "⌘Z",
    visible: (s) => s.undoStack.length > 0,
    run: (s) => s.undoLast(),
  },
  {
    id: "plan:cancel",
    label: "Discard active plan",
    tags: ["plan cancel discard close"],
    shortcut: "esc",
    visible: (s) =>
      s.planPhase === "preview" ||
      s.planPhase === "streaming" ||
      s.planPhase === "done",
    run: (s) => s.cancelPlan(),
  },
  {
    id: "snapshot:save",
    label: "Save current graph as a snapshot",
    tags: ["snapshot save checkpoint"],
    run: (s) => s.saveSnapshot(),
  },
  {
    id: "ui:cheat-sheet",
    label: "Open keyboard cheat sheet",
    tags: ["help shortcuts cheat sheet keys"],
    shortcut: "?",
    run: (s) => s.setCheatSheetOpen(true),
  },
  {
    id: "tutorial:open",
    label: "Open the tutorial",
    tags: ["tutorial learn lessons"],
    run: () => {
      if (typeof window !== "undefined") window.location.assign("/tutorial");
    },
  },
  {
    id: "prompt:auth",
    label: "Run prompt: apply requireAuth to every /todos route",
    tags: ["prompt auth requireauth"],
    run: (s) =>
      s.submitPrompt(
        "Apply requireAuth middleware to every route that doesn't already have it.",
      ),
  },
  {
    id: "prompt:cache",
    label: "Run prompt: memoize getDb",
    tags: ["prompt cache memoize getdb"],
    run: (s) =>
      s.submitPrompt(
        "Memoize getDb so the SQLite connection is opened once per process.",
      ),
  },
  {
    id: "panel:changes",
    label: "Open Changes panel",
    tags: ["panel changes diff review"],
    shortcut: "d",
    run: (s) => s.setSidePanelView("changes"),
  },
  {
    id: "panel:snapshots",
    label: "Open Snapshots panel",
    tags: ["panel snapshots save restore"],
    run: (s) => s.setSidePanelView("snapshots"),
  },
  {
    id: "panel:agents",
    label: "Open AGENTS.md panel",
    tags: ["panel agents agentsmd facts"],
    run: (s) => s.setSidePanelView("agents"),
  },
  {
    id: "panel:query",
    label: "Open Datalog Query panel",
    tags: ["panel query datalog search architectural"],
    shortcut: "q",
    run: (s) => s.setSidePanelView("query"),
  },
  {
    id: "panel:wisdom",
    label: "Open Wisdom panel",
    tags: ["panel wisdom skills canon knowledge"],
    shortcut: "w",
    run: (s) => s.setSidePanelView("wisdom"),
  },
  {
    id: "panel:insights",
    label: "Open Insights panel",
    tags: ["panel insights smell suggestions"],
    run: (s) => s.setSidePanelView("insights"),
  },
];
