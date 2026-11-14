"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import type { Rule, RuleSource, Severity } from "@/lib/types";

/**
 * Rules panel — full editor.
 *
 * Three tabs:
 *   - Imported   → read-only list of rules pulled from the repo's
 *                  `.cursor/rules/*.{md,mdc}`, `AGENTS.md`,
 *                  `.cursorrules`, `CLAUDE.md`, `rules/*.md`. Each
 *                  rule can be toggled on/off and switched between
 *                  display-only and LLM-enforced.
 *   - Custom     → user-authored prose rules. Add / edit / delete.
 *                  Always LLM-evaluated by default; can be flipped to
 *                  display-only.
 *   - Built-in   → the deterministic shipped rule set. Toggleable; the
 *                  shape (scope / requires) is fixed.
 *
 * Persistence: edits live in the Zustand store until the user hits
 * "Save to schema.config.json" — that POSTs to /api/rules/save which
 * writes the file and re-evaluates. A small "unsaved changes" hint sits
 * in the panel header while there are local edits.
 *
 * Violations are pulled from the same store slot the Problems panel
 * uses, so a fix from one panel updates both.
 */

const SEVERITY: Record<Severity, { dot: string; label: string }> = {
  high: { dot: "bg-phase-fail", label: "text-phase-fail" },
  medium: { dot: "bg-phase-testing", label: "text-phase-testing" },
  low: { dot: "bg-phase-applying", label: "text-phase-applying" },
};

type TabId = "imported" | "custom" | "builtin";

