---
id: "distsys-jepsen-methodology"
paradigm: distsys
title: "Jepsen Testing Methodology"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/jepsen-methodology"
---

# Jepsen Testing Methodology

Jepsen is a testing framework and methodology for verifying the safety guarantees of distributed systems under network partitions, process crashes, clock skew, and other real-world fault conditions. It has found correctness bugs in virtually every database it has tested, including systems that claimed strong consistency.

## Architecture

A Jepsen test has five components:

**Client.** Generates a workload: a sequence of operations (reads, writes, compare-and-swap) against the system under test. The client records every operation's invocation time, completion time, and result in a history.

**DB.** Manages the lifecycle of the system under test: installation, startup, teardown, and log collection. This layer abstracts away the specifics of deploying the database across Jepsen's test nodes (typically 5 VMs).

**Nemesis.** Injects faults during the test: network partitions (using iptables), process kills (SIGKILL, SIGSTOP), clock skew (via `faketime` or NTP manipulation), disk pauses (SIGSTOP on the storage process), and membership changes. The nemesis runs concurrently with the workload, creating the adversarial conditions that expose bugs.

**Checker.** After the test completes, the checker analyzes the recorded history to determine if the system maintained its claimed guarantees. This is where the formal verification happens.

**Generator.** Produces the interleaved schedule of client operations and nemesis actions. A typical generator runs clients at maximum throughput while cycling the nemesis (e.g., partition for 20s, heal for 20s, repeat).

## Consistency Models and Checkers

Jepsen's power comes from its model-based checking. The framework ships checkers for:

**Linearizability.** The strictest model: every operation appears to take effect atomically at some point between its invocation and completion. Jepsen uses the Knossos linearizability checker, which searches for a valid linearization of the history. This is NP-hard in general but tractable for the history sizes Jepsen produces.

**Serializability.** Transactions appear to execute in some serial order. Jepsen's Elle checker verifies this using a transaction graph analysis: it builds a dependency graph between transactions and checks for cycles that would violate serializability.

**Causal consistency, snapshot isolation, read committed.** Elle supports checking these weaker models by looking for specific anomalies: write skew (snapshot isolation violation), dirty reads (read committed violation), lost updates, and so on.

## What Jepsen Has Found

The pattern is remarkably consistent: systems that claim linearizability or serializability violate those claims under specific fault conditions. Highlights include:

Stale reads in MongoDB under network partitions (the primary reports success, a secondary is promoted, the client reads from the new primary which doesn't have the write). Data loss in Redis Sentinel during failover (async replication means the promoted replica is missing recent writes). Split-brain in Elasticsearch during network partitions (two nodes both believe they are the primary). Phantom reads in CockroachDB under specific partition+clock-skew combinations. These aren't obscure edge cases — they're the failure modes real users hit in production.

## Running Your Own Jepsen Tests

Custom Jepsen tests require: defining the workload (what operations to perform), implementing the DB layer for your system, choosing nemesis actions relevant to your deployment, and selecting the appropriate checker. The learning curve is significant (Jepsen is written in Clojure, and the consistency checkers require understanding the formal definitions of the models you're testing), but the framework handles the hard parts: scheduling, fault injection, and history analysis.

For teams that can't invest in full Jepsen testing, the methodology is still valuable: run your system on multiple nodes, inject network partitions and process kills during load, and verify that your safety invariants hold. Even ad-hoc chaos testing using `tc netem` for network delays and `kill -9` for process crashes catches bugs that unit tests never will.

## Failure Scenario

A team deploys a new distributed key-value store that claims linearizable reads and writes. Internal testing passes. A Jepsen test with network partition nemesis reveals: during a partition, a client writes value X to key K on the leader side. The partition heals. A client reads key K from a lagging replica and gets the old value. The system violated linearizability — the read didn't reflect a completed write. The root cause: the read path didn't verify that the serving replica was up-to-date with the committed log index.

## Decision Criteria

Run Jepsen tests (or Jepsen-methodology tests) before deploying any distributed database in a context where consistency matters. If a vendor claims linearizability, verify it under partition+crash+clock-skew. If the system has been Jepsen-tested publicly, read the report — the bugs found are your production incident list. For your own distributed systems, implement the methodology even if you don't use the Jepsen framework: adversarial fault injection + formal history checking is the only way to gain confidence in correctness guarantees.
