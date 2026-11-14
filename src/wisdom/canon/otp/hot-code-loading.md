---
id: "otp-hot-code-loading"
paradigm: otp
title: "Hot Code Reloading and Release Upgrades"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/hot-code-loading"
---

# Hot Code Reloading and Release Upgrades

The BEAM supports replacing running code without stopping the system. This capability is one of the platform's headline features and one of the most dangerous to use incorrectly. Understanding the mechanism is essential; using it in production requires careful justification.

## How Code Loading Works

The BEAM maintains up to two versions of each module simultaneously: the **current** version and the **old** version. When a new version of a module is loaded, the existing current becomes old, and the new code becomes current.

Processes executing code in the old version continue running until they make a **fully qualified call** (e.g., `?MODULE:handle_call(...)` or `Module.function(args)` in Elixir). At that point, they switch to the current version. Internal calls (without the module prefix) stay on the version the process is currently running.

```erlang
%% This stays on the current code version the process entered with:
loop(State) ->
    receive
        Msg -> loop(handle(Msg, State))
    end.

%% This switches to the latest loaded version on each iteration:
loop(State) ->
    receive
        Msg -> ?MODULE:loop(handle(Msg, State))
    end.
```

If a third version is loaded while processes still run old code, those processes are **killed**. This is the hard constraint: you get exactly one version of grace period.

## OTP Behaviours and Code Change

GenServer, gen_statem, and other OTP behaviours handle hot code loading through the `code_change/3` callback:

```elixir
@impl true
def code_change(old_vsn, state, _extra) do
  new_state = migrate_state(old_vsn, state)
  {:ok, new_state}
end
```

This callback transforms the process state from the old version's shape to the new version's shape. It is called by the OTP runtime during a supervised release upgrade, after the new code is loaded but before the process resumes handling messages.

## Releases: appup and relup

For production upgrades, OTP provides the release upgrade mechanism:

- **appup** files describe how to upgrade (and downgrade) between versions of a single application: which modules to load, which processes to suspend, which `code_change` callbacks to invoke.
- **relup** files aggregate appup instructions across all applications in a release into a single upgrade script.

```erlang
%% my_app.appup
{"2.0.0",
 [{"1.0.0", [{update, my_server, {advanced, []}}]}],  %% upgrade
 [{"1.0.0", [{update, my_server, {advanced, []}}]}]   %% downgrade
}.
```

The release handler executes these instructions in order: suspend processes, load new code, call `code_change`, resume processes. If any step fails, the upgrade is rolled back.

## When to Use Hot Code Loading

**Use it for:**
- Development workflow (automatic recompilation in `iex` or `rebar3 shell`)
- Non-critical runtime patches in systems that truly cannot be restarted (telecom switches, the original use case)

**Do not use it for:**
- Regular production deployments. Rolling restarts (blue-green, canary) are simpler, safer, and better understood by operations teams. The state migration in `code_change` is a second codebase that is rarely tested and always under-specified.
- Stateless services behind a load balancer. There is no uptime benefit — drain and restart is equivalent.

## Architectural Decision

The question is not "can we hot-upgrade?" — the BEAM always can. The question is "is the engineering cost of maintaining appup files, writing code_change callbacks, and testing upgrade paths justified by the uptime requirement?" For the vast majority of systems, the answer is no. Rolling restart with graceful drain is cheaper to build and safer to operate.

Reserve hot code loading for the cases that actually need it: systems with minutes-long connection state that cannot be drained, or hard real-time requirements where even a brief restart window is unacceptable.
