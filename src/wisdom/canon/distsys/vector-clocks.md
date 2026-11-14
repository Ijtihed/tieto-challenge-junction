---
id: "distsys-vector-clocks"
paradigm: distsys
title: "Vector Clocks, Causal Ordering, and Lamport Timestamps"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/vector-clocks"
---

# Vector Clocks, Causal Ordering, and Lamport Timestamps

Physical clocks in distributed systems drift, arrive out of order, and lie. Logical clocks solve the ordering problem without depending on synchronized wall time.

## Lamport Timestamps

A Lamport timestamp is a single monotonically increasing counter per process. On every local event, increment the counter. On send, attach the counter. On receive, set local counter to `max(local, received) + 1`. This gives you a total order consistent with causality: if event A happened before event B, then `L(A) < L(B)`. The converse is not true — `L(A) < L(B)` does not mean A caused B. You get ordering, not causality detection.

Lamport timestamps are sufficient when you need a tiebreaker (e.g., last-write-wins registers) but dangerous when you need to detect conflicts. Two concurrent writes will have different Lamport timestamps, and the system will silently pick one without knowing they conflicted.

## Vector Clocks

A vector clock is an array of counters, one per node. Node `i` increments `VC[i]` on every local event. On send, the full vector is attached. On receive, the receiver takes the element-wise max of its vector and the received vector, then increments its own entry. Two vector clocks `A` and `B` are comparable if every element of `A` is ≤ the corresponding element of `B` (or vice versa). If neither dominates, the events are concurrent — this is the critical capability Lamport timestamps lack.

Dynamo-style systems use vector clocks to detect write conflicts. When a client reads a key and gets two versions with incomparable vector clocks, the system returns both and forces the application to merge. Amazon's shopping cart famously uses this: concurrent adds to a cart produce a union rather than a silent discard.

## Practical Problems

Vector clocks grow linearly with the number of nodes that have written to a key. In a system with thousands of clients, this is untenable. Solutions include: pruning old entries (Dynamo does this, at the cost of false conflicts), dotted version vectors (which reduce metadata by tracking individual events rather than node-level counters), and interval tree clocks for dynamic process sets.

## When to Use What

Use Lamport timestamps when you need a global total order and don't care about detecting concurrency — log sequencing, event stream ordering, database WAL entries. Use vector clocks when your application must detect and resolve concurrent writes — multi-leader replication, collaborative editing, distributed caches with conflict resolution.

## Failure Scenario

A three-node system uses vector clocks for a replicated counter. Node A and Node B both increment concurrently during a partition. Their vector clocks are `[2,1,0]` and `[1,2,0]` — incomparable. The correct merge is to recognize concurrency and sum both increments. A system using Lamport timestamps would silently pick one, losing an increment permanently. This is why counters in eventually-consistent systems use CRDTs (specifically G-Counters) rather than raw vector-clocked values.

Logical clocks are infrastructure, not application logic. Choose the weakest clock that gives your application the ordering guarantees it needs, and push conflict resolution to the layer that understands the domain semantics.
