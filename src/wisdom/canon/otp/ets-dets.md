---
id: "otp-ets-dets"
paradigm: otp
title: "ETS and DETS for Concurrent Shared State"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/ets-dets"
---

# ETS and DETS for Concurrent Shared State

ETS (Erlang Term Storage) is an in-memory key-value store with concurrent read/write access from any process on the node. It breaks the "no shared state" rule of the actor model deliberately — and understanding when that trade-off is correct is a core architectural skill.

## When ETS Is the Right Answer

Use ETS when you need:
- High-throughput reads that would bottleneck a single GenServer
- Shared lookup tables (routing tables, configuration, feature flags)
- Caches where stale reads are acceptable
- Counters or accumulators with atomic updates via `update_counter/3`

Do not use ETS as a general-purpose database. It has no transactions, no referential integrity, and no replication. It is a concurrent hash table.

## Table Types and Access Patterns

```erlang
ets:new(sessions, [set, public, named_table, {read_concurrency, true}]).
```

- **set** — unique keys, hash-based O(1) lookup. The default and most common.
- **ordered_set** — keys sorted, range queries supported, backed by an AVL tree. Use for time-series or ordered iteration.
- **bag** — multiple rows per key, all returned on lookup.
- **duplicate_bag** — like bag, but allows fully duplicate rows.

Access modes:
- **public** — any process can read and write. Use with `read_concurrency` or `write_concurrency` flags.
- **protected** — any process reads, only the owner writes. The safe default.
- **private** — only the owner process. Rarely useful.

## Ownership and Lifecycle

An ETS table is owned by the process that created it. When that process dies, the table is deleted — all data is lost. This is the most common production surprise with ETS.

Mitigation: have a supervisor-owned process (a dedicated GenServer or the supervisor itself) own the table. Use `ets:give_away/3` or `heir` option to transfer ownership on crash:

```erlang
ets:new(cache, [named_table, public, {heir, SupervisorPid, []}]).
```

## Concurrency Flags

`{read_concurrency, true}` optimizes for read-heavy workloads by using per-scheduler read locks. `{write_concurrency, true}` allows concurrent writes to different keys. `{decentralized_counters, true}` (OTP 25+) distributes counter state across schedulers for high-throughput `update_counter` calls.

Setting both read and write concurrency is valid for mixed workloads. Profile before setting — the flags add overhead for workloads that don't benefit.

## DETS: Disk-Backed ETS

DETS persists data to disk with an ETS-like API. It is limited to 2 GB per table, has no concurrent write support, and is slow compared to ETS. Use DETS only for small, rarely-written datasets that must survive node restarts (e.g., local node configuration).

For anything larger or performance-sensitive, use Mnesia (which combines ETS speed with disk persistence and replication) or an external database.

## ETS Anti-Patterns

- **Using ETS to avoid message passing.** If two processes share an ETS table to coordinate, you have rebuilt shared mutable state and lost the fault-isolation guarantees of message passing. Prefer message passing unless profiling shows the GenServer is the bottleneck.
- **Storing large binaries.** ETS copies terms on insert and lookup (except for binaries >64 bytes, which are reference-counted). Storing many large terms bloats memory unpredictably.
- **No cleanup strategy.** ETS tables without TTL or eviction grow without bound. Implement periodic sweeps or use a bounded cache library.
