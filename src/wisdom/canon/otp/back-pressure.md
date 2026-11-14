---
id: "otp-back-pressure"
paradigm: otp
title: "Back-Pressure Patterns in BEAM"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/back-pressure"
---

# Back-Pressure Patterns in BEAM

The BEAM's mailbox-per-process model gives you unbounded buffers by default. Every process has a mailbox that grows without limit. When a producer sends faster than a consumer can process, the consumer's mailbox grows, memory usage climbs, and eventually the VM crashes with an out-of-memory error or the process becomes unresponsive because garbage collection time is proportional to heap size.

Back-pressure is not built into OTP's messaging primitives. You must design it into your architecture.

## Synchronous Calls as Natural Back-Pressure

The simplest back-pressure mechanism is `GenServer.call/2`. The caller blocks until the server replies, which means the caller cannot send faster than the server can handle. This is rate-limiting by construction.

```elixir
# Producer can't outpace consumer — call blocks until reply
:ok = GenServer.call(consumer, {:process, item})
```

The trade-off is latency: if the server is slow, all callers block. For many systems, this is acceptable and preferable to the alternative of unbounded queues.

## Mailbox Monitoring

When asynchronous messaging is required, monitor the consumer's mailbox length and shed load when it exceeds a threshold:

```erlang
check_pressure(Pid) ->
    {message_queue_len, Len} = process_info(Pid, message_queue_len),
    case Len > 1000 of
        true -> {error, overloaded};
        false -> ok
    end.
```

This is reactive, not preventive. By the time you detect a large mailbox, you're already behind. Use it as a circuit breaker, not a primary flow-control mechanism.

## Demand-Driven Flow (GenStage / Broadway)

GenStage (and its production wrapper Broadway) implement demand-driven flow control. Consumers request a specific number of events from producers. Producers only emit what was requested. The pipeline never has more in-flight work than the slowest stage can handle.

```elixir
defmodule MyProducer do
  use GenStage

  def handle_demand(demand, state) do
    events = fetch_batch(state, demand)
    {:noreply, events, state}
  end
end

defmodule MyConsumer do
  use GenStage

  def init(_) do
    {:consumer, %{}, subscribe_to: [{MyProducer, max_demand: 50, min_demand: 10}]}
  end

  def handle_events(events, _from, state) do
    process(events)
    {:noreply, [], state}
  end
end
```

`max_demand` and `min_demand` control batch sizes and re-subscription thresholds. The consumer asks for up to `max_demand` events and re-asks when its pending count drops to `min_demand`.

## Bounded Queues and Shedding Strategies

For systems that need buffering but not unbounded growth:

- **Drop newest**: reject incoming messages when the buffer is full. Good for real-time data where stale is useless (metrics, telemetry).
- **Drop oldest**: evict the oldest buffered message. Good for status updates where only the latest matters.
- **Block producer**: use synchronous calls or explicit ack protocols. Good for transactional work that must not be lost.

## Pool-Based Back-Pressure

Connection pools (Poolboy, NimblePool, DBConnection) are implicit back-pressure. A pool of N workers means at most N concurrent operations. Callers beyond N either block (bounded wait) or receive `{:error, :pool_full}` (load shedding).

```elixir
NimblePool.checkout!(pool, :checkout, fn _from, worker ->
    {result, worker} = do_work(worker)
    {result, worker}
end)
```

## Architectural Decision

The key question: **what happens when demand exceeds capacity?** You have three choices: slow down producers (back-pressure), drop work (load shedding), or buffer and hope (unbounded queues). Only the first two are architecturally sound. The third is a production incident waiting for sufficient load.

Choose synchronous calls as the default. Move to GenStage/Broadway when you need pipelining with heterogeneous stage speeds. Add load shedding at system boundaries (HTTP handlers, message consumers) where you can return 503 or nack rather than accumulating work you cannot complete.
