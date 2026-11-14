---
id: "otp-observer-tracing"
paradigm: otp
title: "Observer, Tracing, and Production Debugging"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/observer-tracing"
---

# Observer, Tracing, and Production Debugging

The BEAM ships with introspection capabilities that most runtimes require third-party APM tools to approximate. A running production node can be attached to and inspected without restarting, redeploying, or adding instrumentation. This is a fundamental architectural advantage — but only if you know the tools.

## Observer

`:observer.start()` launches a GUI showing real-time system state: process count, memory allocation per category, scheduler utilization, ETS table sizes, and the supervision tree.

Key panels for architectural debugging:
- **Processes** tab — sort by message queue length to find overloaded processes, by reductions to find CPU-heavy processes, by memory to find leaks.
- **Applications** tab — visualize the supervision tree. Click a process to see its state, linked processes, and current function.
- **System** tab — scheduler utilization shows whether you're CPU-bound or IO-bound.

For remote nodes (production), use `:observer.start()` from a connected hidden node, or use `:observer_cli` for a terminal-based alternative that doesn't require X11 forwarding.

## Tracing with dbg

`dbg` (OTP 27+) is the modern tracing API, replacing the older `:dbg` module. It wraps the BEAM's built-in trace BIFs with a safe, composable interface.

```elixir
# Trace all calls to MyModule.handle_call/3
:dbg.tracer()
:dbg.tp(MyModule, :handle_call, 3, [])
:dbg.p(:all, :call)

# Stop tracing
:dbg.stop()
```

In Elixir, the `Kernel` module provides a more ergonomic wrapper:

```elixir
# Trace a specific function with match specs
dbg(MyModule.process(data))
```

The older `:recon_trace` (from the `recon` library) remains the production standard for many teams because it enforces rate limiting by default — a critical safety feature that `dbg` does not provide.

## Match Specifications

Match specs are the BEAM's trace filters. They let you trace only calls matching specific argument patterns, avoiding the firehose problem:

```erlang
%% Only trace calls where the first argument is {:error, _}
dbg:tp(MyModule, handle, 2, [{ [{error, '_'}, '_'], [], [{return_trace}] }]).
```

Match specs are compiled to BEAM bytecode and run at trace speed — they do not slow down the traced process. Learn the match spec syntax; it is the difference between useful production tracing and drowning in output.

## process_info and sys

For targeted inspection without tracing:

```erlang
%% Inspect a specific process
process_info(Pid, [message_queue_len, current_function, heap_size, status]).

%% Get the state of an OTP process (GenServer, gen_statem)
sys:get_state(Pid).

%% Get process statistics
sys:statistics(Pid, true),
timer:sleep(5000),
sys:statistics(Pid, get).
```

`sys:get_state/1` calls the process synchronously — if the process is stuck (e.g., in a blocking call or infinite loop), it will not respond. This is diagnostic information in itself.

## Recon for Production

The `recon` library is the standard production debugging toolkit. Key functions:

- `recon:proc_count(memory, 10)` — top 10 processes by memory.
- `recon:proc_count(message_queue_len, 10)` — top 10 by mailbox size.
- `recon:bin_leak(10)` — processes with the most binary references (common source of memory leaks on the BEAM).
- `recon:scheduler_usage(1000)` — per-scheduler utilization over a 1-second sample.

## Architectural Implications

Design your supervision tree with debuggability in mind. Named processes are easier to find than anonymous PIDs. Processes with distinct responsibilities are easier to trace than god-processes. Registry-based naming gives you both discoverability and cardinality.

Build the habit of connecting to running systems and using these tools *before* incidents. The worst time to learn `:observer` is during a production outage. Run `:recon.proc_count(message_queue_len, 5)` weekly in staging. Know what normal looks like so you can recognize abnormal.
