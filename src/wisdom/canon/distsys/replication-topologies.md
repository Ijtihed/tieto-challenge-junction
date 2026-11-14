---
id: "distsys-replication-topologies"
paradigm: distsys
title: "Replication Topologies"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/replication-topologies"
---

# Replication Topologies

Replication copies data across multiple nodes for durability, availability, and read scaling. The topology — how replicas are organized and how writes propagate — determines consistency guarantees, write latency, failure behavior, and conflict resolution requirements.

## Leader-Follower (Single-Leader)

One node is the leader; all writes go to the leader. The leader replicates writes to followers via a replication log (WAL streaming in PostgreSQL, binlog in MySQL). Followers serve read-only queries.

**Synchronous replication.** The leader waits for at least one follower to acknowledge before confirming the write to the client. Guarantees that the acknowledged follower has the data (no data loss on leader failure), but adds write latency equal to the round-trip to the follower.

**Asynchronous replication.** The leader confirms the write immediately and replicates in the background. Lower write latency, but the follower may lag. If the leader crashes before replication, those writes are lost. PostgreSQL's `synchronous_commit = off` and MySQL's default async replication operate this way.

**Semi-synchronous.** Wait for one follower (not all) to confirm. MySQL's semi-synchronous replication and PostgreSQL's `synchronous_standby_names` provide this. It's the practical default for production databases that need durability without paying for full synchronous replication.

The leader is a single point of failure for writes. Failover requires detecting leader failure, promoting a follower, and redirecting clients. Automated failover (Patroni for PostgreSQL, orchestrator for MySQL) handles this but introduces a brief write outage during the election.

## Multi-Leader

Multiple nodes accept writes. Each leader replicates to all others. This reduces write latency for geographically distributed clients (write to the nearest leader) and eliminates the single-leader write bottleneck.

The cost: write conflicts. If two leaders accept concurrent writes to the same row, the writes conflict when replicated. Resolution strategies: last-write-wins (simple but loses data), custom conflict resolution functions (application-specific merge logic), or CRDTs (automatic conflict-free merge for supported data types).

Multi-leader is appropriate for: multi-region deployments where write latency to a single leader is unacceptable, and collaborative applications where multiple users edit concurrently. CouchDB, Tungsten Replicator for MySQL, and Azure Cosmos DB's multi-region writes use multi-leader replication.

## Leaderless

All replicas accept both reads and writes. The client sends writes to multiple replicas (or a coordinator does) and considers the write successful when W replicas acknowledge. Reads query R replicas and use version numbers to determine the most recent value. The quorum condition `W + R > N` (where N is the total replica count) ensures read-write overlap — at least one replica in any read quorum has the latest write.

Dynamo, Cassandra, and Riak use leaderless replication. There's no failover needed — any replica can serve any request. The tradeoff: weaker consistency (without careful quorum configuration, stale reads are possible), read-repair overhead (when a read detects a stale replica, it sends the latest version back), and anti-entropy processes to catch replicas that missed writes.

## Failure Scenarios

**Leader-follower with async replication.** The leader crashes. The most up-to-date follower is promoted, but it's 3 seconds behind. Those 3 seconds of writes are lost. If the old leader comes back online, it has writes that the new leader doesn't — a divergence. The old leader must discard those writes and re-sync from the new leader, or the operator must manually resolve the divergence. This is the "split-brain after failover" problem.

**Multi-leader with last-write-wins.** Two data centers. User A updates their email in DC1; the application in DC2 independently updates the same user's phone number. Both writes have different timestamps. LWW picks the later timestamp and discards the earlier — one update is silently lost even though they touched different fields. The fix: field-level conflict resolution (merge both updates) or CRDTs (per-field LWW-Register).

**Leaderless with sloppy quorum.** During a partition, a write reaches W replicas — but some are "hint" replicas (not the primary replicas for that key) via hinted handoff. The write succeeds, but the primary replicas don't have it. A subsequent read with strict quorum reads the primary replicas, misses the write, and returns stale data. Sloppy quorums trade consistency for availability.

## Decision Criteria

Use leader-follower when: you need strong consistency for writes and can tolerate the single-leader bottleneck. Use multi-leader when: geo-distributed writes are a hard requirement and you can handle conflict resolution. Use leaderless when: availability is the priority, your application tolerates eventual consistency, and you want zero-downtime on any single node failure.
