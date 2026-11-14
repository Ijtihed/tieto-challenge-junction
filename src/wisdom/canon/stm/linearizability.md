---
id: "stm-linearizability"
paradigm: stm
title: "Linearizability and Consistency Model Hierarchy"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/linearizability"
---

# Linearizability, Serializability, and Consistency Model Hierarchy

These terms are precise and frequently confused. Linearizability is a single-object, real-time ordering guarantee. Serializability is a multi-object, transaction-ordering guarantee. They operate at different levels and answer different questions.

## Linearizability

A system is linearizable if every operation appears to take effect atomically at some point between its invocation and completion ("the linearization point"). For any concurrent execution, there exists a total order of operations consistent with both the sequential specification and the real-time ordering of non-overlapping operations.

Concretely: if client A's write completes before client B's read begins (wall-clock time), B must see A's write. This is the strongest single-object consistency guarantee.

```
Timeline:
A: |--- write(x=1) ---|
B:                        |--- read(x) ---| must return 1
```

CAS operations, atomic registers, and consensus protocols (Raft, Paxos) provide linearizability. It is expensive — it requires coordination between replicas on every operation.

## Sequential Consistency

Weaker than linearizability: operations appear in some total order consistent with each thread's program order, but not necessarily with real time. Two clients may disagree on the order of concurrent operations, as long as each client's own operations appear in program order.

x86-TSO (Total Store Order) provides sequential consistency for most practical purposes — stores become visible in program order, but a CPU may read its own store before it becomes visible to others (store-buffer forwarding).

## Serializability

A property of transaction schedules, not individual operations. A schedule is serializable if its outcome is equivalent to *some* serial execution of the same transactions. The serial order need not correspond to real time — transactions that committed at 3pm may logically precede transactions that committed at 2pm.

```
T1: read(A), write(B)
T2: read(B), write(A)

Serializable if equivalent to either T1→T2 or T2→T1.
Not serializable if the result matches neither serial order.
```

This is the "I" in ACID (isolation), at its strongest level. Most databases default to weaker isolation (READ COMMITTED, REPEATABLE READ) for performance.

## Strict Serializability

The combination: transactions appear to execute in some serial order that is consistent with real time. If transaction T1 commits before T2 starts, T1 precedes T2 in the serial order. This is what Google Spanner provides via TrueTime, and what CockroachDB approximates with hybrid-logical clocks.

Strict serializability = serializability + linearizability of transaction commit points.

## The Hierarchy

From weakest to strongest:

1. **Eventual consistency** — all replicas converge eventually, no ordering guarantees
2. **Causal consistency** — operations causally related are seen in order; concurrent operations may differ
3. **Sequential consistency** — total order respecting program order, not real time
4. **Linearizability** — total order respecting real time (single-object)
5. **Serializability** — equivalent to some serial schedule (multi-object)
6. **Strict serializability** — serializable + real-time ordering of commits

## STM and the Hierarchy

STM typically provides serializability within a single process — committed transactions are equivalent to some serial order. Clojure's STM with snapshot isolation provides a weaker guarantee (snapshot isolation allows write skew, as discussed in the MVCC doc). Haskell's STM provides serializability: the runtime validates the entire read set at commit, preventing all anomalies including write skew.

Neither provides linearizability across processes. Distributed STM has been researched but never deployed at scale — the coordination cost between nodes on every transaction commit negates STM's performance advantage over explicit distributed transactions.

## Practical Implications

The consistency model determines what anomalies your system can exhibit. If you're debugging a concurrency issue, the first question is "what consistency model does this layer provide?" The second is "what anomalies does that model permit?" If the observed bug is a permitted anomaly, the fix is a stronger isolation level or an application-level invariant check, not a code-level bug fix.
