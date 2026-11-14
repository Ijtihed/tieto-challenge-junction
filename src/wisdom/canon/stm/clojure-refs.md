---
id: "stm-clojure-refs"
paradigm: stm
title: "Clojure's Approach to STM"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/clojure-refs"
---

# Clojure's Approach to STM

Clojure embeds STM directly in its concurrency model through Refs — mutable references that can only be modified inside a `dosync` transaction. This is not an academic exercise bolted on; it is the primary coordination mechanism for shared mutable state in the language.

## Refs and dosync

A Ref holds a value and participates in transactions. All mutations happen inside `dosync`, which establishes a transaction boundary:

```clojure
(def account-a (ref 1000))
(def account-b (ref 2000))

(dosync
  (alter account-a - 100)
  (alter account-b + 100))
```

`dosync` guarantees ACI properties (atomicity, consistency, isolation — durability is not relevant for in-memory state). If any Ref read during the transaction was modified by another thread, the runtime retries the entire `dosync` block. The body must be free of side effects.

## alter vs commute

`alter` applies a function to a Ref's value and records the new value in the transaction log. At commit time, the Ref's in-transaction value must match its current real value (or the transaction retries).

`commute` is an optimistic alternative for commutative operations — operations where order doesn't matter:

```clojure
(def counter (ref 0))

;; commute: last-one-in-wins, re-applies fn at commit time
(dosync (commute counter inc))
```

`commute` re-runs its function against the *committed* value at commit time rather than the in-transaction snapshot. This eliminates retries when multiple threads increment the same counter concurrently. Use `commute` only when the function is genuinely commutative; violating this invariant produces silently wrong results.

## ref-set and ensure

`ref-set` replaces a Ref's value outright — useful for initialisation but rare in production code:

```clojure
(dosync (ref-set account-a 0))
```

`ensure` adds a Ref to the transaction's read set without modifying it, preventing write skew:

```clojure
(dosync
  (ensure account-a)  ;; guarantees account-a doesn't change mid-txn
  (alter account-b + (deref account-a)))
```

Without `ensure`, another thread could modify `account-a` between the deref and commit, and the transaction would not detect the conflict because plain `deref` outside `alter`/`commute` does not participate in conflict detection.

## MVCC Under the Hood

Clojure's STM uses multi-version concurrency control. Each Ref maintains a history of recent values (configurable via `:min-history` and `:max-history`). Transactions read from a consistent snapshot without blocking writers. The history window lets read-only transactions avoid retries when writers commit frequently — the transaction can read the value as of its start time if it's still in the history chain.

## Design Boundaries

Clojure deliberately separates its concurrency primitives by use case: Refs + STM for coordinated synchronous updates, Atoms for uncoordinated synchronous updates, Agents for asynchronous updates. Reaching for Refs when an Atom suffices adds unnecessary transaction overhead. The heuristic: if you're modifying multiple pieces of state that must be consistent with each other, use Refs; if it's a single independent value, use an Atom.

Clojure's STM does not support I/O inside transactions. Side effects must happen outside `dosync`, typically via an Agent send triggered after commit.
