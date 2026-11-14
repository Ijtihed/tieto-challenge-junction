// Per architecture/schema-v3.md §3.8 + phase-13.md §6.2 T5.2
// 5 procedural (incl. Claude Code workflow) + 4 paradigm-specific.
// Skills loaded from SKILL.md files at startup.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Skill {
  readonly id: string;
  readonly type: "procedural" | "paradigm";
  readonly title: string;
  readonly description: string;
  readonly body: string;
}

const SKILL_TYPES: Record<string, "procedural" | "paradigm"> = {
  "refactor-handler-into-service": "procedural",
  "extract-package-from-monolith": "procedural",
  "add-cross-cutting-middleware": "procedural",
  "detect-architectural-drift": "procedural",
  "claude-code-schema-workflow": "procedural",
  "erlang-otp-supervision": "paradigm",
  "cqrs-event-sourcing-rebuildability": "paradigm",
  "clojure-concurrency-primitive-selection": "paradigm",
  "jepsen-fault-class-reasoning": "paradigm",
};

function loadSkills(): Skill[] {
  const skillsDir = resolve(import.meta.dirname!, ".");
  const skills: Skill[] = [];
  let entries: string[];
  try { entries = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }

  for (const dir of entries) {
    const skillPath = join(skillsDir, dir, "SKILL.md");
    let raw: string;
    try { raw = readFileSync(skillPath, "utf-8"); } catch { continue; }

    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? dir;

    const descMatch = raw.match(/^#\s+.+\n+(.+?)(?:\n\n|\n##)/s);
    const description = descMatch?.[1]?.trim() ?? "";

    skills.push({
      id: dir,
      type: SKILL_TYPES[dir] ?? "procedural",
      title,
      description,
      body: raw,
    });
  }
  return skills;
}

export const BUNDLED_SKILLS: readonly Skill[] = loadSkills();
