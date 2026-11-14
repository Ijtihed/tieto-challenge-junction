---
id: "otp-process-registry"
paradigm: otp
title: "Process Registry Patterns"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/process-registry"
---

# Process Registry Patterns

Every OTP system must answer: how does process A find process B? The registry pattern determines naming, discovery, and the blast radius when processes restart with new PIDs.

## Local Registration

The simplest form: `register(Name, Pid)` binds an atom to a process on the local node. GenServers accept a `{:via, module, term}` or `{:local, name}` option in `start_link`. Local registration is fast (ETS lookup under the hood) and sufficient for singleton services.

```elixir
GenServer.start_link(MyServer, arg, name: MyServer)
GenServer.call(MyServer, :ping)
```

Limitation: atom-based names are global to the node and must be unique. You cannot register 10,000 user session processes under atom names without atom table exhaustion (the default limit is ~1M atoms, and they are never garbage collected).

## Global Registration

`:global.register_name/2` registers a name across all connected nodes. It uses a distributed lock protocol — registration is eventually consistent and involves round-trips. Use it for cluster-wide singletons (e.g., a single leader process for coordination).

Architectural caution: `:global` does not handle network partitions gracefully. During a netsplit, both partitions may believe they hold the registration. If your singleton must not run in duplicate, `:global` alone is insufficient — you need a consensus mechanism or an external lock.

## Custom Registries

For dynamic, high-cardinality process groups, use a custom registry. Elixir's built-in `Registry` module is the standard choice:

```elixir
# In your supervision tree
{Registry, keys: :unique, name: MyApp.Registry}

# Starting a process with a registry key
GenServer.start_link(Worker, arg,
  name: {:via, Registry, {MyApp.Registry, user_id}})

# Looking up
GenServer.call({:via, Registry, {MyApp.Registry, user_id}}, :get_state)
```

`Registry` supports `:unique` (one process per key) and `:duplicate` (pub-sub, multiple processes per key) modes. It is backed by partitioned ETS tables for concurrent read performance.

## Registry vs Direct PID References

Holding a raw PID is fragile: when the target process restarts, the PID changes and your reference is stale. A registry lookup always returns the current PID (or signals that the process is not registered). The trade-off is an extra lookup per call.

Design rule: use direct PIDs only within a supervision subtree where the parent controls the lifecycle. Across subsystem boundaries, always go through a registry or a named process.

## Architectural Decisions

**Partition key choice** matters for registries. Keying user sessions by `user_id` gives O(1) lookup but means one process per user. Keying by `{user_id, session_id}` supports multiple sessions. The key schema determines your concurrency model.

**Registry scope** determines failure domain. A local registry dies with its node. If you need cross-node discovery, consider `pg` (process groups) for pub-sub patterns or a service-discovery layer (e.g., Consul, DNS) for inter-service communication.

**Process group (`pg`) vs Registry**: `pg` is designed for multi-node pub-sub — multiple processes join a group, and you can broadcast to all members. `Registry` in `:duplicate` mode is the local-node equivalent. Choose `pg` when you need cluster-wide group membership.
