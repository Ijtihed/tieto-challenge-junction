---
id: "stm-composable-memory"
paradigm: stm
title: "Composable Memory Transactions"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/composable-memory"
---

# Composable Memory Transactions

Software Transactional Memory replaces lock-based synchronisation with composable, optimistic transactions over shared mutable state. A transaction reads and writes transactional variables (TVars) speculatively; at commit time the runtime validates that no other transaction has modified the read set. If validation fails, the transaction retries from scratch with no user-visible side effects.

## Optimistic Concurrency

STM is optimistic by default: transactions proceed without acquiring locks, betting that contention is rare. Each transaction maintains a thread-local log of reads and tentative writes. Commit is the only serialisation point — the runtime atomically checks the read set against the current global state:

```haskell
atomically $ do
  bal <- readTVar account
  when (bal >= amount) $
    writeTVar account (bal - amount)
```

If another thread modified `account` between the `readTVar` and commit, the runtime discards the log and re-executes the block. This is invisible to application code — the block must be free of observable side effects (no I/O inside `atomically`).

## Retry and Blocking

STM's `retry` primitive lets a transaction declaratively block until its precondition holds. When a transaction calls `retry`, the runtime records its read set, suspends the thread, and wakes it only when a variable in that read set changes:

```haskell
withdraw :: TVar Int -> Int -> STM ()
withdraw account amount = do
  bal <- readTVar account
  when (bal < amount) retry
  writeTVar account (bal - amount)
```

This eliminates busy-waiting and condition-variable boilerplate. The blocking is precise — the thread wakes exactly when relevant state changes, not on any arbitrary signal.

## Composability

The decisive advantage over locks: STM transactions compose. Two correct transactions can be combined into a larger correct transaction without knowing each other's internals:

```haskell
transfer :: TVar Int -> TVar Int -> Int -> STM ()
transfer from to amount = do
  withdraw from amount
  deposit to amount
```

With locks, composing `withdraw` and `deposit` requires knowing their internal lock ordering to avoid deadlock. With STM, `atomically (transfer a b 100)` is deadlock-free by construction.

`orElse` composes alternatives: try the first transaction; if it calls `retry`, run the second:

```haskell
withdrawFromEither :: TVar Int -> TVar Int -> Int -> STM ()
withdrawFromEither primary backup amount =
  withdraw primary amount `orElse` withdraw backup amount
```

## Tradeoffs

STM's overhead is the read-set validation at commit time — O(n) in the number of TVars read. Under high contention, transactions repeatedly abort and retry, degrading throughput. Write-heavy workloads with large conflict windows (e.g., updating a shared counter from 64 threads) perform worse than a simple lock. STM shines when contention is moderate and the composition benefit outweighs the validation cost — which is most concurrent application logic outside of tight inner loops.

The no-side-effects constraint is load-bearing: if a transaction performs I/O before aborting, the I/O cannot be rolled back. This is enforced at the type level in Haskell (`STM` vs `IO`) and by convention elsewhere.
