---
id: "otp-testing-patterns"
paradigm: otp
title: "Testing OTP Systems"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/testing-patterns"
---

# Testing OTP Systems

Testing concurrent, stateful systems requires different strategies than testing pure functions. OTP systems have processes, supervision trees, message ordering dependencies, and timing-sensitive behaviour. The standard unit-testing mindset breaks down; you need tools and patterns designed for this model.

## Common Test (ct)

Common Test is Erlang's built-in integration test framework. It excels at testing systems with setup/teardown requirements, inter-test dependencies, and distributed scenarios.

```erlang
-module(session_SUITE).
-include_lib("common_test/include/ct.hrl").
-export([all/0, init_per_testcase/2, end_per_testcase/2]).
-export([create_session_test/1, expire_session_test/1]).

all() -> [create_session_test, expire_session_test].

init_per_testcase(_TC, Config) ->
    {ok, Pid} = session_server:start_link(),
    [{server, Pid} | Config].

end_per_testcase(_TC, Config) ->
    Pid = ?config(server, Config),
    gen_server:stop(Pid),
    Config.

create_session_test(Config) ->
    Pid = ?config(server, Config),
    {ok, Id} = session_server:create(Pid, #{user => "alice"}),
    {ok, Session} = session_server:get(Pid, Id),
    "alice" = maps:get(user, Session).
```

CT supports test groups, parallel execution, and HTML report generation. Use it for anything beyond simple unit tests — especially for tests that need controlled startup/shutdown sequences.

## ExUnit (Elixir)

ExUnit is Elixir's test framework. For OTP testing, the key pattern is starting supervised processes per test:

```elixir
defmodule MyServerTest do
  use ExUnit.Case, async: true

  setup do
    server = start_supervised!(MyServer)
    %{server: server}
  end

  test "handles concurrent calls", %{server: server} do
    tasks = for i <- 1..100 do
      Task.async(fn -> GenServer.call(server, {:put, i, i * 2}) end)
    end
    Task.await_many(tasks)
    assert GenServer.call(server, {:get, 50}) == 100
  end
end
```

`start_supervised!/1` links the process to the test's supervisor, guaranteeing cleanup even if the test crashes. Always use it instead of raw `start_link` in tests.

## Property-Based Testing with PropEr

PropEr (and StreamData in Elixir) generate random inputs and test properties over thousands of cases. For OTP systems, the key module is `proper_statem`, which models a process as a state machine and generates random command sequences:

```erlang
%% PropEr state machine model for a key-value store
-module(kv_statem).
-behaviour(proper_statem).

command(_State) ->
    oneof([
        {call, kv_server, put, [key(), value()]},
        {call, kv_server, get, [key()]}
    ]).

precondition(_State, _Call) -> true.

postcondition(State, {call, _, get, [Key]}, Result) ->
    Result =:= maps:get(Key, State, undefined);
postcondition(_State, _Call, _Result) -> true.

next_state(State, _Result, {call, _, put, [Key, Val]}) ->
    maps:put(Key, Val, State);
next_state(State, _Result, _Call) -> State.
```

PropEr generates sequences of `put` and `get` calls, runs them against the real server, and checks that the server's behavior matches the model. When a failure is found, PropEr *shrinks* the sequence to the minimal reproducing case. This is the gold standard for finding edge cases in stateful systems.

## Testing Supervision Trees

Test that your supervision strategy actually works:

```elixir
test "supervisor restarts crashed worker" do
  pid = GenServer.whereis(MyWorker)
  ref = Process.monitor(pid)
  Process.exit(pid, :kill)
  assert_receive {:DOWN, ^ref, :process, ^pid, :killed}

  # Wait for supervisor to restart
  :timer.sleep(100)
  new_pid = GenServer.whereis(MyWorker)
  assert new_pid != pid
  assert Process.alive?(new_pid)
end
```

## Testing Timing and Concurrency

Avoid `Process.sleep` in tests — it makes tests slow and flaky. Use `assert_receive` with timeouts, monitors, and explicit synchronization points:

```elixir
# Bad: sleeping and hoping
Process.sleep(500)
assert something_happened()

# Good: waiting for a specific message
assert_receive {:event, :completed}, 5000
```

For race conditions, property-based testing with randomized scheduling is more effective than hand-written concurrent tests. No amount of manual test cases will cover the interleaving space that PropEr explores systematically.

## Architectural Testing Decisions

Test the contracts, not the implementation. A GenServer test should verify the public API's behavior, not the internal state shape. Test supervision by actually killing processes and verifying recovery. Test distribution by starting multiple nodes in CT and verifying behavior during netsplits (use `net_kernel:disconnect/1` to simulate).
