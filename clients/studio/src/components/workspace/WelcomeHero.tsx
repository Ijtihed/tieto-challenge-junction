// Per `architecture/v1-launch-plan.md` Step 10a-5.
//
// Welcome hero — the first-impression screen when a workspace
// opens but the extracted graph is empty (zero clusters
// or < 5 nodes). Renders:
//
//   - "Welcome to your codebase atlas" headline (matches the
//     Step 3 doc-25 leveling framing per research/25 §9)
//   - The detected archetype as a labelled card
//   - A 5-sentence English summary (deterministic, derived
//     from extraction stats — node + edge + cluster counts +
//     primary language + archetype)
//
// **Why deterministic English** (not LLM-generated): per
// research/25 §9 + Q5 (founder-alone dogfood): every Studio
// view that fires on first-open must be **stable + fast +
// shareable**. An LLM-generated summary varies between runs,
// blocks on a network call, and undermines visual regression.
// A template-driven summary fires in <1 ms and produces the
// exact same bytes on every run.
//
// Renders only when needed (see WelcomeHeroGate below).

import { motion } from "framer-motion";
import { useStore } from "@/state/store";
import type {
  ArchetypeIdClient,
  WorkspaceArchetypeClient,
} from "@/state/store";

/** Per-archetype display metadata. Pinned by a §0.6.2
 *  canonical-set test so adding an archetype to the union
 *  without updating the metadata fails compilation. */
export const ARCHETYPE_META: Record<ArchetypeIdClient, { label: string; icon: string; oneLiner: string }> = {
  "web-app-service": {
    label: "Web App / Service",
    icon: "🌐",
    oneLiner: "An HTTP-facing application that serves users or other services.",
  },
  "library-sdk": {
    label: "Library / SDK",
    icon: "📚",
    oneLiner: "A reusable package other code depends on.",
  },
  "cli-tool": {
    label: "CLI Tool",
    icon: "▶",
    oneLiner: "A command-line program with one or more entry points.",
  },
  "ai-ml-project": {
    label: "AI / ML Project",
    icon: "🧠",
    oneLiner: "A machine-learning or AI codebase with model artifacts + training code.",
  },
  "data-pipeline": {
    label: "Data Pipeline",
    icon: "🔄",
    oneLiner: "A scheduled or streaming pipeline that moves + transforms data.",
  },
  "infrastructure-devops": {
    label: "Infrastructure / DevOps",
    icon: "⚙",
    oneLiner: "Tooling, CI, deployment, or operational infrastructure.",
  },
  "documentation-site": {
    label: "Documentation Site",
    icon: "📖",
    oneLiner: "A static site that serves docs or content.",
  },
  "mobile-desktop": {
    label: "Mobile / Desktop App",
    icon: "📱",
    oneLiner: "A platform-native application (iOS, Android, macOS, Windows).",
  },
  unclassified: {
    label: "Workspace",
    icon: "📦",
    oneLiner: "Schema couldn't pick an archetype yet — feed it more code.",
  },
};

/** Sorted set of archetype ids — exported for §0.6.2
 *  canonical-set tests. */
export const ARCHETYPE_IDS: readonly ArchetypeIdClient[] = [
  "web-app-service",
  "library-sdk",
  "cli-tool",
  "ai-ml-project",
  "data-pipeline",
  "infrastructure-devops",
  "documentation-site",
  "mobile-desktop",
  "unclassified",
];

/** Node-count threshold below which the WelcomeHero renders
 *  instead of the empty atlas. Per research/25 §9: "fewer
 *  than 5 nodes = not a real codebase yet". Exported so the
 *  App-level gating + the §0.6.4 (b) firing test reference
 *  the same constant. */
export const WELCOME_HERO_NODE_THRESHOLD = 5 as const;

/** Pure gating predicate. Extracted from `App.tsx` per
 *  §0.6.4 (a) so the threshold semantics can be unit-tested
 *  directly. */
export function shouldShowWelcomeHero(
  repoOpened: boolean,
  workingGraphNodeCount: number,
): boolean {
  return repoOpened && workingGraphNodeCount < WELCOME_HERO_NODE_THRESHOLD;
}

interface WelcomeSummaryInput {
  readonly archetype: WorkspaceArchetypeClient | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly clusterCount: number;
  readonly languages: readonly string[];
  readonly workspaceName: string;
}

/** Deterministic 5-sentence summary. Pure function so it's
 *  unit-testable per §0.6.4 (a) and snapshot-stable. */
