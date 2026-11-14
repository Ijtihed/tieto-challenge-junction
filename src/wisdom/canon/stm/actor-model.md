---
id: "stm-actor-model"
paradigm: stm
title: "Actor Model vs STM Tradeoffs"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/actor-model"
---

# Actor Model vs STM Tradeoffs

The actor model and STM represent fundamentally different approaches to concurrent state management. Actors encapsulate state behind message-passing boundaries — no shared memory, no locks. STM shares memory but makes mutations transactional. Choosing between them is an architectural decision with deep consequences.

## Actor Fundamentals

An actor is a lightweight process that owns private state and communicates exclusively via asynchronous messages. Each actor processes one message at a time, making its internal logic single-threaded:

```erlang
%% Erlang actor (process) managing a counter
counter(N) ->
    receive
        {increment, Caller} ->
            Caller ! {ok, N + 1},
            counter(N + 1);
        {get, Caller} ->
            Caller ! {value, N},
            counter(N)
    end.
```

Erlang/OTP and Akka are the canonical implementations. The model scales naturally to distributed systems — message-passing works identically across nodes.

## Where Actors Excel

**Isolation and fault tolerance.** Each actor is a failure domain. Erlang's supervisor trees restart crashed actors without affecting siblings. This "let it crash" philosophy is impossible with shared-memory STM — a transaction that corrupts a TVar's invariant poisons all transactions that read it.

**Distribution.** Actors don't assume shared memory, so moving an actor from one machine to another requires no code changes. STM is inherently single-process.

**Backpressure.** An actor's mailbox provides a natural buffering and backpressure point. When a consumer falls behind, its mailbox grows, providing a measurable signal. STM has no equivalent — contention manifests as increased retries, which is harder to monitor and control.

## Where STM Excels

**Multi-object atomicity.** Transferring money between two accounts is one `atomically` block in STM. In actors, it requires a coordination protocol:

```scala
// Akka: transfer requires a saga or two-phase protocol
accountA ! Withdraw(100, replyTo = self)
// wait for confirmation...
accountB ! Deposit(100, replyTo = self)
// handle failure of either step...
```

This is a distributed transaction reimplemented in application code. Every multi-actor coordination introduces failure modes that STM handles automatically.

**Composability.** Two STM transactions compose into a larger transaction (see `orElse` in Haskell). Two actor protocols do not compose — combining them requires designing a new protocol.

**Read consistency.** STM gives snapshot isolation across multiple variables for free. Actors require explicit request-response cycles to read consistent state from multiple actors, which introduces latency and ordering concerns.

## The Hybrid Reality

Production systems often combine both. Akka provides `STM` alongside actors for in-process shared state. Clojure uses actors (Agents) for fire-and-forget side effects and STM Refs for coordinated state. The architectural heuristic:

- **Between services or nodes:** actors (message-passing, fault isolation)
- **Within a process, coordinated state:** STM (multi-object atomicity)
- **Within a process, independent state:** atoms or single-actor encapsulation

## Mailbox Ordering Guarantees

Erlang guarantees FIFO ordering between any specific pair of actors but not across senders. Akka provides the same per-sender guarantee. Neither provides global ordering — that requires a separate consensus mechanism. STM's serialisability gives stronger ordering for the state it manages, at the cost of requiring shared memory.

## Practical Selection Criteria

Choose actors when failure isolation matters more than transactional consistency, when the system is distributed, or when the interaction pattern is naturally request-response. Choose STM when multiple pieces of state must change atomically, when composition of concurrent operations is a recurring need, or when the system is single-process and latency-sensitive.
