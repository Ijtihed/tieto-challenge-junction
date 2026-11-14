---
id: "distsys-circuit-breaker"
paradigm: distsys
title: "Circuit Breaker, Bulkhead, and Retry with Jitter"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/circuit-breaker"
---

# Circuit Breaker, Bulkhead, and Retry with Jitter

Distributed systems fail partially — one downstream service degrades while others remain healthy. Without isolation patterns, a single slow dependency can cascade failure through the entire system by exhausting connection pools, thread pools, and timeouts. Circuit breakers, bulkheads, and disciplined retry are the core patterns for preventing this cascade.

## Circuit Breaker

The circuit breaker pattern monitors calls to a downstream service and trips (opens) when failures exceed a threshold. In the open state, all calls fail immediately without contacting the downstream — fast failure instead of slow timeout. After a configured cooldown period, the breaker enters half-open state and allows a small number of probe requests through. If probes succeed, the breaker closes (normal operation resumes). If probes fail, it re-opens.

The three states: **Closed** (normal — all requests pass through, failures are counted), **Open** (failing fast — no requests reach downstream, the caller gets an immediate error or fallback), **Half-Open** (testing recovery — limited requests pass through to check if downstream has recovered).

Key tuning parameters: the failure threshold (e.g., 50% of requests in a 10-second window), the open duration (how long to wait before probing), and the half-open probe count. Netflix's Hystrix popularized this pattern; modern implementations include resilience4j (Java), Polly (.NET), and gobreaker (Go).

## Bulkhead

Named after ship compartments that prevent a hull breach from flooding the entire vessel. A bulkhead isolates resource pools per dependency. Instead of one shared thread pool for all outbound calls, each downstream service gets its own bounded pool. When the payment service is slow and its pool is exhausted, calls to the inventory service continue unaffected.

Implementation: dedicated thread pools (Hystrix-style), semaphore-based concurrency limits, or separate connection pools per downstream. The tradeoff is resource efficiency — dedicated pools mean you provision for peak per-dependency rather than peak aggregate. In practice, the wasted capacity is a small price for preventing cascading failures.

## Retry with Jitter

Retries are essential (networks are unreliable) but dangerous (retries can amplify overload). When a service returns errors under load and all clients retry simultaneously, the retry storm adds load proportional to `clients × retry_count`, potentially turning a brief overload into a sustained outage.

**Exponential backoff** spaces retries exponentially: 1s, 2s, 4s, 8s. This reduces retry pressure over time but doesn't prevent thundering herds — if 1000 clients all start retrying at the same time, they'll retry in lockstep.

**Jitter** adds randomness to the backoff interval. Full jitter: `sleep = random(0, base × 2^attempt)`. Equal jitter: `sleep = base × 2^attempt / 2 + random(0, base × 2^attempt / 2)`. Decorrelated jitter: `sleep = random(base, previous_sleep × 3)`. AWS's analysis showed decorrelated jitter provides the best retry distribution, minimizing total completion time while avoiding clustered retry bursts.

**Retry budgets** cap the total proportion of retries across all clients. Instead of each client independently deciding to retry, the system tracks retry rate as a percentage of total requests. When retries exceed the budget (e.g., 10% of total traffic), additional retries are suppressed. Google's SRE practices use retry budgets extensively.

## Failure Scenario

A checkout service calls three downstream services: payment, inventory, and notifications. Payment becomes slow (responding in 30 seconds instead of 200ms). Without a circuit breaker or bulkhead, the checkout service's thread pool fills with threads waiting on payment responses. New checkout requests — including those that only need inventory — can't get a thread and timeout. Users see "checkout unavailable" even though inventory and notifications are healthy. With a bulkhead (separate pool for payment calls) and a circuit breaker (trips after 5 consecutive timeouts), payment calls fail fast after ~10 seconds, and checkout continues to work for the non-payment path while returning a "payment temporarily unavailable" error.

## Decision Criteria

Apply circuit breakers to every inter-service call where slow failure is worse than fast failure (which is almost always). Apply bulkheads when a single service has multiple independent downstream dependencies. Always use jittered exponential backoff for retries. Implement retry budgets when you operate at scale where the aggregate retry load can become a significant fraction of total traffic.
