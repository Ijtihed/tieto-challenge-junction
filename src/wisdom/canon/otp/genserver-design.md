---
id: "otp-genserver-design"
paradigm: otp
title: "GenServer Design Patterns"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/genserver-design"
---

# GenServer Design Patterns

GenServer is the workhorse behaviour in OTP. It models a process with synchronous calls, asynchronous casts, and a loop that holds state. Most architectural mistakes in OTP codebases come from misusing GenServer — treating it as a class instead of a concurrency boundary.

## Call vs Cast

`call` is synchronous: the caller blocks until the server replies. `cast` is fire-and-forget. The decision between them is not about performance — it is about backpressure and error propagation.

- Use `call` when the caller needs confirmation that work completed, or when you want natural backpressure (the caller can't outpace the server).
- Use `cast` only when the caller genuinely does not care about the result *and* you have a separate mechanism for backpressure (e.g., bounded mailbox monitoring).

A common anti-pattern is using `cast` for writes to avoid latency, then discovering that the server's mailbox grows unbounded under load.

```elixir
defmodule SessionStore do
  use GenServer

  def get(pid, key), do: GenServer.call(pid, {:get, key})
  def put(pid, key, val), do: GenServer.call(pid, {:put, key, val})

  # cast variant — only if you have external backpressure
  def put_async(pid, key, val), do: GenServer.cast(pid, {:put, key, val})

  @impl true
  def handle_call({:get, key}, _from, state) do
    {:reply, Map.get(state, key), state}
  end

  def handle_call({:put, key, val}, _from, state) do
    {:reply, :ok, Map.put(state, key, val)}
  end
end
```

## Timeouts

GenServer supports two timeout mechanisms. Returning `{:noreply, state, timeout}` sets an inactivity timeout — if no message arrives within `timeout` ms, `handle_info(:timeout, state)` fires. This is useful for idle cleanup or periodic state compaction.

For periodic work, prefer `:timer.send_interval/2` or `Process.send_after/3` in `handle_info` rather than GenServer timeouts, because the timer is not reset by unrelated messages.

## State Shape Decisions

GenServer state should be a plain data structure — a map or a struct. Avoid nesting GenServer calls inside `handle_call`: if server A calls server B inside its own `handle_call`, and B calls A, you have a deadlock. This is the most common production failure in GenServer-heavy systems.

Design rule: a `handle_call` should do computation on local state and return. If it needs data from another process, restructure so the caller gathers data before calling, or use an intermediate coordinator.

## When Not to Use GenServer

GenServer is wrong when you need short-lived concurrent tasks. Use `Task` or `Task.Supervisor` for fan-out work. GenServer is wrong for pure data transformation — a regular module function is simpler and testable without process machinery.

The litmus test: does this code need to serialize access to mutable state across concurrent callers? If yes, GenServer. If no, a plain module.

## Process Bottlenecks

A single GenServer serializes all requests. Under high concurrency, it becomes a bottleneck. Solutions: partition state across multiple GenServers (sharding by key), use ETS for read-heavy workloads, or use a pool (e.g., poolboy, NimblePool) for connection-like resources.
