---
id: "distsys-consensus-raft"
paradigm: distsys
title: "Raft Consensus: Leader Election, Log Replication, and Safety"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/consensus-raft"
---

# Raft Consensus: Leader Election, Log Replication, and Safety

Raft is a consensus algorithm designed to be understandable. It provides the same guarantees as Multi-Paxos — linearizable reads and writes across a replicated log — but decomposes the problem into leader election, log replication, and safety, making each independently reasonable.

## Leader Election

Every Raft node is in one of three states: follower, candidate, or leader. Time is divided into terms (monotonically increasing integers). A follower that hasn't heard from a leader within its election timeout transitions to candidate, increments its term, votes for itself, and requests votes from all peers. A candidate wins if it receives votes from a majority. The randomized election timeout (typically 150–300ms) prevents split votes in most cases. If two candidates split the vote, both back off with new random timeouts and retry. In practice, elections resolve within a single round-trip in the common case.

## Log Replication

The leader accepts client requests, appends each as an entry to its log, and replicates entries to followers via AppendEntries RPCs. An entry is committed once a majority of nodes have durably written it. The leader then applies the entry to its state machine and responds to the client. Followers apply committed entries in log order. The leader tracks the highest committed index and piggybacks this on every AppendEntries, so followers know when to apply entries.

A critical invariant: if two logs contain an entry with the same index and term, then all preceding entries are identical. This is enforced by the leader's consistency check: each AppendEntries includes the index and term of the entry immediately preceding the new ones. If a follower's log doesn't match, it rejects the RPC, and the leader decrements its nextIndex for that follower and retries. This back-tracking converges in O(log n) rounds in practice.

## Safety

Raft's election restriction guarantees that a newly elected leader already contains all committed entries. A candidate must have a log at least as up-to-date as a majority of nodes to win an election. "Up-to-date" means: higher last-log term, or same term with equal-or-higher last-log index. This avoids the need for a separate log-recovery phase after election.

## Failure Scenarios

**Leader crash during replication.** The leader appends an entry, sends AppendEntries to 2 of 4 followers, then crashes. The entry is on 3 of 5 nodes but not committed (the leader hadn't confirmed majority). A new leader elected from the 2 followers without the entry will overwrite it. The client that submitted the request sees a timeout and must retry — this is why client-side deduplication or idempotency keys are essential with Raft.

**Network partition isolating the leader.** The old leader continues accepting writes that it cannot replicate. Meanwhile, the majority partition elects a new leader and progresses. When the partition heals, the old leader discovers a higher term, steps down, and its uncommitted entries are overwritten. Clients connected to the old leader during the partition received no commit confirmations (assuming the leader waits for majority), but if the leader was configured to respond optimistically, those writes are lost.

## Production Considerations

etcd, CockroachDB, TiKV, and Consul all use Raft. In production, the main tuning concerns are: election timeout vs. network RTT (too short causes spurious elections; too long causes prolonged unavailability), snapshot frequency (to prevent unbounded log growth), and read semantics (leader-only reads are linearizable but bottleneck the leader; follower reads require a lease or read-index protocol to avoid stale reads).
