---
id: "otp-application-structure"
paradigm: otp
title: "OTP Application Structure"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/otp/application-structure"
---

# OTP Application Structure

An OTP application is the unit of deployment, configuration, and lifecycle management on the BEAM. It is not a library — it is a component with a start/stop lifecycle, its own supervision tree, and declared dependencies on other applications.

## The .app File

Every OTP application has an `.app` file (or in Elixir, this is generated from `mix.exs`). It declares:

```erlang
{application, my_app, [
    {description, "My service"},
    {vsn, "1.0.0"},
    {modules, [my_app_sup, my_app_server, my_app_worker]},
    {registered, [my_app_server]},
    {applications, [kernel, stdlib, cowboy]},
    {mod, {my_app_app, []}},
    {env, [{pool_size, 10}, {timeout, 5000}]}
]}.
```

The `applications` key is load-bearing: it defines the boot order. If your app lists `cowboy` as a dependency, the BEAM guarantees cowboy is started before your app's `start/2` callback fires. Getting this list wrong causes race conditions that only surface under specific boot orderings in production.

## Application Callback Module

The `mod` tuple points to a module implementing the `application` behaviour. Its `start/2` function returns the PID of the top-level supervisor:

```elixir
defmodule MyApp.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {MyApp.Repo, []},
      {MyApp.Cache, []},
      {MyApp.Endpoint, []}
    ]
    Supervisor.start_link(children, strategy: :one_for_one, name: MyApp.Supervisor)
  end
end
```

The child list order matters when using `:rest_for_one` strategy: `Repo` starts first, `Cache` second, `Endpoint` last. If `Repo` crashes, everything after it restarts.

## Environment and Configuration

`Application.get_env/3` reads from the app's environment, which is set in the `.app` file and can be overridden at runtime. In Elixir releases, `config/runtime.exs` runs at boot and can read OS environment variables.

Architectural decision: configuration that varies per deployment (database URL, API keys) belongs in runtime config. Configuration that is structural (pool sizes, timeout ceilings) can live in compile-time config but should have sane defaults in the `.app` file.

Anti-pattern: reading `Application.get_env` at compile time (in module attributes or macros). This bakes deployment-specific values into the compiled bytecode, breaking the "build once, deploy anywhere" principle.

## Umbrella vs Poncho vs Monolith

**Umbrella apps** group multiple OTP applications under one repository with shared configuration. They enforce boundary discipline through application dependencies but add complexity in release configuration and test isolation.

**Poncho projects** are separate Mix projects in subdirectories with path dependencies. They give cleaner separation than umbrellas but require more manual coordination.

**Single application** is correct for most systems until you have a clear reason to split. Premature decomposition into umbrella apps creates coupling through shared config that is harder to untangle than a well-structured single app.

## Library Applications vs Regular Applications

A library application has no supervision tree — it provides modules but does not start processes. It omits the `mod` key from the `.app` file. JSON parsers, crypto wrappers, and utility libraries are library applications. The distinction matters: `Application.ensure_all_started/1` is a no-op for library applications, and including them in `:extra_applications` instead of `:applications` signals intent correctly.
