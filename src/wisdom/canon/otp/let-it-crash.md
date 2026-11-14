---
id: "otp-let-it-crash"
paradigm: otp
title: "Let-It-Crash Philosophy"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/let-it-crash"
---

# Let-It-Crash Philosophy

"Let it crash" is the most misunderstood principle in BEAM engineering. It does not mean "don't handle errors." It means: separate the code that does work from the code that handles failure, and use process boundaries as the isolation mechanism.

## The Core Insight

In most languages, error handling and business logic are interleaved — every function must decide what to do when something goes wrong. In OTP, processes are cheap and isolated. A process that encounters an unexpected condition crashes (exits with a reason), and its supervisor decides what to do next. The business logic stays clean; the fault-recovery policy lives in the supervision tree.

This is not recklessness. It is a deliberate architectural separation of concerns: workers handle the happy path, supervisors handle the failure path.

## What to Crash On, What to Handle

Let-it-crash applies to *unexpected* failures — states the programmer did not anticipate or cannot meaningfully recover from within the current process context.

Handle explicitly:
- Validation errors (bad user input → return `{:error, reason}`)
- Expected failure modes (network timeout → retry with backoff)
- Business rule violations (insufficient funds → return error tuple)

Let crash:
- Corrupted process state (a GenServer whose state invariants are broken)
- Unexpected message shapes (a protocol violation from a peer)
- Resource exhaustion in a single operation (a query that blows the process heap)

```erlang
%% Explicit handling — expected case
case db:fetch(Key) of
    {ok, Value} -> process(Value);
    {error, not_found} -> default_value()
end.

%% Let-it-crash — unexpected case
%% If decode/1 returns something we didn't pattern-match,
%% the process crashes and the supervisor restarts it.
{command, Action, Payload} = decode(RawMsg),
execute(Action, Payload).
```

## Fault Isolation Through Process Boundaries

The architectural power of let-it-crash depends entirely on process isolation. Each process has its own heap, its own mailbox, and its own failure mode. When a process crashes, nothing else is corrupted — no shared memory is left in an inconsistent state.

This means the granularity of your processes *is* your fault-isolation granularity. One process per connection means a crash in connection A does not affect connection B. One process per request means a poison-pill request kills only itself.

## The Restart Contract

Let-it-crash only works if restart produces a clean state. A GenServer that loads its state from a database on `init/1` can be safely restarted — it rebuilds from durable storage. A GenServer that accumulates in-memory state over hours cannot be naively restarted — the state is lost.

Design decision: if your process holds state that cannot be reconstructed, either persist it (ETS with `:named_table`, Mnesia, external store) or accept that a crash loses it. This decision should be explicit in your architecture, not discovered during an incident.

## Anti-Patterns

- **Wrapping everything in try/catch** — this defeats the purpose. You are reimplementing defensive programming inside a system designed to make it unnecessary.
- **Crashing on expected errors** — returning `{:error, reason}` is not a failure to crash; it is correct domain modeling.
- **No supervisor** — a process that crashes without a supervisor is just a bug. Let-it-crash requires the supervision tree to be in place.
