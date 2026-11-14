---
id: "stm-lock-free-data-structures"
paradigm: stm
title: "Lock-Free and Wait-Free Data Structures"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/lock-free-data-structures"
---

# Lock-Free and Wait-Free Data Structures

Lock-free algorithms guarantee system-wide progress: at least one thread completes its operation in a finite number of steps, regardless of what other threads do. Wait-free algorithms go further — every thread completes in bounded steps. Both eliminate deadlock by construction.

## Compare-and-Swap (CAS)

CAS is the foundational primitive. It atomically compares a memory location to an expected value and, only if they match, replaces it with a new value:

```c
// Pseudocode for atomic CAS
bool CAS(int *addr, int expected, int desired) {
    if (*addr == expected) {
        *addr = desired;
        return true;
    }
    return false;
}
```

A lock-free counter using CAS in a retry loop:

```java
public long increment() {
    long current, next;
    do {
        current = value.get();
        next = current + 1;
    } while (!value.compareAndSet(current, next));
    return next;
}
```

Under low contention this completes in one CAS. Under high contention, threads retry, but at least one succeeds per "round" — the lock-free guarantee.

## The ABA Problem

CAS checks value equality, not identity. If a location changes from A → B → A between a thread's read and its CAS, the CAS succeeds despite an intervening modification. This corrupts lock-free linked structures:

```
Thread 1: reads head = Node(A), prepares to CAS head from A to C
Thread 2: pops A, pops B, pushes A back (reusing the same pointer)
Thread 1: CAS succeeds (head is A again), but the list structure is corrupted
```

Mitigations:
- **Tagged pointers / version counters.** Pack a monotonic counter with the pointer. CAS compares both — the counter prevents ABA even if the pointer value recurs.
- **Hazard pointers.** Threads publish pointers they're currently accessing; reclamation is deferred until no thread holds a hazard on the node.
- **Epoch-based reclamation.** Threads announce which epoch they're in; memory freed in epoch `e` is reclaimed only after all threads have advanced past `e`.

## Michael-Scott Queue

The canonical lock-free FIFO queue. Enqueue CASes a new node onto the tail; dequeue CASes the head forward. Helping is the key insight — if a thread finds the tail pointer lagging, it advances the tail on behalf of the slow thread before retrying its own enqueue.

```rust
// Simplified Rust-flavoured pseudocode
fn enqueue(&self, val: T) {
    let node = Node::new(val);
    loop {
        let tail = self.tail.load(Acquire);
        let next = (*tail).next.load(Acquire);
        if next.is_null() {
            if (*tail).next.compare_exchange(null, node, AcqRel, Acquire).is_ok() {
                let _ = self.tail.compare_exchange(tail, node, AcqRel, Acquire);
                return;
            }
        } else {
            let _ = self.tail.compare_exchange(tail, next, AcqRel, Acquire);
        }
    }
}
```

## Wait-Freedom and Practical Bounds

True wait-free structures (e.g., Kogan-Petrank queue) guarantee per-thread bounded steps but carry higher constant overhead. In practice, lock-free structures with exponential backoff perform better for most workloads because contention is bursty, not sustained.

## STM vs Lock-Free

STM and lock-free structures solve overlapping problems differently. STM gives composability — you can atomically dequeue from one queue and enqueue to another. Lock-free structures give raw throughput on isolated operations. When you need composition (multi-object atomicity), prefer STM. When you need maximum single-operation throughput on a hot data structure, prefer lock-free.
