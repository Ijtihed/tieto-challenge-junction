// Per `research/25-95-percent-and-leveling.md` §8.1 +
// `architecture/v1-launch-plan.md` Step 3. Per-archetype labels
// + display names. Mirror of engine `src/domain/archetype-detect.ts`
// but Studio-private (lives in clients/, doesn't cross the DAG).

import type { ArchetypeIdClient } from "@/state/store";

interface ArchetypeMeta {
  readonly l1Label: string;
  readonly displayName: string;
}

const ARCHETYPE_META: Record<ArchetypeIdClient, ArchetypeMeta> = {
  "web-app-service":       { l1Label: "Services",  displayName: "Web app / service" },
  "library-sdk":           { l1Label: "Modules",   displayName: "Library / SDK" },
  "cli-tool":              { l1Label: "Commands",  displayName: "CLI tool" },
  "ai-ml-project":         { l1Label: "Notebooks", displayName: "AI / ML project" },
  "data-pipeline":         { l1Label: "Pipelines", displayName: "Data pipeline" },
  "infrastructure-devops": { l1Label: "Resources", displayName: "Infrastructure / DevOps" },
  "documentation-site":    { l1Label: "Sections",  displayName: "Documentation site" },
  "mobile-desktop":        { l1Label: "Areas",     displayName: "Mobile / desktop app" },
  "unclassified":          { l1Label: "Areas",     displayName: "Unclassified" },
};

/** The archetype-specific L1 label (Services / Modules /
 *  Commands / Notebooks / Pipelines / Resources / Sections /
 *  Areas). When the workspace archetype is unknown OR
 *  unclassified, falls back to the default L1 label "Areas"
 *  per doc 25 §8.1 row 9. */
export function archetypeL1Label(archetype: ArchetypeIdClient | null | undefined): string {
  if (!archetype) return "Areas";
  return ARCHETYPE_META[archetype].l1Label;
}

/** Human-readable display name for the L0 hero. */
export function archetypeDisplayName(archetype: ArchetypeIdClient | null | undefined): string {
  if (!archetype) return "";
  return ARCHETYPE_META[archetype].displayName;
}
