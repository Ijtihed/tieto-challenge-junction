---
id: "distsys-distributed-tracing"
paradigm: distsys
title: "Distributed Tracing"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/distributed-tracing"
---

# Distributed Tracing

When a user request traverses 15 services, and the response is slow, which service is the bottleneck? Logs tell you what happened in each service. Metrics tell you aggregate behavior. Traces tell you what happened to this specific request across all services. Distributed tracing reconstructs the causal chain of a request's journey through a distributed system.

## Core Concepts

**Trace.** A trace represents the end-to-end journey of a single request. It's identified by a globally unique trace ID.

**Span.** A span is a named, timed operation within a trace — an HTTP handler, a database query, a message publish. Each span has a span ID, a parent span ID (linking it to the span that caused it), a start timestamp, a duration, and key-value attributes (tags).

**Context propagation.** The trace ID and parent span ID must be passed between services on every call. For HTTP, this is typically via headers (`traceparent` in W3C Trace Context, or `x-b3-*` in Zipkin's B3 format). For gRPC, it's metadata. For message queues, it's message headers. If any service in the chain fails to propagate context, the trace is broken — you get disconnected fragments instead of a complete picture.

## OpenTelemetry

OpenTelemetry (OTel) is the converged standard, merging OpenTracing and OpenCensus. It provides: SDKs for instrumentation (auto-instrumentation for popular frameworks, plus manual span creation APIs), the OTLP wire protocol for exporting telemetry data, and a Collector — a standalone process that receives, processes, and exports traces to backends (Jaeger, Tempo, Datadog, Honeycomb).

Auto-instrumentation covers HTTP clients/servers, database drivers, gRPC, and message queue clients in most languages. It creates spans automatically for outbound calls, inbound requests, and database queries. Manual instrumentation is needed for business-logic spans (e.g., "validate order" or "compute shipping cost") that give traces semantic meaning.

## Sampling

At high request volumes, tracing every request is prohibitively expensive. Sampling strategies:

**Head-based sampling.** Decide at the entry point whether to trace this request (e.g., 1% sampling rate). Simple, but you'll miss interesting traces — the one request that took 30 seconds wasn't in the 1%.

**Tail-based sampling.** Collect all spans, and at the collector level, decide which traces to keep based on the complete trace (e.g., keep all traces with errors, keep all traces slower than P99, keep 1% of normal traces). More expensive (you buffer all spans temporarily) but catches the interesting traces.

**Adaptive sampling.** Dynamically adjust the sampling rate based on traffic volume. At low traffic, sample everything. At high traffic, reduce to maintain a target span-per-second budget.

## Practical Patterns

**Trace-based testing.** Use traces in integration tests to assert on the call graph. If the trace for "create order" doesn't include a span for "check inventory," the test fails — you've caught a missing dependency at test time.

**Trace-driven alerting.** Alert when the P99 span duration for a specific operation exceeds a threshold, or when the trace topology changes unexpectedly (a new downstream dependency appears).

**Exemplars.** Link metrics to traces. When a metric shows a latency spike, the exemplar points to a specific trace ID that experienced it. Prometheus + Grafana Tempo support this workflow.

## Failure Scenario

A payment service calls a fraud-detection service, which calls a feature-flag service. The feature-flag service is slow (disk I/O contention). Without tracing, the payment team sees "payment latency increased by 400ms" in their metrics but can't pinpoint the cause. They investigate their own database, their own code, and find nothing. With distributed tracing, they pull up a slow trace, see the fraud-detection span, drill into it, and see the feature-flag span taking 380ms. Root cause identified in minutes instead of hours.

Another failure mode: context propagation is broken in one service (a middleware upgrade dropped the `traceparent` header). All traces passing through that service appear as two disconnected fragments. The symptom is subtle — no errors, no missing data, just incomplete traces that are hard to correlate. Monitoring trace completeness (what percentage of traces have leaf spans from the expected services) catches this.

## Decision Criteria

Implement distributed tracing when you have more than 3 services in a request path. Use OpenTelemetry — it's the industry standard. Start with auto-instrumentation and head-based sampling. Add tail-based sampling when you need to catch outlier traces. Invest in context propagation correctness as a first-class concern — a broken propagation chain negates the entire system's value.
