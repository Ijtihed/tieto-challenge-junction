---
id: "otp-gen-statem"
paradigm: otp
title: "State Machine Behaviour (gen_statem)"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/gen-statem"
---

# State Machine Behaviour (gen_statem)

`gen_statem` is OTP's state machine behaviour, replacing the older `gen_fsm`. It models processes whose behaviour changes based on their current state — connection protocols, workflow engines, device controllers, and any system with a well-defined lifecycle.

## When to Use gen_statem Over GenServer

Use `gen_statem` when your process has discrete states with different message-handling logic per state. If your GenServer's `handle_call` starts with a case statement on a `:state` field in the process state, you should be using `gen_statem`.

GenServer with ad-hoc state tracking is error-prone: nothing prevents handling a `:disconnect` message when you're already in `:disconnected`. `gen_statem` makes illegal state transitions a structural impossibility.

## Callback Modes

`gen_statem` supports two callback modes:

**state_functions** — each state is a separate function. Clear, readable, and the right default:

```erlang
-behaviour(gen_statem).

callback_mode() -> state_functions.

disconnected(cast, connect, Data) ->
    {next_state, connecting, Data, [{state_timeout, 5000, timeout}]};
disconnected(cast, _, Data) ->
    {keep_state, Data}.

connecting(cast, {connected, Socket}, Data) ->
    {next_state, connected, Data#{socket => Socket}};
connecting(state_timeout, timeout, Data) ->
    {next_state, disconnected, Data}.

connected(cast, disconnect, Data) ->
    {next_state, disconnected, maps:remove(socket, Data)}.
```

**handle_event_function** — a single callback handles all states. Use when states share substantial logic or when states are dynamic (e.g., states are data-driven, not known at compile time):

```erlang
callback_mode() -> handle_event_function.

handle_event(cast, Event, State, Data) ->
    case {State, Event} of
        {disconnected, connect} -> {next_state, connecting, Data};
        {connecting, {connected, S}} -> {next_state, connected, Data#{socket => S}};
        _ -> {keep_state, Data}
    end.
```

## State Timeouts vs Event Timeouts vs Generic Timeouts

`gen_statem` offers three timeout types, each with distinct semantics:

- **state_timeout** — fires if the machine stays in the current state for the specified duration. Automatically cancelled on state transition. Use for "if we haven't connected within 5s, give up."
- **event_timeout** (plain `timeout`) — fires if no event arrives within the duration. Reset by any incoming event. Use for idle detection.
- **generic_timeout** (`{{timeout, Name}, Duration, Msg}`) — named timers that persist across state transitions. Use for absolute deadlines ("this transaction must complete within 30s regardless of state changes").

## Actions

State transitions can return actions: `{:reply, From, Reply}`, `{:state_timeout, Ms, Msg}`, `:postpone`, and `{:next_event, Type, Content}`.

**Postpone** is powerful: it keeps the current event in the mailbox and re-processes it in the next state. Use it when a message arrives too early — e.g., a data packet arrives while still in the `authenticating` state. Without postpone, you'd need to buffer manually.

## Architectural Decisions

**State explosion** is the primary risk. If you have N states and M event types, you potentially need N×M handlers. Mitigate by grouping related states (e.g., all "active" substates share a common handler) or by using `handle_event_function` mode with pattern matching.

**Testing**: test state machines by driving events and asserting state transitions. Use `sys:get_state/1` in tests to inspect the current state. Property-based testing with state machine models (PropEr's `proper_statem`) is the gold standard for finding edge cases in transition logic.
