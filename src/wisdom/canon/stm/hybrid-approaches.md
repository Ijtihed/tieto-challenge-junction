---
id: "stm-hybrid-approaches"
paradigm: stm
title: "Hybrid Transactional Memory"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/hybrid-approaches"
---

# Hybrid Transactional Memory

Pure STM has a fundamental constraint: transactions must be side-effect-free because the runtime may abort and retry them at any point. Real systems need I/O — logging, network calls, database writes — within logically atomic operations. Hybrid transactional memory combines STM with locks, I/O buffers, or hardware support to bridge this gap.

## The I/O Problem

STM transactions cannot safely perform I/O. If a transaction writes to a socket, then aborts due to a conflict, the write cannot be undone. Retrying the transaction writes again, producing duplicates. This is not a theoretical concern — it's the primary reason STM hasn't replaced locks in general-purpose systems.

```haskell
-- BROKEN: I/O inside a transaction
atomically $ do
  bal <- readTVar account
  writeTVar account (bal - 100)
  -- Can't do this: sendEmail would fire on every retry
  -- sendEmail user "withdrawal" 
```

## Deferred I/O

The simplest hybrid: collect I/O actions during the transaction, execute them after commit. Haskell makes this natural with the type system:

```haskell
transferWithLog :: TVar Int -> TVar Int -> Int -> IO ()
transferWithLog from to amount = do
  logAction <- atomically $ do
    fromBal <- readTVar from
    when (fromBal < amount) retry
    writeTVar from (fromBal - amount)
    modifyTVar to (+ amount)
    return $ appendFile "ledger.log" $
      "Transfer: " ++ show amount ++ "\n"
  logAction  -- I/O runs exactly once, after commit
```

The transaction returns an `IO` action; the caller runs it post-commit. If the transaction retries, no I/O escapes. The limitation: the I/O action cannot depend on transactional state that might change between commit and execution (though in practice, the returned closure captures the committed values).

## Lock-STM Interop

Some operations are inherently non-transactional (file system mutations, hardware register access). The hybrid approach: use STM for the in-memory coordination, acquire a lock for the I/O region, and sequence them:

```python
# Pseudocode: STM + lock hybrid
with stm_transaction():
    balance = read(account_tvar)
    if balance < amount:
        retry()
    write(account_tvar, balance - amount)

# Transaction committed; now safe to do I/O
with file_lock:
    append_to_ledger(amount)
```

The lock protects the I/O from concurrent access; the STM protects the state update. The key invariant: the lock must not be held during the transaction (deadlock risk if the transaction retries while holding a lock) and the I/O must be idempotent or guarded by a commit check.

## Hardware Transactional Memory (HTM)

Intel TSX (Transactional Synchronization Extensions) and IBM POWER's HTM provide hardware-level speculative execution. A transaction runs speculatively in the CPU cache; on commit, the cache lines are atomically made visible. On conflict (another core accesses a cache line in the transaction's write set), the hardware aborts and restores the pre-transaction state.

```c
if (_xbegin() == _XBEGIN_STARTED) {
    // Hardware transaction
    shared_data[idx] += 1;
    _xend();
} else {
    // Fallback: lock-based path
    pthread_mutex_lock(&lock);
    shared_data[idx] += 1;
    pthread_mutex_unlock(&lock);
}
```

HTM has hard capacity limits (transaction fits in L1 cache) and can abort for non-conflict reasons (interrupts, TLB misses, unsupported instructions). The fallback path is mandatory. Hybrid TM uses HTM as the fast path and STM or locks as the slow path, getting hardware speed for small transactions and software generality for large ones.

## Compensating Transactions

For systems where I/O cannot be deferred (e.g., distributed sagas), compensating transactions provide a rollback mechanism: each forward action has a paired undo action. If the transaction aborts, the compensating actions execute in reverse order:

```
Forward: charge_card(100) → reserve_inventory(item) → schedule_shipping(item)
Compensate: cancel_shipping(item) → release_inventory(item) → refund_card(100)
```

This is not true atomicity — there's a window where the system is in an inconsistent state. It's eventual consistency with explicit rollback, used when true atomicity is impractical (cross-service boundaries, external APIs).

## Choosing the Hybrid

- **Deferred I/O** when the I/O can wait until after commit and doesn't affect transactional decisions.
- **Lock-STM interop** when I/O must be coordinated with transactional state but can happen post-commit.
- **HTM with STM fallback** when raw throughput matters and most transactions are small.
- **Compensating transactions** when atomicity spans service boundaries and true rollback is impossible.

The hybrid is always more complex than pure STM. The question is whether the use case demands I/O within logical atomicity boundaries — and in production systems, it almost always does.
