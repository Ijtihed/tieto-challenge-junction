---
id: "stm-haskell-composability"
paradigm: stm
title: "Haskell STM and Type-Safe Transaction Composition"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/haskell-composability"
---

# Haskell STM and Type-Safe Transaction Composition

Haskell's STM implementation is the reference design for type-safe composable transactions. The type system enforces the no-side-effects invariant at compile time — you cannot accidentally perform I/O inside a transaction because the types won't unify.

## The STM Monad

`STM a` is a monad describing a transaction that produces a value of type `a`. It supports `readTVar`, `writeTVar`, `retry`, and `orElse`, but not `putStrLn` or any `IO` action. The only way to execute an `STM` action is via `atomically :: STM a -> IO a`, which runs the transaction to completion:

```haskell
type Account = TVar Integer

transfer :: Account -> Account -> Integer -> STM ()
transfer from to amount = do
  fromBal <- readTVar from
  when (fromBal < amount) retry
  writeTVar from (fromBal - amount)
  modifyTVar to (+ amount)
```

`transfer` is an `STM` action — it can be called inside other `STM` actions, composed with `>>=`, or run at the top level via `atomically`. The type signature makes composition safe: any function accepting `STM ()` can call `transfer` without deadlock risk.

## orElse: First-Class Alternatives

`orElse :: STM a -> STM a -> STM a` runs the first transaction; if it calls `retry`, the runtime discards its effects and runs the second. This composes cleanly:

```haskell
withdrawFromAny :: [Account] -> Integer -> STM ()
withdrawFromAny [] _ = retry
withdrawFromAny (a:as) amount =
  withdraw a amount `orElse` withdrawFromAny as amount
```

This tries each account in sequence without blocking. If all accounts have insufficient funds, the final `retry` blocks the thread until any of the accounts changes. The runtime tracks the union of all read sets across the `orElse` chain for precise wake-up.

## Why the Type Separation Matters

In languages without this enforcement (Clojure, Scala), the no-I/O-in-transactions rule is a convention. Violations are silent: a `println` inside a retried transaction prints multiple times; a network call inside a retried transaction fires multiple times. In Haskell, the compiler rejects `putStrLn "debug"` inside `STM` — the types `STM ()` and `IO ()` don't unify.

```haskell
-- This does not compile:
broken :: TVar Int -> STM ()
broken tvar = do
  val <- readTVar tvar
  putStrLn (show val)  -- Type error: IO () is not STM ()
  writeTVar tvar (val + 1)
```

When I/O is genuinely needed alongside a transaction, the pattern is to compute the I/O action inside `STM`, return it, and execute it after `atomically`:

```haskell
safeLog :: TVar Int -> IO ()
safeLog tvar = do
  action <- atomically $ do
    val <- readTVar tvar
    writeTVar tvar (val + 1)
    return (putStrLn $ "Incremented to " ++ show (val + 1))
  action  -- I/O happens after commit, exactly once
```

## TChan, TMVar, TQueue

GHC's `stm` package builds higher-level abstractions on TVars: `TChan` (broadcast channels), `TMVar` (synchronising variables), and `TQueue` (FIFO queues). All compose with `orElse` and `retry`:

```haskell
readEither :: TChan a -> TChan a -> STM a
readEither c1 c2 = readTChan c1 `orElse` readTChan c2
```

This reads from whichever channel has data first — a select-like operation built from composable primitives rather than a special-purpose API.

## Performance Characteristics

GHC's STM uses a fine-grained locking protocol at commit time (one lock per TVar written), not a global lock. Read-set validation is O(n) in TVars read. Short transactions with small read sets commit in microseconds. Pathological cases — long-running transactions reading many TVars under high contention — suffer from repeated aborts. The mitigation is the same as in any STM: keep transactions short and break large atomic blocks into smaller composable pieces.
