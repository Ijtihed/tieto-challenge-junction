---
id: "otp-supervision-principles"
paradigm: otp
title: "OTP Supervision Trees"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/supervision-principles"
---

# OTP Supervision Trees

Supervision trees are the primary architectural primitive for fault tolerance in OTP. A supervisor is a process whose only job is to start, monitor, and restart child processes according to a declared strategy. Every production OTP system is a tree of supervisors with workers at the leaves.

## Supervision Strategies

The strategy determines what happens when a child dies:

- **one_for_one** — Only the crashed child restarts. Use when children are independent. This is the default and the most common choice.
- **one_for_all** — All children restart when any one crashes. Use when children share coupled state that becomes inconsistent if one dies (e.g., a producer and its consumer that share an ETS table).
- **rest_for_one** — The crashed child and all children started *after* it restart. Use for ordered dependency chains where later children depend on earlier ones.

```erlang
init([]) ->
    SupFlags = #{
        strategy => one_for_one,
        intensity => 5,     % max 5 restarts
        period => 60        % within 60 seconds
    },
    Children = [
        #{id => cache,
          start => {cache_server, start_link, []},
          restart => permanent,
          type => worker}
    ],
    {ok, {SupFlags, Children}}.
```

## Child Spec Decisions

Every child spec encodes an architectural decision via its `restart` value:

- **permanent** — Always restart. For long-lived stateful services.
- **transient** — Restart only on abnormal exit. For task-like processes that are expected to terminate normally.
- **temporary** — Never restart. For one-shot operations.

The `shutdown` value matters for graceful teardown. Workers default to 5000ms; supervisors should use `infinity` so they can cascade shutdown to their own children. Setting a tight shutdown on a worker that flushes to disk is a data-loss bug.

## Intensity and Period

The `intensity`/`period` pair is the circuit breaker. If a child crashes more than `intensity` times within `period` seconds, the supervisor itself crashes, escalating the failure upward. This prevents infinite restart loops. Tuning this pair is an architectural decision: too lenient and a poison-pill message will burn CPU in a restart loop; too strict and a transient network blip kills an entire subtree.

## Tree Shape Decisions

Flat trees (one supervisor, many workers) are simple but coarse: a high restart intensity is needed, and the blast radius of `one_for_all` is the entire application. Deep trees isolate failure domains — a database-connection pool under its own supervisor can crash and restart without touching the HTTP acceptor pool.

The key design question: **what is your failure domain?** Group processes under a supervisor when they should fail and recover together. Separate them when they should be isolated. The tree shape *is* your fault-tolerance architecture — it is not an implementation detail.

## Common Mistakes

Putting all workers under a single top-level supervisor with `one_for_one` is the OTP equivalent of a god object. It works until a crash in one subsystem triggers restart-intensity limits that take down unrelated subsystems. Always introduce intermediate supervisors to partition failure domains.
