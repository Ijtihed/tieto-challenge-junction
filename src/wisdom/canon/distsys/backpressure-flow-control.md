---
id: "distsys-backpressure-flow-control"
paradigm: distsys
title: "Back-Pressure and Flow Control in Distributed Pipelines"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/backpressure-flow-control"
---

# Back-Pressure and Flow Control in Distributed Pipelines

When a producer generates data faster than a consumer can process it, something has to give. Without explicit flow control, the default behavior is unbounded queue growth, leading to memory exhaustion, increased latency, and eventual system failure. Back-pressure is the mechanism by which a slow consumer signals the producer to slow down.

## The Core Problem

Consider a three-stage pipeline: ingestion → processing → storage. If processing can handle 10,000 events/second but storage can only write 5,000/second, the buffer between processing and storage grows at 5,000 events/second. In 10 minutes, that's 3 million events buffered in memory. OOM kills follow. The system didn't fail because of a bug — it failed because the implicit contract between stages was "infinite buffer speed," which is never true.

## Back-Pressure Strategies

**Drop.** When the buffer is full, drop new events. Appropriate for metrics, telemetry, and sampled data where losing individual data points is acceptable. StatsD uses this approach — UDP datagrams are silently dropped under load. Simple and effective, but inappropriate when every event matters.

**Block.** The producer blocks (synchronously waits) when the consumer's buffer is full. TCP flow control works this way: the receiver's window size limits how much the sender can transmit. This propagates back-pressure transitively through the pipeline. The risk is head-of-line blocking: one slow consumer stalls the entire producer, even for other consumers.

**Rate-limit.** The producer actively limits its emission rate to match the consumer's capacity. This can be static (configured rate limit) or dynamic (the consumer advertises its current capacity). Dynamic rate-limiting is more complex but adapts to varying consumer throughput. Token bucket and leaky bucket are the standard algorithms.

**Reactive Streams / async pull.** The consumer requests N items at a time (demand signaling). The producer only sends when there's outstanding demand. This is the model used by Reactive Streams (Java), Akka Streams, and Project Reactor. It provides end-to-end back-pressure without blocking threads — the producer simply stops producing when demand is exhausted.

## TCP as the Hidden Back-Pressure Layer

Many distributed systems accidentally rely on TCP for back-pressure. When a consumer stops reading from a socket, the receive buffer fills, the TCP window closes, and the sender blocks on `write()`. This works, but it's invisible to the application — there's no metric, no alert, no way to distinguish "the consumer is slow" from "the network is slow." Explicit application-level back-pressure (gRPC flow control, Kafka consumer lag monitoring) gives you observability.

## Kafka's Model

Kafka decouples producers and consumers via a persistent log. Producers write at their rate; consumers read at theirs. The "buffer" is disk, not memory, so it can absorb hours of lag without memory pressure. Back-pressure manifests as consumer lag — the growing delta between the latest offset and the consumer's committed offset. You monitor lag and scale consumers horizontally when it grows.

This is back-pressure via storage rather than signaling. The tradeoff: you need disk capacity proportional to your maximum acceptable lag window, and consumers that fall too far behind may read cold data from disk rather than hot data from page cache, creating a latency cliff.

## Failure Scenario

A microservice ingests webhook events from a third-party API into a processing pipeline. A downstream database goes slow (disk contention). Without back-pressure, the service buffers events in memory, eventually OOMs, and restarts. On restart, it re-fetches unacknowledged webhooks, which pile up again. The fix: bounded in-memory queues with blocking enqueue, combined with HTTP 429 responses to the webhook sender when the queue is full. The third-party retries with exponential backoff, and the system degrades gracefully instead of crashing cyclically.

## Decision Criteria

Choose drop-based back-pressure for lossy data streams (metrics, sampling). Choose blocking/demand-based for transactional pipelines where every event matters. Use Kafka-style log-based decoupling when producers and consumers have fundamentally different throughput profiles and you need temporal decoupling (hours of lag tolerance). Always instrument buffer depth and consumer lag as primary alerts.
