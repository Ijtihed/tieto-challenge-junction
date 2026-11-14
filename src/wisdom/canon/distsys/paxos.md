---
id: "distsys-paxos"
paradigm: distsys
title: "Paxos, Multi-Paxos, and Why It's Hard to Implement"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/paxos"
---

# Paxos, Multi-Paxos, and Why It's Hard to Implement

Paxos is the foundational consensus algorithm. Every consensus protocol deployed at scale is either Paxos, a Paxos derivative, or something explicitly designed to be "not Paxos" (like Raft). Understanding Paxos means understanding why consensus is inherently a two-phase problem.

## Single-Decree Paxos

Single-decree Paxos agrees on one value among a set of processes that may crash and recover. It has three roles: proposers, acceptors, and learners (a single node can play multiple roles). The protocol has two phases:

**Phase 1 (Prepare).** A proposer picks a proposal number `n` (globally unique, monotonically increasing) and sends `Prepare(n)` to a majority of acceptors. Each acceptor responds with a promise not to accept any proposal numbered less than `n`, and returns any value it has already accepted along with that value's proposal number.

**Phase 2 (Accept).** If the proposer receives promises from a majority, it sends `Accept(n, v)` where `v` is either the value from the highest-numbered previously accepted proposal, or the proposer's own value if no acceptor had accepted anything. An acceptor accepts the proposal if it hasn't promised to a higher number.

A value is chosen when a majority of acceptors have accepted the same proposal number. The key insight: Phase 1 discovers what might already be chosen, and Phase 2 either completes that choice or starts a new one. This is what makes Paxos safe despite crashes — no committed value can be overwritten.

## Multi-Paxos

Single-decree Paxos chooses one value. Real systems need a replicated log — a sequence of chosen values. Multi-Paxos runs a separate Paxos instance per log slot, but amortizes Phase 1 by electing a stable leader. The leader skips Phase 1 for subsequent slots (it already holds the highest proposal number) and goes directly to Phase 2. This reduces consensus to one round-trip per entry in the common case, matching Raft's performance.

## Why It's Hard to Implement

Lamport's original paper describes the algorithm in terms of mathematical properties, not engineering steps. Production implementations must solve problems the paper doesn't address: leader election and failure detection, log compaction and snapshotting, membership changes (adding or removing nodes), read-only optimizations, batching and pipelining, and handling disk corruption on recovery.

Google's Chubby (the lock service built on Paxos) took years to stabilize. The Chubby authors reported that the gap between the Paxos paper and a production system is enormous. Specific pitfalls: proposal number generation requires durable state (a crash that forgets the last proposal number can cause safety violations), multi-decree slot gaps require careful handling (what if slot 5 is chosen before slot 3?), and liveness depends on a leader oracle that Paxos itself doesn't provide.

## When Paxos vs. Raft

Raft is strictly easier to implement, reason about, and debug. Choose Paxos when: you need flexible quorum configurations (Flexible Paxos allows different quorum sizes for Phase 1 and Phase 2), you're building a system that needs to survive Byzantine-adjacent failures in the leader election layer, or you're working in a research context where Paxos variants (EPaxos, Fast Paxos) offer latency advantages for geo-distributed deployments. For everything else — configuration stores, replicated state machines, coordination services — Raft is the pragmatic choice.
