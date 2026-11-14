# Jepsen Fault-class Reasoning

Reason about distributed system correctness under network partitions, clock skew, and process failures.

## When to use

- Designing or reviewing a distributed system's consistency guarantees
- Choosing between consistency levels (linearizable, serializable, causal, eventual)
- Evaluating whether a distributed database or queue actually delivers what it claims
- Debugging anomalies in production that look like "impossible" states (stale reads, lost writes, phantom duplicates)

## Steps

1. **Name the consistency model.** Before testing, state what the system claims. Linearizability? Sequential consistency? Read-your-writes? If the team can't name it, the system doesn't have one — it has whatever the default driver settings produce, which is usually "eventual with surprises."

2. **Enumerate the fault classes.** Jepsen tests against specific fault injections. Reason about each:
   - **Network partitions (symmetric).** Two halves can't communicate. Does the system preserve consistency or availability? If it claims both, it's wrong (CAP theorem).
   - **Network partitions (asymmetric).** A can reach B but B can't reach A. More subtle than symmetric — many consensus protocols assume symmetric reachability.
   - **Clock skew.** Nodes disagree on the current time. Systems using timestamps for ordering (e.g., last-write-wins) will produce anomalies. How much skew before the system misbehaves?
   - **Process pauses (GC, swap, CPU starvation).** A node stops responding for 30 seconds, then resumes with stale state. Does the system treat it as dead and fence it, or does it accept stale writes?
   - **Crash-recovery.** A node crashes mid-write and restarts. Is the partially written data visible? Is it rolled back? Is it in a corrupt state that poisons future reads?

3. **Identify the operations under test.** Pick the operations that matter: writes, conditional writes (CAS), reads, range scans. For each operation, define the correctness criterion. A linearizable register means every read returns the value of the most recent write — define "most recent" precisely.

4. **Check for known anomalies.** Jepsen has published tests for most major databases. Before running your own, check whether your system + version + configuration has already been tested. Many "fixed in 3.2" bugs reappear in 3.4.

5. **Reason about the happy path last.** Most systems work fine without faults. The question is always "what happens when" — when the leader partitions, when the clock jumps, when a follower pauses during replication. Design for the failure case, then confirm the happy path still works.

## Anti-patterns

- Testing only the happy path and assuming consistency holds under faults
- Claiming linearizability while using timestamps for conflict resolution (timestamps + clock skew = lost writes)
- Assuming the database handles it (many databases default to weaker consistency than users expect)
- Conflating network timeouts with node failures (a slow node is not a dead node — prematurely fencing it causes split-brain)

## Example

A team deploys a 3-node distributed KV store claiming "strong consistency." Under Jepsen-style reasoning: a symmetric partition isolating node C means nodes A and B form a majority and can continue serving writes. But the client library has a "read from nearest replica" setting enabled by default — reads from C during the partition return stale data. The system is linearizable for writes but eventual for reads. The fix: configure reads to go through the consensus leader, accepting higher read latency in exchange for consistency. The team documents the trade-off and adds a monitoring alert for read staleness exceeding 500ms.
