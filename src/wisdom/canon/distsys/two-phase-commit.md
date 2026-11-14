---
id: "distsys-two-phase-commit"
paradigm: distsys
title: "Two-Phase Commit, Three-Phase Commit, and Their Failure Modes"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/two-phase-commit"
---

# Two-Phase Commit, Three-Phase Commit, and Their Failure Modes

Two-phase commit (2PC) is the standard protocol for atomic transactions across multiple nodes. It guarantees that either all participants commit or all abort, but it pays for this guarantee with a blocking failure mode that has caused more production outages than most engineers realize.

## Two-Phase Commit

A coordinator drives the protocol in two phases:

**Phase 1 (Prepare/Vote).** The coordinator sends a prepare request to all participants. Each participant executes the transaction up to the point of commit, acquires locks, writes a prepare record to its local WAL, and votes YES or NO. A YES vote is a binding promise: the participant guarantees it can commit if told to.

**Phase 2 (Commit/Abort).** If all participants voted YES, the coordinator writes a commit record to its own WAL and sends COMMIT to all participants. If any voted NO, it sends ABORT. Each participant commits or rolls back and releases locks.

The critical property: once a participant votes YES, it has handed control to the coordinator. It cannot unilaterally abort — it must wait for the coordinator's decision, potentially forever.

## The Blocking Problem

If the coordinator crashes after receiving all YES votes but before sending COMMIT, every participant is stuck. They've voted YES, they're holding locks, and they can't proceed because they don't know the coordinator's decision. They can't abort (the coordinator might have committed) and they can't commit (the coordinator might have aborted). This is 2PC's fundamental flaw: it blocks on coordinator failure after the vote.

In practice, this means: a coordinator crash at the wrong millisecond causes lock contention that cascades across the system. The locks held by the in-doubt transaction block other transactions, which timeout and retry, which pile up, and the system degrades until the coordinator recovers and replays its WAL.

## Three-Phase Commit

3PC adds a pre-commit phase between voting and committing. After all participants vote YES, the coordinator sends PRE-COMMIT (acknowledging the unanimous vote) before sending COMMIT. If the coordinator crashes after PRE-COMMIT, any participant can detect that all peers received PRE-COMMIT and proceed to commit — the decision is recoverable without the coordinator.

3PC is non-blocking under crash failures. However, it is not safe under network partitions: a partition can cause one group of participants to see PRE-COMMIT and commit, while another group times out and aborts. For this reason, 3PC is rarely used in production. The systems that need strong atomics across nodes (Spanner, CockroachDB) use 2PC plus Paxos/Raft for the coordinator role, making the coordinator itself fault-tolerant rather than adding a third phase.

## Practical Alternatives

**Saga pattern.** Replace a distributed transaction with a sequence of local transactions, each with a compensating action. If step 3 fails, execute compensations for steps 2 and 1. Sagas provide eventual atomicity without locks, at the cost of complex compensation logic and intermediate visibility of partial results.

**Deterministic databases (Calvin, BOHM).** Pre-sequence all transactions in a global log, then execute them deterministically on each replica. No 2PC needed because every replica processes the same sequence and reaches the same state.

## Failure Scenario

A payment system uses 2PC across a billing service and an inventory service. The coordinator sends PREPARE, both vote YES, and the coordinator crashes before writing the COMMIT record. Billing has reserved funds (locked), inventory has reserved stock (locked). Both services are stuck for the coordinator's recovery timeout (often 30–60 seconds). During this window, all other orders touching those inventory items or that user's billing account are blocked. The mitigation: make the coordinator a Raft group so coordinator failure triggers a leader election in seconds, not a recovery timeout in minutes.