export default function RulesPanel() {
  const rules = useStore((s) => s.rules);
  const violations = useStore((s) => s.violations);
  const hoverViolation = useStore((s) => s.hoverViolation);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const focusOnIds = useStore((s) => s.focusOnIds);
  const toggleRule = useStore((s) => s.toggleRule);
  const setRuleEvaluation = useStore((s) => s.setRuleEvaluation);
  const updateCustomRule = useStore((s) => s.updateCustomRule);
  const deleteCustomRule = useStore((s) => s.deleteCustomRule);
  const addCustomRule = useStore((s) => s.addCustomRule);
  const reimportRules = useStore((s) => s.reimportRules);
  const saveRulesToDisk = useStore((s) => s.saveRulesToDisk);
  const checkRule = useStore((s) => s.checkRule);
  const repo = useStore((s) => s.repo);

  const [tab, setTab] = useState<TabId>("imported");
  const [showAdd, setShowAdd] = useState(false);

  const grouped = useMemo(() => {
    const out: Record<TabId, Rule[]> = {
      imported: [],
      custom: [],
      builtin: [],
    };
    for (const r of rules) {
      const src: RuleSource = r.source ?? "builtin";
      if (src === "imported") out.imported.push(r);
      else if (src === "custom") out.custom.push(r);
      else out.builtin.push(r);
    }
    return out;
  }, [rules]);

  const hasRepo = !!repo.rootPath;
  const counts = {
    imported: grouped.imported.length,
    custom: grouped.custom.length,
    builtin: grouped.builtin.length,
  };

  const visibleRules = grouped[tab];

  return (
    <div className="flex flex-col" data-testid="rules-panel">
      {/* Action bar */}
      <div className="px-4 pt-4 pb-3 border-b border-outline-variant/60 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => reimportRules()}
          disabled={!hasRepo}
          className="text-xs text-on-surface-muted hover:text-white disabled:text-on-surface-faint disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          title={
            hasRepo
              ? "Re-walk the repo for rule files"
              : "Open a real repo to enable this"
          }
          data-testid="rules-reimport"
        >
          <span className="material-symbols-outlined text-[14px] leading-none">
            refresh
          </span>
          Re-import
        </button>
        <button
          type="button"
          onClick={() => saveRulesToDisk()}
          disabled={!hasRepo}
          className="text-xs text-on-surface-muted hover:text-white disabled:text-on-surface-faint disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          title={
            hasRepo
              ? "Persist customs + toggles to schema.config.json"
              : "Open a real repo to enable saves"
          }
          data-testid="rules-save"
        >
          <span className="material-symbols-outlined text-[14px] leading-none">
            save
          </span>
          Save
        </button>
        {tab === "custom" && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="ml-auto text-xs text-schema-accent hover:text-white transition-colors flex items-center gap-1.5"
            data-testid="rules-add-custom"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">
              add
            </span>
            Add rule
          </button>
        )}
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-outline-variant/60">
        {(["imported", "custom", "builtin"] as TabId[]).map((id) => {
          const active = tab === id;
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              data-testid={`rules-tab-${id}`}
              className={`flex-1 px-4 py-2.5 text-sm transition-colors relative ${
                active
                  ? "text-white"
                  : "text-on-surface-muted hover:text-white"
              }`}
            >
              <span>{tabLabel(id)}</span>
              {count > 0 && (
                <span className="ml-2 text-on-surface-faint tabular-nums">
                  {count}
                </span>
              )}
              {active && (
                <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-schema-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {visibleRules.length === 0 && (
          <EmptyState tab={tab} hasRepo={hasRepo} />
        )}
        {visibleRules.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            violation={violations.find((v) => v.ruleId === r.id) ?? null}
            onToggle={() => toggleRule(r.id)}
            onSetEvaluation={(ev) => setRuleEvaluation(r.id, ev)}
            onCheck={() => checkRule(r.id)}
            onDelete={
              r.source === "custom" ? () => deleteCustomRule(r.id) : null
            }
            onUpdate={
              r.source === "custom"
                ? (patch) => updateCustomRule(r.id, patch)
                : null
            }
            onApplyFix={(prompt) => submitPrompt(prompt)}
            onHover={(targets) =>
              targets ? hoverViolation({ ruleId: r.id, targetIds: targets, message: "", suggestedPrompt: "" }) : hoverViolation(null)
            }
            onFocus={(targets) => focusOnIds(targets)}
          />
        ))}
      </div>

      {showAdd && (
        <AddCustomRuleModal
          onClose={() => setShowAdd(false)}
          onCreate={(input) => {
            addCustomRule(input);
            setShowAdd(false);
            setTab("custom");
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────── Card ─────────────────────── */

interface RuleCardProps {
  rule: Rule;
  violation: { ruleId: string; targetIds: string[]; message: string; suggestedPrompt: string } | null;
  onToggle: () => void;
  onSetEvaluation: (ev: "display" | "llm") => void;
  onCheck: () => void;
  onDelete: (() => void) | null;
  onUpdate: ((patch: { description?: string; body?: string; severity?: Severity; evaluation?: "display" | "llm"; globs?: string[] }) => void) | null;
  onApplyFix: (prompt: string) => void;
  onHover: (targets: string[] | null) => void;
  onFocus: (targets: string[]) => void;
}

function RuleCard({
  rule,
  violation,
  onToggle,
  onSetEvaluation,
  onCheck,
  onDelete,
  onUpdate,
  onApplyFix,
  onHover,
  onFocus,
}: RuleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const sev = SEVERITY[(rule.severity as Severity) ?? "medium"] ?? SEVERITY.medium;
  const isProse = rule.kind === "prose";
  const evaluation = rule.evaluation ?? (isProse ? "display" : "deterministic");
  const isLlm = evaluation === "llm";
  const isDeterministic = evaluation === "deterministic";

  return (
    <div
      data-testid={`rule-${rule.id}`}
      onMouseEnter={() => violation && onHover(violation.targetIds)}
      onMouseLeave={() => onHover(null)}
      className={`border ${
        violation ? "border-violation/40" : "border-outline-variant"
      } bg-surface-dim hover:bg-neutral-950 transition-colors`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
            <div className="min-w-0">
              <p className="text-sm text-white">
                {rule.description}
              </p>
              {rule.sourcePath && (
                <p className="mt-0.5 font-[JetBrains_Mono] text-xs text-on-surface-faint truncate">
                  {rule.sourcePath}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onToggle}
            data-testid={`rule-toggle-${rule.id}`}
            className={`text-xs shrink-0 ${
              rule.enabled ? "text-white" : "text-on-surface-faint"
            }`}
          >
            {rule.enabled ? "on" : "off"}
          </button>
        </div>

        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 mt-2 pt-2 border-t border-outline-variant/60">
          <span className="text-xs text-neutral-500">
            {rule.kind === "prose" ? "prose" : rule.kind.replace(/_/g, " ")}
          </span>

          {!isDeterministic && (
            <select
              value={evaluation}
              onChange={(e) =>
                onSetEvaluation(e.target.value as "display" | "llm")
              }
              data-testid={`rule-evaluation-${rule.id}`}
              className="bg-surface border border-outline-variant px-1.5 py-0.5 text-xs text-neutral-300 hover:text-white hover:border-neutral-600"
            >
              <option value="display">Display only</option>
              <option value="llm">Enforce</option>
            </select>
          )}

          {isLlm && (
            <button
              type="button"
              onClick={onCheck}
              className="text-xs text-schema-accent hover:text-white transition-colors"
              data-testid={`rule-check-${rule.id}`}
            >
              Check
            </button>
          )}

          {violation ? (
            <button
              onClick={() => {
                onFocus(violation.targetIds);
                if (violation.suggestedPrompt) {
                  onApplyFix(violation.suggestedPrompt);
                }
              }}
              className="text-xs text-violation hover:text-white transition-colors ml-auto"
            >
              fix · {violation.targetIds.length}
            </button>
          ) : (
            rule.enabled && (
              <span className="text-xs text-flash-new ml-auto">
                in sync
              </span>
            )
          )}
        </div>

        {/* Body / preview toggle */}
        {(rule.body || rule.globs?.length) && (
          <div className="mt-3 pt-3 border-t border-outline-variant/60">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-on-surface-muted hover:text-white"
            >
              {expanded ? "Hide" : "Show"}
            </button>
            {expanded && rule.body && (
              <pre
                data-testid={`rule-body-${rule.id}`}
                className="mt-2 max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words font-[JetBrains_Mono] text-xs text-neutral-300 leading-relaxed bg-black/40 border border-outline-variant/60 p-2.5"
              >
                {rule.body}
              </pre>
            )}
            {expanded && rule.globs && rule.globs.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-on-surface-faint">
                  applies to:
                </span>
                {rule.globs.map((g) => (
                  <span
                    key={g}
                    className="font-[JetBrains_Mono] text-xs text-neutral-300 border border-outline-variant/60 px-1.5 py-0.5"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Custom-only edit / delete */}
        {(onUpdate || onDelete) && (
          <div className="mt-3 pt-3 border-t border-outline-variant/60 flex items-center gap-3">
            {onUpdate && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="text-xs text-on-surface-muted hover:text-white"
                data-testid={`rule-edit-${rule.id}`}
              >
                {editing ? "close edit" : "edit"}
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm("delete this custom rule?")
                  ) {
                    return;
                  }
                  onDelete();
                }}
                data-testid={`rule-delete-${rule.id}`}
                className="text-xs text-violation/80 hover:text-violation"
              >
                delete
              </button>
            )}
          </div>
        )}

        {editing && onUpdate && (
          <CustomRuleEditor
            rule={rule}
            onUpdate={(patch) => {
              onUpdate(patch);
            }}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Editor ──────────────────── */

function CustomRuleEditor({
  rule,
  onUpdate,
  onClose,
}: {
  rule: Rule;
  onUpdate: (patch: {
    description?: string;
    body?: string;
    severity?: Severity;
    globs?: string[];
  }) => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(rule.description);
  const [body, setBody] = useState(rule.body ?? "");
  const [severity, setSeverity] = useState<Severity>(rule.severity ?? "medium");
  const [globs, setGlobs] = useState((rule.globs ?? []).join(", "));

  function commit() {
    onUpdate({
      description: description.trim(),
      body,
      severity,
      globs: globs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    onClose();
  }

  return (
    <div className="mt-3 pt-3 border-t border-outline-variant/60 space-y-3">
      <Field label="Description">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-testid={`rule-edit-description-${rule.id}`}
          className="w-full bg-surface border border-outline-variant px-2.5 py-1.5 text-sm text-white"
        />
      </Field>
      <Field label="Body (markdown)">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          data-testid={`rule-edit-body-${rule.id}`}
          className="w-full bg-surface border border-outline-variant px-2.5 py-1.5 font-[JetBrains_Mono] text-sm text-white leading-relaxed"
        />
      </Field>
      <div className="flex items-center gap-3">
        <Field label="Severity">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="bg-surface border border-outline-variant px-2 py-1 text-xs text-white"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field label="Globs (comma-separated)">
          <input
            value={globs}
            onChange={(e) => setGlobs(e.target.value)}
            placeholder="src/services/**, src/api/**"
            className="w-full bg-surface border border-outline-variant px-2 py-1 font-[JetBrains_Mono] text-xs text-white"
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={commit}
          className="text-xs text-schema-accent hover:text-white"
          data-testid={`rule-edit-save-${rule.id}`}
        >
          Save changes
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-on-surface-muted hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block flex-1">
      <span className="block mb-1 text-xs text-on-surface-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ────────────────── Empty state ────────────────── */

function EmptyState({ tab, hasRepo }: { tab: TabId; hasRepo: boolean }) {
  if (tab === "imported") {
    return (
      <div className="text-center py-8 px-4">
        <span className="material-symbols-outlined text-[24px] text-on-surface-faint leading-none mb-2 inline-block">
          file_present
        </span>
        <p className="text-sm text-neutral-300">
          No imported rules
        </p>
        <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
          {hasRepo
            ? "Drop a .cursor/rules/*.mdc, AGENTS.md, or rules/*.md file in the repo and click Re-import."
            : "Open a real repo (not the bundled fixture) to import rule files."}
        </p>
      </div>
    );
  }
  if (tab === "custom") {
    return (
      <div className="text-center py-8 px-4">
        <span className="material-symbols-outlined text-[24px] text-on-surface-faint leading-none mb-2 inline-block">
          edit_note
        </span>
        <p className="text-sm text-neutral-300">No custom rules yet</p>
        <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
          Click <span className="text-schema-accent">Add rule</span> above to write a prose rule the LLM will check against the graph.
        </p>
      </div>
    );
  }
  return (
    <div className="text-center py-8 px-4">
      <span className="material-symbols-outlined text-[24px] text-on-surface-faint leading-none mb-2 inline-block">
        gavel
      </span>
      <p className="text-sm text-neutral-300">No built-in rules</p>
      <p className="mt-2 text-xs text-on-surface-muted leading-relaxed">
        Built-ins ship with Schema; this list should never be empty unless something went very wrong.
      </p>
    </div>
  );
}

/* ─────────── Add modal ─────────── */

function AddCustomRuleModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    description: string;
    body: string;
    severity: Severity;
    evaluation: "display" | "llm";
    globs: string[];
  }) => void;
}) {
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [evaluation, setEvaluation] = useState<"display" | "llm">("llm");
  const [globs, setGlobs] = useState("");

  const canCreate = description.trim().length > 0 && body.trim().length > 0;

  function commit() {
    if (!canCreate) return;
    onCreate({
      description: description.trim(),
      body,
      severity,
      evaluation,
      globs: globs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="rules-add-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add custom rule"
        className="w-[520px] max-w-[92vw] max-h-[90vh] overflow-y-auto bg-surface border border-outline-variant shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-outline-variant flex items-baseline justify-between">
          <h3 className="text-base text-white">New custom rule</h3>
          <button
            onClick={onClose}
            className="text-on-surface-muted hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Rule headline">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
              placeholder="services should not import from /db/* directly"
              data-testid="rules-add-description"
              className="w-full bg-surface border border-outline-variant px-2.5 py-1.5 text-sm text-white"
            />
          </Field>
          <Field label="Rule body (markdown — what the LLM sees)">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={`## No direct DB access from services

Services in src/services/* must access the database only through data_access modules. Direct imports of files under src/db/* count as a violation.`}
              data-testid="rules-add-body"
              className="w-full bg-surface border border-outline-variant px-2.5 py-1.5 font-[JetBrains_Mono] text-sm text-white leading-relaxed"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Field label="Severity">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className="bg-surface border border-outline-variant px-2 py-1 text-xs text-white"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Field>
            <Field label="Evaluation">
              <select
                value={evaluation}
                onChange={(e) =>
                  setEvaluation(e.target.value as "display" | "llm")
                }
                className="bg-surface border border-outline-variant px-2 py-1 text-xs text-white"
              >
                <option value="llm">Enforce</option>
                <option value="display">Display only</option>
              </select>
            </Field>
            <Field label="Globs (comma-separated)">
              <input
                value={globs}
                onChange={(e) => setGlobs(e.target.value)}
                placeholder="src/services/**"
                className="w-full bg-surface border border-outline-variant px-2 py-1 font-[JetBrains_Mono] text-xs text-white"
              />
            </Field>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-outline-variant flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs text-on-surface-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={!canCreate}
            data-testid="rules-add-submit"
            className="text-xs text-schema-accent hover:text-white disabled:text-on-surface-faint disabled:cursor-not-allowed"
          >
            Create rule
          </button>
        </div>
      </div>
    </div>
  );
}

function tabLabel(id: TabId): string {
  if (id === "imported") return "Imported";
  if (id === "custom") return "Custom";
  return "Built-in";
}
