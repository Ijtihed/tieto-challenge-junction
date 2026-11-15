# Concept card: the change arrives with a receipt

## Recommendation

Stop asking a human to read every line of an agent-written PR. Instead, the PR arrives with an **evidence receipt**, and the human checks the receipt.

The receipt is produced by deterministic engines first (a Roslyn AST diff, a call graph, git, a policy file) and a language model second. It contains:

1. **The story**: what changed, in members, not lines.
2. **Claims**: each one is a statement that is either verified, partially verified, contradicted or unverified. It names the engine that decided it and the evidence it used.
3. **Refusals**: questions the engine will not answer because they are about intent, not code. They go to the owner, who answers them in writing.
4. **A review tier**: light, focused or full read. The tier comes from a risk score that is a sum of named, clickable facts.
5. **A read list**: the exact members the owner has to read, and why. "Owner reads 14 of 228 changed lines."
6. **What was not checked, and why.**

A named owner signs. The sign-off records what was checked and by whom or what, what was not checked, the answers to the refusals, and the residual risk accepted. The engine cannot sign, and cannot accept a change while a refusal is unanswered.

## Principles

| Tension | How the receipt balances it |
|---|---|
| **Risk** | Review depth follows a risk score built only from facts a person can check: public API changed, wire-format files touched, fan-in, untested members, silencing code, scope creep. No opaque score. |
| **Hallucination** | Claims come from the AST, the graph and git, which cannot hallucinate. A model may write the story, but it cannot add a claim without evidence the engines can verify. |
| **Transparency** | Every claim shows its evidence and the engine that decided it. Every risk point opens to its evidence. |
| **Confidence** | Replaced by status. "Verified" means evidence exists; "heuristic" means a weak signal; "unverified" means nobody checked. The engine never reports a percentage. |
| **Quality** | Tests must reach the changed code (static call path shown), and can be run from the receipt. Tests that reach code but do not pin it are a known gap (see failure modes). |
| **Accountability** | A named human signs. Refused questions block acceptance until answered. Every action is in an append-only decision log. |
| **Earned trust** | Each area keeps a track record. Clean sign-offs earn a lighter tier; one escape withdraws it until re-earned. |

## Trade-offs

- **Deterministic first, model second.** We give up some of the model's breadth (it could spot more design problems) in exchange for claims that cannot be invented. A model can add *questions*, never *verdicts*.
- **Static reachability, not execution coverage.** It is fast (about 11 s for 681 files) and explainable, but a path from a test to a member does not prove the test asserts its behaviour.
- **Policy is per-repo data.** `policy.json` names the areas that matter for MessagePack (wire format, public attributes, generator templates). Another repo needs its own, written by people who know it.
- **Refusals cost the owner time.** That is the point: intent questions are exactly where an unowned merge goes wrong.

## Limits

- C# only in this reference (Schema's other extractors cover TypeScript, Python, Go, Java/Kotlin, Ruby, Rust and C, but the review engine was built against the Roslyn output).
- The silencing check is a pattern list. It found the #2283 problem because the agent described it in a comment; silent narrowing with no telltale words would pass.
- Requirement-to-test tracing is word overlap and is always labelled "heuristic".
- No performance, NativeAOT or trimming checks.
- The static graph does not see reflection or code generated at build time.

## Technology considerations

| Layer | Choice | Why |
|---|---|---|
| Frontend | Schema Studio (React, react-flow): the repo as a map of 50 components in 12 modules; the agent's work streams into the plan panel and lights up the map; a live page per PR | A reviewer sees *where* a change lands and what it touches before reading any code. |
| Backend | Schema MCP server + a Roslyn sidecar for C# (symbol graph, member-level AST diff), git, `dotnet test` | Every claim is decided by a deterministic engine that can be re-run; the model only writes the story and asks questions. |
| Agent | Claude Code headless in an isolated git worktree, limited tool allow-list, no push/PR/sign rights | The agent can change code but cannot ship it or approve it. |
| CI | Pluggable provider. CRACI runners by default (`runs-on: craci`, `junction/ci/schema-ci.yml`): build, the tests the change reaches, and a known-vulnerable package scan; CRACI adds runner-level egress policy and continuous CVE monitoring. `SCHEMA_CI=local` runs build, tests, a CycloneDX SBOM and the scan in the agent's worktree | A failing build goes back to the same agent session for one fix-up turn, then the result is evidence on the receipt. Security-area changes cannot be accepted without a green build. |
| Trackers | Issues arrive through tracker connectors (Linear, Jira over MCP; demo data in this reference) | The requirement ID travels from ticket to commit trailer to receipt to sign-off. |

### Security

- **Agent sandbox.** Each run gets its own worktree; the agent can only read, edit and run `dotnet build/test` and read-only git. Committing, pushing and opening the PR are done by the harness, not the model.
- **Prompt injection.** Issue text is untrusted input to the agent. It is passed inside an `<issue>` block, and nothing the agent writes can approve a change: refusals and the named sign-off still gate acceptance.
- **Security-sensitive code.** The policy marks MessagePack's typeless deserialization, `MessagePackSecurity` and dynamic code emission as their own risk area (weight 4), so any touch there raises the review tier.
- **Traceability.** Commits carry `Requirement:` and `Agent-Run:` trailers; the PR body carries a SHA-256 of the receipt; `pr.verify` checks the PR head and body still match what was reviewed.
- **Credentials.** The agent runs on the developer's own Claude login; GitHub access is the developer's `gh` session against a private copy. No secrets are written to the repo or the receipt.

## Who owns the decision?

The named engineer on the sign-off. The engine is an advisor that shows its evidence; `github.review` posts it as a comment and never approves.

## How it scales

The expensive parts are cached per commit (graph, AST diff). Human attention is spent only on the read list: on the four sample changes, the owner reads 14 of 228, 59 of 266, 35 of 1,392 and 643 of 1,043 changed lines. The last one is a new public feature, and the receipt sends it to a full read on purpose.
