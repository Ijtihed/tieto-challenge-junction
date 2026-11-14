# Erlang/OTP Supervision Trees

Design supervisor hierarchies for fault-tolerant actor systems.

## When to use

- Building concurrent systems with worker processes that can fail independently
- Applying the supervision pattern to microservice orchestration or task pipelines
- Deciding restart strategies for a system where partial failure is acceptable but total failure is not
- Reviewing an existing supervisor tree for structural problems (e.g., a single supervisor with 50 children)

## Steps

1. **Identify failure domains.** Group workers by shared failure fate. Workers that fail together (shared resource, shared connection) belong under the same supervisor. Workers that fail independently belong under separate supervisors.
2. **Choose restart strategy per supervisor.**
   - `one_for_one`: independent workers — one crashes, only it restarts. Default choice.
   - `one_for_all`: coupled workers — one crashes, all restart. Use when workers share state that becomes inconsistent on partial failure.
   - `rest_for_one`: ordered dependencies — one crashes, it and all workers started after it restart. Use for pipelines.
3. **Set restart intensity.** `max_restarts` over `max_seconds` defines the circuit breaker. Too lenient (100 restarts / 1 second) and you spin; too strict (1 restart / 60 seconds) and transient errors kill the subtree. Start with 3 restarts / 5 seconds and tune from production data.
4. **Design the tree top-down.** The application supervisor at the root has one child per subsystem. Each subsystem supervisor owns its workers. Never go deeper than 3 levels without a strong reason — depth adds latency to restart propagation.
5. **Handle initialization order.** Children start in list order. If worker B depends on worker A, A must appear first. If the dependency is bidirectional, you have a design problem — break the cycle.
6. **Define child shutdown.** Transient workers use `temporary` (don't restart on normal exit). Persistent services use `permanent`. Use `transient` only when you can distinguish expected exit from crash.

## Anti-patterns

- One flat supervisor with 30+ children (a crash in any child triggers complex restart logic; split into subsystem supervisors)
- Using `one_for_all` as a default (unnecessary restarts destroy in-flight work)
- Supervisors that do work (a supervisor's only job is to start, stop, and restart children — no business logic)
- Restart loops without backoff (a failing worker that restarts instantly will consume all CPU before the intensity limit trips)

## Example

A chat application has three subsystems: connection management, message routing, and presence tracking. The root supervisor uses `one_for_one` with three child supervisors. The connection supervisor uses `one_for_one` — each TCP acceptor is independent. The message router uses `one_for_all` because its workers share a routing table that must be rebuilt atomically. The presence tracker uses `rest_for_one` because the heartbeat monitor must start before the presence aggregator. If the message router crashes, only routing restarts — connections and presence are unaffected.
