# Demo Script — Supercell AI Lab (3-minute loop)

## Demo Links

| URL | What it does |
|-----|-------------|
| `http://localhost:5173/?demo` | **Primary demo link** — auto-loads Supabase OSS graph, skips landing |
| `http://localhost:5173/demo.html` | Redirect page (same effect) |
| `http://localhost:5173` | Landing page (manual repo open / demo picker) |

**Example:** `supabase/supabase` — Apache-2.0 licensed OSS platform (Go + TypeScript + Rust + SQL)

---

## Pre-Flight Checklist

- [ ] ``cd clients/studio && npm run dev`` → Studio at http://localhost:5173
- [ ] Open **http://localhost:5173/?demo** — graph loads instantly
- [ ] Verify: 6 clusters visible (GoTrue Auth, TypeScript SDK, Realtime, Database, Edge Functions, PostgREST)
- [ ] Verify: Cross-language edges visible (amber REST contracts, green SQL contracts)
- [ ] MCP server running: `node --experimental-strip-types src/mcp/index.ts`
- [ ] Cursor open with Schema MCP configured (see `cursor-mcp-config.json`)
- [ ] Overlay slide ready: open `clients/landing/supercell.html` in a browser tab

---

## Beat 1 — Hook (0:00–0:25)

**Goal:** Immediate visual comprehension.

1. Browser shows `http://localhost:5173/?demo` — Supabase graph pre-loaded
2. 6 clusters clearly visible with cross-language edges
3. Hover the Go auth service → TypeScript SDK callers light up via REST contract edges

**Script:**
> "This is Supabase — an open-source platform with Go, TypeScript, Rust, and SQL. Your whole codebase as a graph your AI agent can query. It works inside Cursor and Claude Code through MCP."

## Beat 2 — Integration (0:25–0:45)

**Goal:** Zero workflow disruption.

1. Alt-tab to Cursor (Schema MCP already attached)
2. Briefly show MCP settings (1 second)
3. Back to Studio

**Script:**
> "Same Cursor you already use. Schema is just an MCP server — one line in your config."

## Beat 3 — Side-by-Side Refactor (0:45–2:00)

**Prompt (type in Studio's command bar):**
> "Move session token validation out of GoTrue auth into a dedicated authz service and update every caller."

The agent loop streams:
- `graph.search` → finds validateToken, related auth symbols
- `graph.find_callers` → reveals 4 internal callers + 2 cross-language consumers
- `graph.impact_score` → blast radius: 14 affected nodes
- `rules.evaluate` → 0 violations (if planned correctly)
- Plan steps appear one by one with live node highlighting

**Key visual moments:**
- Nodes light up as the agent discovers them
- Cross-language edges (amber REST, green SQL) show the blast radius spans Go → TS → Rust
- Metrics stream: "Blast radius: 14 nodes", "Total tokens: ~2,370"

**Contrast (narrate, don't show):**
> "Without Schema, this same refactor costs ~270k tokens and misses the Rust realtime caller. The agent sees 4 callers, not 6."

## Beat 4 — The Numbers (2:00–2:30)

Open `clients/landing/supercell.html` (second browser tab):

| Metric | Result |
|--------|--------|
| Token usage | **38× reduction** |
| Architectural violations | **0** vs 10 |
| First-pass success | **5/5** vs 1/5 |

## Beat 5 — Close (2:30–3:00)

**Script:**
> "Horizon 1 is where we plug in today — engineering. Horizons 2 and 3 — every agentic gameplay product your cohort ships — eventually needs a substrate that lets agents reason over the systems they live in. That's the bet. The same graph that helps an engineer refactor Go auth helps a gameplay agent reason over a persistent world."

Final screen — show:
- Install: `npm i -g @schema-ai/mcp`
- Website: schema.dev
- Whitepaper: `marketing/cpg-efficiency-thesis-2026-05.md`

---

## Fallback Plans

### If Studio fails to start:
```bash
cd clients/studio && npm run dev
# Then open http://localhost:5173/?demo
```

### If graph looks empty:
- Click "supabase/supabase" button on the landing page
- Or reload with `?demo` parameter

### If MCP connection fails:
- Demo using the fixture graph (bundled, no server needed)
- Agent loop still streams tool calls (local graph analysis)

### If Cursor crashes:
- Show pre-recorded footage (record before demo day)
- Studio works standalone for Beat 1 + Beat 3

### If audience asks technical questions:
- Architecture: `architecture/schema-v3.md` (3,000+ lines)
- Benchmark data: `benchmarks/architectural-refactor-results.md`
- CPG sidecar: `cpg/` (Fraunhofer-AISEC Code Property Graph, Kotlin)
- Whitepaper: `marketing/cpg-efficiency-thesis-2026-05.md`

---

## Key Phrases (memorize 3)

- **"Substrate, not context"** — Schema is infrastructure, not a tool
- **"38× fewer tokens, zero structural bugs"** — concrete proof
- **"Code is a graph, not text"** — the intellectual bet
- **"O(1) for what used to cost O(N)"** — the mechanism
- **"Your tools, our rails"** — integration positioning

---

## Quick Start (for setup from scratch)

```bash
# 1. Start Studio
cd clients/studio && npm run dev

# 2. Open demo
open http://localhost:5173/?demo

# 3. (Optional) Start MCP server for live Cursor integration
cd ../.. && node --experimental-strip-types src/mcp/index.ts

# 4. Open overlay slide in another tab
open clients/landing/supercell.html
```
