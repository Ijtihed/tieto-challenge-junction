---
id: "distsys-lease-based-coordination"
paradigm: distsys
title: "Leases, Fencing Tokens, and Avoiding Split-Brain"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/lease-based-coordination"
---

# Leases, Fencing Tokens, and Avoiding Split-Brain

A lease is a time-bounded lock: a node acquires exclusive ownership of a resource for a fixed duration and must renew before expiry or lose it. Leases solve the problem that permanent locks create when holders crash — no manual intervention or timeout heuristics needed. But leases introduce a more subtle failure mode: clock disagreement between the lease holder and the lease grantor.

## How Leases Work

A coordination service (ZooKeeper, etcd, Consul) grants a lease with a TTL. The holder periodically sends heartbeats to extend the lease. If the holder crashes or the network partitions, the heartbeats stop, the lease expires, and another node can acquire it. This is the foundation for leader election, distributed locks, and shard ownership assignment.

The critical assumption: the holder stops acting as the lease owner before the lease expires at the grantor. If the holder's clock is slow, it may believe the lease is still valid when the grantor has already expired it and granted it to someone else. Now two nodes believe they hold the lease simultaneously — split-brain.

## The Process Pause Problem

Even with perfectly synchronized clocks, a GC pause, VM live migration, or OS scheduling delay can cause a process to freeze for seconds after checking its lease. The holder checks the lease at T=0 (valid until T=10), gets paused until T=12, resumes, and proceeds to act on a lease that expired 2 seconds ago. The new lease holder started acting at T=10. For 2 seconds, two nodes are operating as the leader.

## Fencing Tokens

The solution is fencing tokens: every time a lease is granted, the coordination service issues a monotonically increasing token. The holder includes this token in every operation on the protected resource. The resource (database, storage system, message queue) rejects any operation with a token lower than the highest it has seen. When the old holder resumes after a pause and tries to write with token 33, the resource has already accepted writes from the new holder with token 34 and rejects the stale write.

Fencing tokens work because the safety check is at the resource, not the holder. It doesn't matter if the holder is confused about its lease status — the resource enforces the invariant. This requires the resource to support token-based rejection, which means it must be a resource you control or one that supports conditional writes (e.g., DynamoDB's conditional expressions, etcd's revision-based compare-and-swap).

## Practical Implementation

etcd leases are tied to a session. When the session expires, all keys associated with the lease are deleted. This is commonly used for ephemeral service registration: a service registers itself with a lease-bound key, and if it crashes, the key disappears, and other services stop routing to it.

ZooKeeper's ephemeral znodes provide the same semantic. The session timeout is the lease TTL. Crucially, ZooKeeper sessions can survive transient connection loss (the client reconnects within the session timeout), avoiding unnecessary lease revocations during network blips.

## Failure Scenario

A job scheduler uses an etcd lease for leader election. The leader acquires the lease (token 17), starts processing jobs, and enters a long GC pause. The lease expires. A standby acquires the lease (token 18) and starts processing. The original leader wakes up and submits a completed job result to the database. Without fencing: the database accepts the write, and downstream systems process the stale result, potentially causing duplicate charges. With fencing: the database rejects the write because it has already seen token 18, and the old leader detects it's no longer the leader and shuts down gracefully.

## Decision Criteria

Use leases for any resource that needs exclusive-but-recoverable ownership: leader election, shard assignment, cache stampede prevention. Always pair leases with fencing tokens when the protected operation has side effects. If your resource doesn't support fencing (e.g., a third-party API), you need an alternative approach — such as the work-stealing pattern where duplicate work is idempotent by design.
