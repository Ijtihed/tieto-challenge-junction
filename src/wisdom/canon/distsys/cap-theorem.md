---
id: "distsys-cap-theorem"
paradigm: distsys
title: "CAP Theorem and Practical Implications"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/cap-theorem"
---

# CAP Theorem and Practical Implications

The CAP theorem states that a distributed data store cannot simultaneously provide more than two of three guarantees: Consistency (every read returns the most recent write), Availability (every request receives a non-error response), and Partition tolerance (the system continues operating despite network partitions). Since network partitions are inevitable in any distributed system, the real engineering choice is between CP (consistency + partition tolerance) and AP (availability + partition tolerance) behaviour during a partition event.

## CP Systems

A CP system refuses to serve reads or writes on the minority side of a partition to avoid returning stale data. ZooKeeper, etcd, and CockroachDB are canonical examples. When a partition occurs, nodes that cannot reach a quorum will reject client requests. This is the right choice for coordination state: lock services, leader election, configuration stores, and anything where a stale read causes a correctness violation. The cost is latency spikes and unavailability windows proportional to partition duration plus leader election time.

## AP Systems

An AP system continues accepting reads and writes on both sides of a partition, accepting that replicas will diverge. Cassandra, DynamoDB, and Riak operate this way by default. After the partition heals, the system must reconcile divergent state — typically via last-write-wins, vector clocks, or CRDTs. This is appropriate for shopping carts, user activity feeds, metrics ingestion, and any workload where temporary inconsistency is preferable to downtime.

## Tunable Consistency

Most production systems don't make a binary CP/AP choice. Cassandra's consistency levels (ONE, QUORUM, ALL) let you tune per-query. A read at QUORUM plus a write at QUORUM on a replication factor of 3 gives you linearizable-like semantics at the cost of higher latency. DynamoDB offers both eventually consistent and strongly consistent reads. The real design question is: which operations in your system require strong consistency, and which can tolerate staleness?

## Decision Criteria

Choose CP when: incorrect data causes money loss, safety violations, or irrecoverable state corruption. Choose AP when: the system must remain responsive under partition, and the business logic can tolerate or merge divergent writes. Most real systems are a mix — strong consistency for the billing path, eventual consistency for the recommendation feed.

## Common Failure Scenario

A three-node etcd cluster loses its leader during a network partition. The two-node majority elects a new leader and continues serving requests. The isolated node rejects all writes. If a client is connected only to the isolated node and doesn't implement retry-to-another-node logic, it experiences total unavailability despite the cluster being healthy. The fix: client-side retry with endpoint rotation, and health-checking that detects a node's inability to reach quorum.

Brewer's original conjecture was formalized by Gilbert and Lynch, but the practical takeaway hasn't changed: understand your partition behaviour before it happens, instrument it, and make the CP/AP tradeoff explicit per data path rather than per system.
