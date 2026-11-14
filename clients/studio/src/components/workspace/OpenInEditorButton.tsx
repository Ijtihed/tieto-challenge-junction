"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Open in editor" affordance for the inspector / source viewer.
 *
 * Default click → opens the file at the right line in **Cursor**
 * (`cursor://file/<absPath>:<line>`). Supports VS Code as well via a
 * tiny "open in" disclosure that appears next to the icon — Cursor
 * users can flip the preference once and the choice persists.
 *
 * Why two protocols:
 *   - The user requested Cursor as the primary target (this project
 *     IS schema, our user runs Cursor). Cursor's deep link spec is the
 *     same as VS Code's, scoped under `cursor://`.
 *   - VS Code's `vscode://` is the historical default; we leave it
 *     reachable via a one-click toggle so the same shipped bits work
 *     for users on other editors.
 *
 * Important: deep links work ONLY when the page is opened in a real
 * browser AND the OS has the relevant editor registered. We don't try
 * to detect that — we just emit the URL via `window.location.href`. If
 * the OS can't handle it the browser shows its native "open with"
 * prompt; nothing breaks.
 *
 * Encoding:
 *   - Cursor / VS Code accept `<scheme>://file/<absPath>:<line>` on
 *     macOS / Linux. On Windows the absolute path includes a drive
 *     letter — e.g. `C:/Users/me/repo/src/foo.ts` — and Cursor still
 *     parses that correctly when the colon between drive letter and
 *     path is preserved.
 *   - We do NOT URI-encode the path itself: editors expect raw paths
 *     with forward slashes. We DO normalise back-slashes → forward.
 */

type Editor = "cursor" | "vscode";

const STORAGE_KEY = "schema:editor_pref";

export default function OpenInEditorButton(props: {
  rootPath: string;
  file: string;
  line: number;
}) {
  const [editor, setEditor] = useState<Editor>("cursor");
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Restore preference on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "vscode" || v === "cursor") setEditor(v);
  }, []);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function persistEditor(next: Editor) {
    setEditor(next);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  function go() {
    if (typeof window === "undefined") return;
    const url = buildUri(editor, props.rootPath, props.file, props.line);
    // Use location.href rather than an <a target=...> click — the
    // protocol handler picks the page up and the browser doesn't
    // navigate away from /app.
    window.location.href = url;
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={go}
        data-testid="open-in-editor"
        data-editor={editor}
        title={`Open in ${editor === "cursor" ? "Cursor" : "VS Code"} (${editor}://) at line ${props.line}`}
        aria-label={`Open in ${editor}`}
        className="w-7 h-7 flex items-center justify-center overflow-hidden border border-outline-variant text-on-surface-faint hover:border-schema-accent hover:text-schema-accent transition-colors"
      >
        <span className="material-symbols-outlined text-[14px] leading-none">
          open_in_new
        </span>
      </button>
      {/* Tiny chevron strip below the icon — clicking flips the
          preferred editor. Hidden by default; the icon button does the
          everyday work. */}
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="open-in-editor-pref"
        title="Switch editor (Cursor / VS Code)"
        aria-label="Switch editor preference"
        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 flex items-center justify-center bg-surface border border-outline-variant text-on-surface-faint hover:text-schema-accent hover:border-schema-accent transition-colors"
      >
        <span className="material-symbols-outlined text-[8px] leading-none">
          expand_more
        </span>
      </button>
      {open && (
        <div
          data-testid="open-in-editor-popover"
          className="absolute right-0 top-full mt-1 z-30 w-[180px] border border-outline-variant bg-surface p-2 shadow-xl"
        >
          <p className="text-xs text-on-surface-muted mb-1.5 px-1">
            Open in
          </p>
          <EditorOption
            current={editor}
            value="cursor"
            label="Cursor"
            scheme="cursor://"
            onPick={() => {
              persistEditor("cursor");
              setOpen(false);
            }}
          />
          <EditorOption
            current={editor}
            value="vscode"
            label="VS Code"
            scheme="vscode://"
            onPick={() => {
              persistEditor("vscode");
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function EditorOption(props: {
  current: Editor;
  value: Editor;
  label: string;
  scheme: string;
  onPick: () => void;
}) {
  const active = props.current === props.value;
  return (
    <button
      onClick={props.onPick}
      data-testid={`open-in-editor-${props.value}`}
      data-active={active ? "true" : "false"}
      className={`
        w-full text-left px-2 py-1.5 flex items-center justify-between gap-2 transition-colors
        ${active ? "text-schema-accent" : "text-on-surface hover:text-white hover:bg-neutral-950"}
      `}
    >
      <span className="text-sm">{props.label}</span>
      <span className="font-[JetBrains_Mono] text-xs text-on-surface-faint">
        {props.scheme}
      </span>
    </button>
  );
}

/**
 * Build the `<scheme>://file/<absPath>:<line>` URL.
 *
 * Cursor / VS Code accept the same shape. Path is normalised to
 * forward slashes; `<rootPath>` and `<file>` are joined with a `/`.
 * No URI-encoding — editors expect raw paths.
 */
export function buildUri(
  editor: Editor,
  rootPath: string,
  file: string,
  line: number,
): string {
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const rel = file.replace(/\\/g, "/").replace(/^\//, "");
  // Editors prefer `/file//<abs>` on Windows when the abs path starts
  // with a drive letter — but the simpler `/file/<abs>` works too,
  // and is what the published spec recommends. We use the simpler form.
  return `${editor}://file/${root}/${rel}:${line}`;
}
