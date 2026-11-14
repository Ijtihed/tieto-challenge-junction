---
id: "distsys-byzantine-fault-tolerance"
paradigm: distsys
title: "Byzantine Fault Tolerance"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/byzantine-fault-tolerance"
---

# Byzantine Fault Tolerance

A Byzantine fault is one where a node doesn't just crash — it behaves arbitrarily: sending conflicting messages to different peers, lying about its state, or colluding with other faulty nodes. Byzantine Fault Tolerance (BFT) is the ability of a system to reach consensus despite up to `f` Byzantine nodes, requiring at least `3f + 1` total nodes (compared to `2f + 1` for crash-fault tolerance).

## Why 3f + 1

With crash failures, a failed node is silent — it sends nothing. Correct nodes can distinguish silence from participation. A Byzantine node actively sends contradictory information. With `3f + 1` nodes and `f` Byzantine, the remaining `2f + 1` correct nodes form a supermajority that can outvote the `f` liars even in the worst case. With fewer nodes, a Byzantine quorum intersection isn't guaranteed.

## PBFT (Practical Byzantine Fault Tolerance)

PBFT is the canonical BFT consensus algorithm for permissioned settings. It operates in three phases:

**Pre-prepare.** The primary (leader) assigns a sequence number to a client request and multicasts a pre-prepare message.

**Prepare.** Each replica validates the pre-prepare and multicasts a prepare message. A replica enters the prepared state when it has the pre-prepare plus `2f` matching prepares.

**Commit.** Each prepared replica multicasts a commit message. A replica commits when it has `2f + 1` commits (including its own).

PBFT's communication complexity is O(N²) per consensus round (every node sends to every other node), which limits practical cluster sizes to around 20–100 nodes. View changes (leader replacement when the primary is faulty) add another O(N³) round.

## When You Need BFT

Most internal distributed systems don't need BFT. If you control all the hardware and software, crash-fault tolerance (Raft, Paxos) is sufficient and far cheaper. BFT matters in these scenarios:

**Blockchain and multi-party computation.** Nodes are operated by mutually distrusting parties. Tendermint (used by Cosmos) is PBFT-derived. Ethereum's Casper has BFT properties.

**Safety-critical systems.** Avionics and spacecraft use BFT voting across redundant processors from different manufacturers to guard against hardware faults that manifest as Byzantine behavior (bit flips, firmware bugs).

**Multi-tenant infrastructure.** If a compromised tenant can corrupt a shared coordination node, BFT prevents that node from poisoning consensus. This is rare in practice — most systems isolate tenants at the process level instead.

## When You Don't Need BFT

If all your nodes run the same software on hardware you control in data centers you trust, the Byzantine failure model adds cost (more replicas, higher message complexity, more latency) without practical benefit. A compromised server in your own data center is a security incident, not a consensus problem — handle it with intrusion detection, not BFT.

## Modern BFT Variants

**HotStuff.** Reduces communication to O(N) per phase by using a star topology (all messages route through the leader) with threshold signatures. Adopted by Facebook's Diem (Libra) blockchain before its shutdown. The key insight: the leader aggregates signatures into a single threshold certificate, eliminating the all-to-all broadcast.

**Tendermint/CometBFT.** Optimized PBFT for blockchain, with round-robin leader rotation and locking-based safety. Used in production by dozens of Cosmos chains.

## Failure Scenario

A four-node PBFT cluster (tolerating 1 Byzantine node) has a faulty primary that sends different pre-prepares to different replicas. Replicas A and B receive conflicting sequence assignments. During the prepare phase, each detects the inconsistency (the pre-prepare digests don't match) and triggers a view change. The new primary is elected, and the conflicting request is re-sequenced. The system's safety is preserved — no conflicting commits occur — but throughput drops to zero during the view change, which can take multiple round-trips. In production, aggressive view-change timeouts can cause view-change storms if the network is merely slow rather than Byzantine.
