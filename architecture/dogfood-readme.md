# Step 11 dogfood — day-1 checklist (founder)

> **What this is.** The Step 11 plan (`architecture/v1-launch-plan.md`)
> calls for the founder to use Schema as their daily-driver
> on a real work repo for 2 weeks, then answer the Sean Ellis
> PMF question. Per Q15 (founder-alone) + Q13 (founder
> 2-week dogfood), no external recruiting.
>
> Step 11a (the infrastructure layer) is **done** — the
> dogfood kit below exists. This document is the literal
> checklist the founder follows to run the human session.

---

## Pre-flight (Day 0, ~10 minutes)

Run **once** before starting the 2-week clock. Catches any
blocking bugs that would otherwise burn dogfood time.

```bash
cd /Users/ijtihed/schemav3
# 1. Pick the real work repo. The plan says
#    "founder's current largest active codebase".
export DOGFOOD_REPO=/path/to/your/real/repo

# 2. Run the pre-flight smoke harness.
npx tsx src/cli/index.ts dogfood:smoke "$DOGFOOD_REPO"
```

**Pass criterion (Day 0)**: every step in the smoke report
returns `✓` (status = OK). If any step fails, file the bug
in `~/dogfood-failure-log.md` (severity `blocking`) + fix or
defer before starting Day 1.

---

## Day 1 setup (~5 minutes)

```bash
# 1. Initialize the failure log at the canonical location.
npx tsx src/cli/index.ts dogfood:init-failure-log
# → creates ~/dogfood-failure-log.md with the 3-section
#   template (blocking / wishlist / known).

# 2. Confirm the event log directory exists (Schema writes
#    here automatically; events.jsonl is created on first use).
ls ~/.schema/ || mkdir -p ~/.schema
```

---

## Daily-driver flow (2 weeks)

Use Schema like you mean it. Per the Step 11 plan:

- **Every morning**: open Studio + look at the atlas
  ```bash
  cd /Users/ijtihed/schemav3/clients/studio && npm run dev
  ```
- **Every codebase question**: use `graph.ask` from Cursor /
  Claude Code (Step 8b ships this; until then `graph.search`
  is the closest analog)
- **Every PR you open**: run `schema pr-review <path>` +
  paste the markdown into the PR body
- **Every Monday**: run `npx tsx src/cli/index.ts dogfood:summary`
  to check the usage gate progress

**Log failures as they happen.** Open
`~/dogfood-failure-log.md`, add a new entry under the right
section. Triage on the spot:
- `blocking`: stops daily-driver use right now
- `wishlist`: nice-to-have, defer to v1.1
- `known`: tracked elsewhere; just cross-reference

---

## Day 14 verdict (~10 minutes)

```bash
# 1. Usage summary — must show ≥ 50 events + ≥ 5 distinct kinds.
npx tsx src/cli/index.ts dogfood:summary

# 2. Sean Ellis question — answer honestly.
#    Q: "How would you feel if you could no longer use Schema?"
#    V = Very disappointed, S = Somewhat, N = Not.
npx tsx src/cli/index.ts dogfood:survey V "optional note"

# 3. Audit the failure log. Should be empty in the `blocking`
#    section. Wishlist items are fine (deferred to v1.1).
cat ~/dogfood-failure-log.md
```

**Pass criterion (Day 14):**

1. **Usage gate**: `dogfood:summary` exit code = 0 (≥ 50
   events + ≥ 5 distinct kinds over 14 days).
2. **PMF gate**: `dogfood:survey V` was the honest answer.
3. **Failure-log gate**: 0 blocking entries.

All 3 → Step 11 passes → v1.0 is locally complete. Founder
flips the launch switch when ready (commerce + public launch
+ publishing are separate efforts per Q8/Q9/Q12/Q14).

**If any gate fails:** iterate per the plan. Fix the top 3
items from the failure log, run another 2-week cycle (`cycle: 2`
in the survey), repeat. The plan budgets 2-3 cycles before
v1.0 is declared.

---

## Reference: what the kit measures

| Kit piece | Purpose | Output |
|---|---|---|
| `dogfood:summary` | Read `~/.schema/events.jsonl` + summarise by day / kind | Usage gate verdict (markdown + exit code) |
| `dogfood:survey` | Record + persist Sean Ellis answer | PMF gate verdict (markdown + exit code) |
| `dogfood:init-failure-log` | Create the 3-section template | `~/dogfood-failure-log.md` |
| `dogfood:smoke` | Run the daily-driver flow E2E on a repo | Smoke gate verdict (8-step markdown table) |

All four kit pieces are tested by `src/__tests__/dogfood.test.ts`.

---

## Reference: events the dispatcher emits

Per `src/obs/event-log.ts` + `src/mcp/dispatcher.ts`, the
following events are written to `~/.schema/events.jsonl`
automatically on every relevant MCP action:

| Event kind | Trigger |
|---|---|
| `workspace.opened` | `workspace.open` action |
| `rules.evaluated` | `rules.evaluate` action |
| `pr.reviewed` | `pr.review` action |
| `plan.proposed` | `plan.propose` action |
| `plan.applied` | `plan.apply` action |
| `plan.cancelled` | `plan.cancel` action |
| `plan.restored` | `plan.restore` action |

The Step 11 usage gate requires **≥ 5 distinct event kinds**
over 14 days. The 7 above suffice; daily-driver use will
naturally produce ≥ 4-5 of them.
