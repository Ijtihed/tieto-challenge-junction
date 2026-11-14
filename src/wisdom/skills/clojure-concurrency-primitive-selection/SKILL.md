# Clojure Concurrency Primitive Selection

Choose between atoms, refs, agents, and channels for concurrent state management.

## When to use

- Designing concurrent state management in Clojure or applying the same decision framework to other languages
- Choosing between optimistic and pessimistic concurrency for a shared-state problem
- Evaluating whether your concurrency model is too complex (using refs when atoms suffice)
- Reviewing existing concurrent code for primitive misuse

## Steps

1. **Count the coordination points.** How many pieces of state must change together atomically? This is the primary selector:
   - **One piece of state, independent updates → Atom.** `swap!` applies a pure function to the current value using CAS (compare-and-swap). No coordination with other state. Use for counters, caches, config maps.
   - **Multiple pieces of state, coordinated updates → Ref + STM.** `dosync` wraps multiple `alter` calls in a transaction. The runtime retries on conflict. Use for bank transfers, inventory + order state, any multi-variable invariant.
   - **One piece of state, asynchronous updates → Agent.** `send` queues a function to run later on a thread pool. Order is guaranteed per-agent but execution is async. Use for logging, metrics accumulation, non-urgent writes.
   - **Communication between independent processes → core.async channels.** `>!` and `<!` pass values between goroutines. Use for pipelines, event streams, producer-consumer patterns.

2. **Apply the decision tree.**
   - Is it a single independent value? → **Atom.**
   - Must multiple values change atomically? → **Ref.**
   - Can the update happen later? → **Agent.**
   - Are you passing data between concurrent processes? → **Channel.**
   - None of the above? → You might not need concurrency primitives at all. A pure function with no shared state is the simplest concurrency model.

3. **Validate contention assumptions.** Atoms retry on CAS failure. Refs retry entire transactions. If contention is high (many writers, frequent conflicts), measure retry rates. More than 5% retries under normal load means you need to either reduce contention (partition the state) or switch primitives.

4. **Check for primitive escalation.** If you started with an atom but added a `dosync` around it, you needed a ref from the start. If you have agents coordinating with each other via watches, you probably need channels. Escalation isn't wrong — but recognize it and migrate cleanly.

## Anti-patterns

- Using refs when atoms suffice (STM overhead for no coordination benefit)
- Coordinating agents with watches and callbacks instead of using channels (implicit coupling, hard to debug)
- Putting side effects inside `swap!` or `alter` (these functions can retry — side effects will execute multiple times)
- Using locks alongside STM (defeats the purpose; STM handles contention internally)

## Example

A real-time dashboard tracks per-user session counts (atom — independent per-user counters), a global rate limiter with quota + window state (ref — two values that must update atomically), a background audit logger (agent — writes can happen asynchronously), and a WebSocket event pipeline (core.async channel — fan-out from one producer to N consumers). Each primitive is chosen by the shape of the coordination, not by habit.
