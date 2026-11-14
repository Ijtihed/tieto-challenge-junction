---
id: "stm-contention-management"
paradigm: stm
title: "STM Contention Management Strategies"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/contention-management"
---

# STM Contention Management Strategies

When two transactions conflict, someone has to lose. The contention manager decides who aborts and how the aborted transaction recovers. This decision has a dramatic effect on throughput under load — naive strategies can cause livelock (both transactions repeatedly abort each other) or starvation (one transaction never commits).

## The Contention Problem

A conflict occurs when transaction T1 tries to commit and discovers that a variable in its read or write set was modified by T2 since T1 began. The contention manager has three options: abort T1 (the requester), abort T2 (the owner), or have T1 wait. The right choice depends on the workload.

## Strategy Taxonomy

### Aggressive (Suicide)

The requesting transaction always aborts itself and retries. This is the simplest strategy and works well under low contention. Under high contention, it causes repeated mutual aborts — two transactions keep killing themselves on the same conflict:

```
T1 reads X, T2 reads X
T1 tries to commit → conflict → T1 aborts, retries
T2 tries to commit → conflict → T2 aborts, retries
Repeat indefinitely.
```

### Polite (Backoff)

The requesting transaction backs off with exponential delay before retrying. This breaks the mutual-abort cycle by desynchronising the retry attempts:

```python
def polite_retry(attempt):
    max_delay = min(BASE_DELAY * (2 ** attempt), MAX_DELAY)
    sleep(random.uniform(0, max_delay))
```

Polite is GHC's default strategy for Haskell STM. It works well in practice because most conflicts are transient — the exponential backoff gives the conflicting transaction time to commit.

### Karma

Each transaction accumulates "karma" based on work done (number of reads, writes, or time elapsed). On conflict, the transaction with less karma aborts. This favours transactions that have invested more work, reducing total wasted computation:

```
T1 (karma=50, long-running) vs T2 (karma=5, just started)
→ T2 aborts. T1 keeps its progress.
```

### Timestamp / Age Priority

Older transactions (lower start timestamp) win conflicts. This prevents starvation — a transaction that keeps getting aborted eventually becomes the oldest and wins every conflict. Clojure's STM uses a variant of this: transactions track their "barge" threshold and will forcibly abort younger conflicting transactions after enough retries.

### Greedy

A two-phase strategy: transactions are initially passive (will abort on conflict), then become greedy after enough aborts (will force the other transaction to abort). This provides good throughput under low contention (passive phase) and starvation-freedom under high contention (greedy phase).

## Adaptive Contention Management

Production STM runtimes often adapt dynamically. The runtime tracks conflict rates per TVar or per transaction and switches strategies:

- Low contention → aggressive (minimal overhead)
- Medium contention → polite with backoff
- High contention → priority-based (karma or timestamp)

Some research systems (ASTM, PhTM) use machine-learning classifiers to predict the optimal strategy based on recent conflict history.

## Contention Reduction Techniques

Better than managing contention is reducing it:

- **Smaller transactions.** Fewer reads/writes = smaller conflict window = fewer aborts.
- **Commutative operations.** Clojure's `commute` eliminates conflicts for operations where order doesn't matter (counters, set-adds).
- **Partitioned state.** Split a hot TVar into N TVars (e.g., a striped counter), each accessed by a subset of threads. Merge at read time.
- **Read-only fast path.** Read-only transactions in MVCC systems commit without validation — they read from a consistent snapshot and cannot conflict.

## Livelock

The pathological failure mode. Two transactions repeatedly conflict, abort each other, retry simultaneously, and conflict again. Randomised backoff is the standard fix, but it doesn't guarantee termination. Timestamp priority does guarantee termination — the older transaction always wins, so at least one transaction commits per conflict cycle.

## Measuring Contention

The key metrics: abort rate (fraction of transactions that abort before committing), retry amplification (average number of attempts per committed transaction), and wasted work (CPU time spent on aborted transactions). An abort rate above 20% indicates that the workload has outgrown the contention manager — restructuring the transaction granularity or data layout is usually more effective than switching strategies.
