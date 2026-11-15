> **AI review is advice with evidence. It does not approve this PR.** A named owner signs off below.

### 🗺️ [Open the live review page](http://localhost:5175/pr/73efb27c)
Repo graph before and after this change, the agent's path through the code step by step, its decisions, and the evidence. Updates automatically when new commits land.

**REQ-2283** · Generator and analyzer must not crash on closed generic value types from referenced assemblies · [issue](https://github.com/MessagePack-CSharp/MessagePack-CSharp/issues/2283)

### Verdict: Light check (risk score 1)
Owner reads **4 of 43** changed lines. Owner skims the receipt and spot-checks one item.

### What the change does
- REQ-2283 (bug): Generator and analyzer must not crash on closed generic value types from referenced assemblies.
- The agent changed 1 member(s) across 1 type(s) (TypeCollector) and added 1 test(s).
- 2 files changed: 1 source, 1 test.
- Risk score 1 → Light check. Owner reads 4 of 43 changed lines.

### What the agent did and decided
Claude Code 2.1.325 · claude-sonnet-5-5 · 43 turns · 68 recorded steps · run `REQ-2283-20261114-193338`

Replaced two unguarded DeclaringSyntaxReferences[0] accesses in TypeCollector.GetObjectInfo with null-safe FirstOrDefault lookups so metadata-only members no longer throw IndexOutOfRangeException. Added an analyzer test that emits the library to a PE image (a project reference keeps source syntax and does not reproduce the crash); it fails with AD0001 without the fix and passes with it. Generator-side behaviour and resolver emission were not tested directly.

| Decision | Why | Confidence |
|---|---|---|
| Use FirstOrDefault()?.GetSyntax().GetLocation() for the MemberNeedsKey diagnostic location | Metadata members have no syntax; a null Location is valid for Diagnostic.Create and matches neighbouring helpers | sure |
| Also made the BothStringAndIntKeyAreNull location null-safe (as-cast + FirstOrDefault) | Same [0] pattern plus a hard cast, reachable for metadata symbols; the requirement asks for no crash on this input | ⚠️ unsure |
| Test emits the library to a PE image and adds it as a MetadataReference | AdditionalProjects yields compilation references that keep source syntax, so the bug did not reproduce | sure |

### Claims
| | Claim | Decided by |
|---|---|---|
| ✅ verified | Every changed file is inside the expected scope of REQ-2283. | requirement |
| ✅ verified | No public API is added, removed or changed. | roslyn-ast |
| ✅ verified | Every changed member is reached by at least one test in the call graph. | schema-graph |
| ✅ verified | The change adds tests for its own behaviour. | roslyn-ast |
| ✅ verified | No added code drops, suppresses or swallows anything. | policy |
| 🟡 heuristic | Requirement: "MessagePackGenerator does not throw IndexOutOfRangeException for closed generic value types from metadata" has a matching test. | requirement |
| 🟡 heuristic | Requirement: "MsgPack00xMessagePackAnalyzer does not throw for the same input" has a matching test. | requirement |
| ⚪ unverified | Requirement: "A GeneratedMessagePackResolver is emitted for the consuming assembly" has a matching test. | requirement |
| ⚪ unverified | The tests that reach this change pass. | test-run |
| ✅ verified | CI build and tests pass (local). | test-run |
| ✅ verified | The change introduces no known-vulnerable packages. | test-run |

### Refused to decide (owner must answer)
- **Does the change satisfy "A GeneratedMessagePackResolver is emitted for the consuming assembly"?**  
  No test can be traced to this requirement line. The engine will not infer it from code alone.
- **The agent was unsure: Also made the BothStringAndIntKeyAreNull location null-safe (as-cast + FirstOrDefault). Is that acceptable?**  
  Self-reported by the agent: Same [0] pattern plus a hard cast, reachable for metadata symbols; the requirement asks for no crash on this input
- **Should a generator test confirm GeneratedMessagePackResolver is emitted for the consuming assembly?**  
  The agent left this for a human.
- **Should a diagnostic with a null location be reported for metadata types, or suppressed?**  
  The agent left this for a human.
- **The remaining test suite was not run; a full run is needed to confirm no regressions for source-declared types.**  
  The agent left this for a human.

### Read these
- `TypeCollector.GetObjectInfo` (spot check (light tier))

<details><summary>Risk factors</summary>

- +1 Touches Analyzer and generator logic

</details>

<details><summary>Not checked</summary>

- **Test execution**: No test run recorded for this commit.
- **Network egress during the build**: Local runner does not restrict network egress; CRACI enforces an egress policy at the runner.
- **Performance**: No benchmark is run; MessagePack has BenchmarkDotNet suites, but not in the review loop.
- **Behaviour in trimmed / NativeAOT apps**: Requires a publish + run outside this engine.
- **Call edges through reflection or generated code not in the repo**: The static graph only sees source; name-resolved edges are marked lower confidence.
- **Does the change satisfy "A GeneratedMessagePackResolver is emitted for the consuming assembly"?**: Refused by the engine: No test can be traced to this requirement line. The engine will not infer it from code alone.

</details>

---
receipt `REQ-2283@b4fcd4a7` · base `32258fdb` · head `b4fcd4a78916e1f2d24c413444e5aabb9e26d5df` · engine earned-trust/0.1
receipt-sha256: `45647cd89c5d3d7be6fd65f70e6d5c95960a190743327fad5a0432ab4039b163`