---
id: "stm-persistent-data-structures"
paradigm: stm
title: "Persistent Data Structures for Safe Concurrency"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/persistent-data-structures"
---

# Persistent Data Structures for Safe Concurrency

A persistent data structure preserves previous versions of itself when modified. "Modification" returns a new version; the old version remains intact and accessible. This property makes persistent structures inherently safe to share across threads — no reader can observe a half-written state because nothing is ever written in place.

## Structural Sharing

Naively copying an entire data structure on every update is O(n). Persistent structures avoid this through structural sharing — the new version reuses most of the old version's nodes, allocating only along the path from root to the changed leaf.

A persistent balanced tree with 1 million elements copies ~20 nodes on an update (O(log n)), sharing the remaining 999,980. This is the foundation of Clojure's persistent vectors, maps, and sets.

```clojure
;; Clojure's persistent vector: conj returns a new vector, v is unchanged
(def v [1 2 3 4 5])
(def v2 (conj v 6))

(count v)   ;; => 5, original intact
(count v2)  ;; => 6, shares structure with v
```

## Hash Array Mapped Tries (HAMT)

Clojure's `PersistentHashMap` and Scala's `HashMap` use HAMTs — a trie indexed by chunks of the hash code. Each internal node is a 32-wide array (using a 5-bit hash chunk per level). Updates create new nodes along the path; the bitmap-indexed population count trick compresses sparse nodes to avoid wasting memory:

```
Key hash: 01011 11010 00101 ...
Level 0:  index = 01011 (11) → child node
Level 1:  index = 11010 (26) → child node
Level 2:  index = 00101 (5)  → leaf with value
```

Lookup is O(log₃₂ n) ≈ O(1) for practical sizes. A map with 1 billion entries has at most 6 levels.

## Concurrency Implications

Persistent structures eliminate a class of concurrency bugs by making shared-nothing the default:

```clojure
;; Safe without locks: each thread gets an immutable snapshot
(def state (atom {:users [] :count 0}))

;; swap! applies a pure function to the current value
(swap! state (fn [s]
  (-> s
      (update :users conj new-user)
      (update :count inc))))
```

The function passed to `swap!` may be retried if another thread committed first, but since it operates on immutable values and produces new immutable values, retries are safe — no side effects, no torn reads.

## Transient Optimization

For batch operations where an intermediate persistent structure would be wasteful, Clojure provides transients — mutable versions of persistent structures that are confined to a single thread:

```clojure
(persistent!
  (reduce conj! (transient []) (range 100000)))
```

`transient` converts a persistent structure to a mutable one (O(1)); `persistent!` converts back (O(1)). The transient enforces single-thread ownership — using it from another thread throws. This gives batch-mutation performance without sacrificing the persistent guarantee at API boundaries.

## Relationship to STM

Persistent structures and STM are complementary. Clojure's Atoms wrap persistent structures — `swap!` atomically replaces the root reference, and readers see consistent snapshots via structural sharing. STM Refs hold persistent values so that transactions can safely read old snapshots from the MVCC history. Without persistence, STM would need deep-copy semantics for snapshot isolation, which would be prohibitively expensive.

In the broader design space: if your concurrency model is "shared immutable state + atomic root swaps," persistent structures give you that model at near-mutable performance. If you need coordinated multi-reference updates, layer STM on top.