export function buildWelcomeSummary(input: WelcomeSummaryInput): readonly string[] {
  const arch = input.archetype?.primary ?? "unclassified";
  const archMeta = ARCHETYPE_META[arch];
  const confidence = input.archetype?.confidence ?? 0;
  const isMonorepo = input.archetype?.monorepo ?? false;
  const langList =
    input.languages.length === 0
      ? "no recognised language"
      : input.languages.length === 1
        ? input.languages[0]!
        : input.languages.length === 2
          ? `${input.languages[0]} and ${input.languages[1]}`
          : `${input.languages.slice(0, -1).join(", ")}, and ${input.languages.at(-1)}`;

  // Each sentence is deterministic given the inputs. Sentence
  // 5 varies based on data presence so the user gets a
  // contextual nudge rather than empty filler.
  const sentences: string[] = [];
  // 1. Workspace + archetype identity
  sentences.push(
    `${input.workspaceName} is a ${archMeta.label.toLowerCase()}` +
      (isMonorepo ? " (monorepo)" : "") +
      `.`,
  );
  // 2. One-liner archetype description
  sentences.push(archMeta.oneLiner);
  // 3. Language breakdown
  sentences.push(`Schema reads ${langList}.`);
  // 4. Graph shape
  if (input.nodeCount === 0) {
    sentences.push("The graph is empty — no extractable code under the workspace root yet.");
  } else {
    sentences.push(
      `${input.nodeCount.toLocaleString()} node${input.nodeCount === 1 ? "" : "s"} ` +
        `and ${input.edgeCount.toLocaleString()} edge${input.edgeCount === 1 ? "" : "s"} extracted, ` +
        `grouped into ${input.clusterCount.toLocaleString()} area${input.clusterCount === 1 ? "" : "s"}.`,
    );
  }
  // 5. Confidence + next step
  if (input.archetype && confidence >= 0.6) {
    sentences.push(
      `Schema is ${Math.round(confidence * 100)}% confident in this classification. ` +
        `Explore the atlas or run pr.review on a PR to see Schema in action.`,
    );
  } else {
    sentences.push(
      "Schema isn't certain yet — extracting more files (or fewer ignores) will sharpen the archetype detection.",
    );
  }
  return sentences;
}

interface WelcomeHeroProps {
  /** Override the workspace name shown in the summary; for
   *  tests + storybook use. */
  readonly workspaceNameOverride?: string;
}

/** Welcome hero component. Reads from the store directly so
 *  it can be dropped into any layout. */
export function WelcomeHero({ workspaceNameOverride }: WelcomeHeroProps = {}) {
  const archetype = useStore((s) => s.workspaceArchetype);
  const graph = useStore((s) => s.workingGraph);
  const workspaceName =
    workspaceNameOverride ??
    graph?.rootDir?.split("/").filter(Boolean).at(-1) ??
    "This workspace";

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;
  const clusterCount = graph?.clusters?.length ?? 0;
  // Extract distinct languages from node kinds — uses the
  // same EXT_MAP convention as the engine.
  const languages = collectLanguages(graph?.nodes ?? []);

  const summary = buildWelcomeSummary({
    archetype,
    nodeCount,
    edgeCount,
    clusterCount,
    languages,
    workspaceName,
  });

  const archetypeId = archetype?.primary ?? "unclassified";
  const archMeta = ARCHETYPE_META[archetypeId];

  return (
    <motion.div
      role="status"
      aria-label="Welcome to your codebase atlas"
      data-testid="welcome-hero"
      className="absolute inset-0 z-10 flex items-center justify-center bg-surface/95 backdrop-blur-sm overflow-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <motion.div
        className="max-w-2xl w-full px-8 py-12 flex flex-col items-center text-center gap-8"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
      >
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Welcome to your codebase atlas.
          </h1>
          <p className="text-sm text-on-surface-muted max-w-md">
            Schema reads your repo as a typed graph. Here's what it sees in {workspaceName}.
          </p>
        </div>

        {/* Archetype card */}
        <div
          data-testid="welcome-hero-archetype"
          className="flex items-center gap-4 px-6 py-4 bg-surface-container border border-outline-variant rounded-lg"
        >
          <span className="text-3xl" role="img" aria-label={archMeta.label}>
            {archMeta.icon}
          </span>
          <div className="flex flex-col items-start text-left">
            <span className="text-xs uppercase tracking-wide text-on-surface-faint">
              Archetype
            </span>
            <span className="text-base font-semibold text-white">{archMeta.label}</span>
          </div>
        </div>

        {/* 5-sentence summary */}
        <div
          data-testid="welcome-hero-summary"
          className="flex flex-col gap-3 text-sm text-on-surface-variant leading-relaxed"
        >
          {summary.map((sentence, i) => (
            <p key={i}>{sentence}</p>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Distinct languages from a node list. Uses the extension
 *  map convention from `describeWorkspace` in workspace-open.
 *  Exported for unit testing. */
export function collectLanguages(nodes: readonly { file: string }[]): string[] {
  const EXT_MAP: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    go: "Go",
    java: "Java",
    kt: "Kotlin",
    rb: "Ruby",
    rs: "Rust",
    proto: "Protobuf",
    sql: "SQL",
  };
  const langs = new Set<string>();
  for (const n of nodes) {
    const ext = n.file?.split(".").pop();
    if (ext && EXT_MAP[ext]) langs.add(EXT_MAP[ext]);
  }
  return [...langs].sort();
}
