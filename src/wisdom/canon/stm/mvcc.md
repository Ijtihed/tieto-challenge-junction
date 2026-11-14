---
id: "stm-mvcc"
paradigm: stm
title: "Multi-Version Concurrency Control"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/mvcc"
---

# Multi-Version Concurrency Control

MVCC allows readers and writers to operate concurrently by maintaining multiple versions of data. Instead of blocking readers while a write is in progress, the system gives each transaction a consistent snapshot as of its start time. This is the concurrency backbone of PostgreSQL, Oracle, MySQL/InnoDB, CockroachDB, and Clojure's STM.

## Snapshot Isolation

Under snapshot isolation (SI), each transaction sees a frozen view of the database as of its start timestamp. Writes go into a private workspace and become visible to other transactions only at commit time. Two concurrent transactions modifying *different* rows never conflict. Two transactions modifying the *same* row trigger a first-committer-wins rule — the second transaction aborts.

```sql
-- T1 starts at timestamp 100
BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- sees snapshot@100
UPDATE accounts SET balance = balance - 50 WHERE id = 1;
COMMIT;  -- succeeds

-- T2 starts at timestamp 100, concurrent with T1
BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- sees snapshot@100
UPDATE accounts SET balance = balance - 30 WHERE id = 1;
COMMIT;  -- aborts: T1 already committed a write to this row
```

## Write Skew

SI does not prevent write skew — the anomaly where two transactions read overlapping state, make disjoint writes, and both commit, leaving the system in an inconsistent state:

```
Invariant: at least one doctor must be on call.
T1 reads: doctor_a=on_call, doctor_b=on_call → sets doctor_a=off_call
T2 reads: doctor_a=on_call, doctor_b=on_call → sets doctor_b=off_call
Both commit. No doctor is on call. Invariant violated.
```

Neither transaction wrote to a row the other wrote, so first-committer-wins doesn't trigger. Preventing write skew requires serializable isolation — either through predicate locking (PostgreSQL's SSI), explicit `SELECT FOR UPDATE`, or materialising the conflict (adding a row both transactions must write).

## Version Chains and Garbage Collection

Each write creates a new version linked to the previous one. A transaction at timestamp `t` walks the version chain to find the newest version with a commit timestamp ≤ `t`. Garbage collection (vacuuming in PostgreSQL) reclaims versions older than the oldest active transaction's snapshot — without this, the version chain grows unboundedly under write-heavy workloads.

Long-running read transactions pin old versions, preventing vacuum from reclaiming them. This is the operational source of table bloat in PostgreSQL and "version store" growth in SQL Server.

## MVCC in STM

Clojure's Refs use MVCC internally: each Ref maintains a bounded history of committed values. A transaction that started at logical time `t` reads from the history entry whose timestamp is ≤ `t`. If the needed version has fallen off the history window, the transaction retries from scratch with a fresh timestamp. Tuning `:min-history` and `:max-history` on a Ref trades memory for retry avoidance.

## Serializable Snapshot Isolation (SSI)

PostgreSQL 9.1+ implements SSI by tracking read-write dependencies between concurrent transactions. When the runtime detects a dangerous structure (a cycle of rw-dependencies that could produce a non-serializable outcome), it aborts one of the transactions. SSI adds overhead to reads (dependency tracking) but avoids the broad locking of traditional two-phase locking. The practical guidance: use `SERIALIZABLE` isolation when write-skew correctness matters, and accept the higher abort rate as the cost.
