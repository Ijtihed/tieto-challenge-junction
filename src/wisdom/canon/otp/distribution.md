---
id: "otp-distribution"
paradigm: otp
title: "Erlang Distribution and Clustering"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/distribution"
---

# Erlang Distribution and Clustering

Erlang distribution is the built-in mechanism for connecting BEAM nodes into a cluster where processes communicate transparently across node boundaries. It is a powerful primitive that is often misused as a networking layer for distributed systems it was not designed to support.

## How Distribution Works

Each node runs `epmd` (Erlang Port Mapper Daemon) on port 4369, which maps node names to listening ports. When node A connects to node B, they perform a handshake using a shared cookie (a pre-shared secret), establish a TCP connection, and maintain it for the lifetime of the cluster membership.

```erlang
%% Start a named node
erl -name app@192.168.1.10 -setcookie mysecret

%% Connect to another node
net_adm:ping('app@192.168.1.11').
%% => pong

%% Send a message to a process on a remote node
{server, 'app@192.168.1.11'} ! {request, self(), Data}.
```

Once connected, message passing across nodes is syntactically identical to local message passing. `Pid ! Msg` works regardless of whether `Pid` is local or remote. This location transparency is the core value proposition — and the core trap.

## What Distribution Is Good For

- **Clustering homogeneous BEAM nodes** running the same application (e.g., Phoenix nodes sharing PubSub, Erlang nodes running distributed Mnesia).
- **Short-lived coordination** between nodes that trust each other and share a deployment boundary.
- **Failover and takeover** via OTP's distributed application controller, where a standby node takes over if the primary dies.

## What Distribution Is Bad For

- **Public-facing networking.** Distribution uses a binary protocol with no authentication beyond the cookie. Any node with the cookie has full code execution capability on every connected node via `rpc:call/4`. Never expose distribution ports to the internet.
- **Partial failure tolerance.** Distribution assumes full connectivity. In a netsplit, `:global` registrations can conflict, Mnesia can enter split-brain, and `pg` group membership diverges. The BEAM's distribution layer has no built-in partition tolerance — you must add it at the application level.
- **Heterogeneous services.** Connecting a Python service to an Erlang cluster via distribution is technically possible (see Pyrlang) but fragile. Use HTTP, gRPC, or message queues for cross-runtime communication.

## net_kernel and Node Management

`net_kernel` controls node connectivity. Key functions:

- `net_kernel:connect_node/1` — explicitly connect to a node.
- `net_kernel:monitor_nodes/1` — subscribe to `{nodeup, Node}` and `{nodedown, Node}` messages. Essential for reacting to cluster membership changes.
- `net_kernel:set_net_ticktime/1` — controls heartbeat frequency. The default (60s) means a dead node isn't detected for up to two tick periods. Lower it for faster failure detection at the cost of more network traffic.

## Architectural Decisions

**Mesh vs Hub.** By default, Erlang forms a full mesh — every node connects to every other node. This does not scale beyond ~50-100 nodes due to O(n²) connections and heartbeat traffic. For larger clusters, use `connect_all: false` and manage topology manually, or use a library like `partisan` for partial connectivity.

**Hidden nodes** (`-hidden` flag) connect to the cluster without joining the mesh. Useful for monitoring or administration nodes that should observe but not participate in distributed protocols.

**Libcluster** (Elixir) automates cluster formation via DNS, Kubernetes API, or multicast. It solves the bootstrap problem — how do nodes find each other — but does not solve the distributed-state problem.

The fundamental question: do you need Erlang distribution, or do you need a message broker? If your nodes share mutable state, you need consensus, not distribution. If they're stateless workers behind a load balancer, you may not need distribution at all.
