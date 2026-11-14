---
id: "distsys-crdt"
paradigm: distsys
title: "Conflict-Free Replicated Data Types"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/crdt"
---

# Conflict-Free Replicated Data Types

CRDTs are data structures that can be replicated across multiple nodes, updated independently and concurrently without coordination, and merged automatically into a consistent state. They achieve strong eventual consistency: all replicas that have received the same set of updates (in any order) converge to the same state. No consensus protocol needed.

## The Two Flavors

**State-based CRDTs (CvRDTs).** Each replica holds the full state. Replicas periodically send their entire state to peers, which merge it using a join operation on a semilattice. The join must be commutative, associative, and idempotent. Example: a G-Counter where each node maintains its own counter entry, and merge takes the element-wise max.

**Operation-based CRDTs (CmRDTs).** Replicas broadcast individual operations rather than full state. Operations must be commutative (if concurrent) and the delivery layer must guarantee at-least-once delivery. The advantage is smaller message sizes; the cost is a reliable broadcast requirement.

## Core Data Types

**G-Counter (grow-only counter).** Each of N nodes maintains a local counter. Increment is local. The value is the sum of all entries. Merge is element-wise max. Simple, but you can only count up.

**PN-Counter.** Two G-Counters: one for increments, one for decrements. The value is `P - N`. This gives you a counter that supports both increment and decrement.

**LWW-Register (last-writer-wins).** Stores a value with a timestamp. Merge picks the value with the highest timestamp. Simple and widely used (Cassandra cells are LWW-Registers), but concurrent writes silently discard one value. The "conflict resolution" is timestamp ordering, which requires loosely synchronized clocks and accepts that one concurrent write is arbitrarily lost.

**OR-Set (observed-remove set).** Supports add and remove operations. Each add is tagged with a unique identifier. A remove only affects the specific add-tags that the removing replica has observed. Concurrent add and remove of the same element results in the element being present (add wins), which is the intuitive semantic for most applications. This is the workhorse CRDT for sets and is used in Riak's CRDT sets.

**LWW-Element-Set.** Each element has an add-timestamp and a remove-timestamp. The element is in the set if the add-timestamp is greater. Simpler than OR-Set but shares LWW's timestamp-ordering limitation.

## Practical Limitations

**Metadata growth.** OR-Sets accumulate unique tags that cannot be garbage-collected without coordination. A key that has been added and removed thousands of times carries all those tags. Solutions include periodic coordinated garbage collection (which defeats the "no coordination" goal) or delta-state CRDTs that transmit only recent changes and compact state periodically.

**No general-purpose CRDT map with remove.** Composing CRDTs into maps with full add/remove/update semantics is possible (Riak's CRDT maps do it) but the semantics become subtle. Concurrent remove-key and update-key on the same key can produce surprising results depending on the composition rules.

## Failure Scenario

A collaborative document editor uses an OR-Set CRDT for paragraph ordering. Two users concurrently move paragraph 3: User A moves it after paragraph 1, User B moves it after paragraph 5. The CRDT merge preserves both operations, resulting in paragraph 3 appearing in two positions — which is a valid CRDT state but nonsensical for the application. The fix is a list CRDT (like RGA or LSEQ) that models ordered sequences rather than using a set of position markers.

## Decision Criteria

Use CRDTs when: you need multi-writer replication without coordination, you can tolerate eventual consistency, and your data types fit the available CRDT shapes (counters, sets, registers, sequences). Don't use CRDTs when: you need transactions across multiple keys, your conflict resolution requires application-specific logic that doesn't fit a semilattice, or metadata growth is unacceptable for your storage budget.
