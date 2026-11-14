# Schema Demo Video Script (2 minutes)

**Target:** Staff+ engineer evaluating Schema for the first time.
**Format:** Screen recording with voiceover, no face cam.
**Resolution:** 1920x1080, dark theme.

---

## Scene 1: The problem (0:00 - 0:15)

**Screen:** VS Code with a 200-file polyglot repo open. Claude Code sidebar visible.

**Voiceover:**
"You're a senior engineer. An AI agent just proposed a 47-file refactor across Python and Go. Do you trust it? How do you even check what it did?"

## Scene 2: Install Schema (0:15 - 0:25)

**Screen:** Terminal.

```
npm install -g @schema-ai/mcp
```

**Voiceover:**
"One install. Schema extracts an architecture graph from any codebase — files, functions, routes, services, contracts, and every edge between them."

## Scene 3: Open in Schema Studio (0:25 - 0:50)

**Screen:** Schema Studio opens. Graph renders showing Python services, Go handlers, gRPC bridges.

**Voiceover:**
"This is Schema Studio. Every node is a real code element. Every edge is a real dependency. The gRPC bridge between the Python order service and the Go payment handler? Schema found that automatically."

**Action:** Click a node. Inspector shows callers, callees, file path. Click "Open in Editor" — Monaco opens the source.

## Scene 4: Claude Code + Schema (0:50 - 1:20)

**Screen:** Claude Code conversation.

**Prompt:** "Refactor the UserService to extract the auth logic into middleware. Use Schema to check the impact first."

**Claude Code response:** Calls `graph.find_callers`, shows 12 callers. Calls `ops.preview addMiddleware`, shows the diff. Calls `rules.evaluate` — no violations.

**Voiceover:**
"With Schema, Claude Code sees the graph before it writes code. It knows who calls what, it previews the structural diff, and it checks your team's rules — all before a single file changes."

## Scene 5: The diff (1:20 - 1:40)

**Screen:** Schema Studio, diff visualizer.

**Action:** Run diff against `main`. Green nodes (added), amber (modified). Per-file change list with rule-delta indicators.

**Voiceover:**
"After the refactor, you see exactly what changed architecturally. Not just the lines of code — the structural impact. Two new edges, one middleware node, zero rule violations."

## Scene 6: Close (1:40 - 2:00)

**Screen:** Split screen — Schema Studio graph on left, Claude Code on right.

**Voiceover:**
"Schema is the trust layer for vibe coding. The AI writes the code. You verify the architecture. One install, every language, zero configuration."

**Text overlay:** `schema.dev` — "Trust your AI coding agent."

---

**Post-production notes:**
- Background music: lo-fi/ambient, very low volume
- Transitions: simple cuts, no fancy effects
- Caption all terminal commands
- End card: GitHub link + install command
