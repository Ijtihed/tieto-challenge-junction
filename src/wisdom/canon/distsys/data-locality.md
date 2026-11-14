---
id: "distsys-data-locality"
paradigm: distsys
title: "Data Locality, Co-Location Strategies, and Edge Computing"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/data-locality"
---

# Data Locality, Co-Location Strategies, and Edge Computing

The speed of light imposes a hard floor on latency: a round-trip from New York to London takes ~60ms at the physical limit, ~75ms in practice. No amount of optimization can fix a system that requires three cross-Atlantic round-trips per request. Data locality — placing computation near the data it needs, or placing data near the users who access it — is the fundamental strategy for latency-sensitive distributed systems.

## Compute-to-Data

When data is large and computation is small, move the computation to the data. MapReduce and Spark embody this: tasks are scheduled on the nodes that hold the relevant HDFS blocks. A 1TB scan runs locally instead of transferring 1TB over the network. The scheduler's data-locality optimization is the single largest performance factor in distributed data processing.

In database systems, pushdown predicates achieve the same goal: filter rows at the storage layer rather than shipping all rows to the query engine and filtering there. Parquet's column pruning, Cassandra's partition-key-scoped queries, and ClickHouse's primary-key-based data skipping all exploit data locality to reduce I/O.

## Data-to-Compute (Caching and Replication)

When users are geographically distributed, replicate data to where users are. CDNs cache static assets at edge PoPs. Read replicas in multiple regions serve region-local reads. DynamoDB Global Tables replicate data across regions with sub-second replication lag, allowing local reads from any region.

The challenge is writes. Reading locally is easy; writing locally while maintaining consistency requires multi-leader replication (with conflict resolution) or routing writes to a single leader (adding cross-region latency). The design decision: which data paths are read-heavy (replicate to edges) vs. write-heavy (co-locate with the primary writer)?

## Co-Location Strategies

**Tenant-pinned placement.** Pin each tenant's data and compute to a single region. All requests for that tenant route to their home region. This eliminates cross-region data access for single-tenant operations. The cost: cross-tenant operations (reports spanning all tenants) require scatter-gather across regions.

**Affinity-based scheduling.** In Kubernetes, pod affinity rules place related services on the same node or availability zone. A web server and its Redis cache on the same node communicate over loopback, eliminating network latency. Node affinity places compute on nodes with specific hardware (GPUs, NVMe drives).

**Database co-location.** CockroachDB's `ALTER TABLE ... CONFIGURE ZONE` and Spanner's placement policies let you pin table partitions to specific regions. A `users_eu` partition lives in EU data centers; `users_us` in US data centers. Queries from EU users hit local partitions; cross-region queries only happen for cross-partition joins.

## Edge Computing

Edge computing pushes computation beyond the data center to locations physically closer to users: CDN edge nodes, ISP points of presence, or on-device. Cloudflare Workers, AWS Lambda@Edge, and Deno Deploy run application logic at hundreds of global locations.

Edge is appropriate for: request routing and personalization (decide which backend to call based on user location, device, or A/B cohort), authentication and authorization (validate tokens at the edge, rejecting unauthorized requests before they reach the origin), data transformation (resize images, transcode formats, aggregate metrics), and caching with custom invalidation logic.

Edge is NOT appropriate for: transactional workloads that require strong consistency (the edge doesn't have a consistent data store), heavy computation (edge workers have strict CPU and memory limits), or workflows that need to access a centralized database on every request (you just moved the latency from client-to-origin to edge-to-origin).

## Failure Scenario

A multi-region application replicates user profiles to 3 regions for local reads. A user in Tokyo updates their profile (write goes to the Tokyo leader). The replication to the EU region lags by 2 seconds. During that window, the user's colleague in London reads the stale profile. In most applications, this 2-second staleness is invisible. But if the "profile" includes access permissions, the stale read means the London colleague still has revoked access for 2 seconds — a security-relevant consistency window. The fix: route permission checks to the primary region (accepting the latency cost for this critical path) while keeping non-sensitive profile data eventually consistent.

## Decision Criteria

Measure your latency budget per request path. If the budget requires sub-50ms response times for a global user base, you need data locality — either edge compute, regional replicas, or both. Pin write-heavy paths to a primary region and replicate read-heavy data. Use edge for stateless or cache-backed logic; use regional replicas for stateful reads. Always identify which data paths are latency-sensitive vs. consistency-sensitive — they rarely overlap, and the answer determines your topology.
