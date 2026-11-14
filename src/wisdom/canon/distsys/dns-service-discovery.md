---
id: "distsys-dns-service-discovery"
paradigm: distsys
title: "DNS-Based Service Discovery"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/dns-service-discovery"
---

# DNS-Based Service Discovery

Service discovery answers the question: "where is the instance of service X that I should talk to?" DNS is the oldest and most universal answer. Every language, framework, and operating system already has a DNS client. Using DNS for service discovery means zero application dependencies — no SDK, no sidecar, no agent.

## A Records and Round-Robin

The simplest approach: a DNS name (e.g., `payments.internal`) resolves to multiple A records, one per instance. The client picks one (often the first, which the DNS server rotates via round-robin). This provides basic load distribution but no health checking — a dead instance stays in the record set until the DNS record is updated, and clients cache the stale record for the TTL duration.

Setting a low TTL (5–30 seconds) reduces staleness but increases DNS query volume. Some clients and libraries ignore TTL entirely (the JVM's default DNS caching is notoriously aggressive — it caches forever unless configured otherwise). In practice, you cannot rely on DNS TTL for timely failure detection.

## SRV Records

SRV records add port and priority information that A records lack. An SRV record for `_http._tcp.payments.internal` returns: priority, weight, port, and target hostname. Priority enables failover (lower priority = preferred; fall back to higher priority on failure). Weight enables weighted load distribution within a priority level.

SRV records are underused in practice because most HTTP clients don't natively support them. gRPC supports SRV natively, making it the primary protocol where SRV-based discovery works out of the box. For HTTP, you need a client-side resolver or a service mesh proxy that handles SRV resolution.

## Consul DNS, CoreDNS, and AWS Cloud Map

Consul exposes its service catalog via a DNS interface. Querying `payments.service.consul` returns healthy instances (Consul's health checks filter out unhealthy ones before responding). This combines DNS's universality with health-check-based filtering. CoreDNS (the default DNS server in Kubernetes) serves `service.namespace.svc.cluster.local` records backed by the Kubernetes API, providing automatic service discovery for every Kubernetes pod.

AWS Cloud Map provides a managed DNS-based service discovery layer. Services register instances, and Cloud Map serves DNS records. Health checks can be route-based (HTTP health endpoint) or API-based (the service explicitly deregisters on shutdown).

## Client-Side Load Balancing

DNS-based discovery naturally leads to client-side load balancing: the client resolves the DNS name, gets N addresses, and picks one using a local algorithm (round-robin, least-connections, random, weighted). This avoids a load-balancer as a single point of failure and reduces latency (no extra hop).

The tradeoff: client-side load balancing requires the client to track connection health and retry failed instances. Without a shared view of backend health, different clients may have different views of which instances are alive. gRPC's client-side load balancing (with pick-first, round-robin, or custom policies) handles this well. HTTP clients typically need a library (e.g., Envoy in sidecar mode) to achieve the same sophistication.

## Failure Scenarios

**DNS caching during deployment.** A rolling deployment replaces instance 10.0.1.5 with 10.0.1.9. The DNS record updates, but clients cached the old A record with a 30-second TTL. For 30 seconds, clients send traffic to the decommissioned IP. If the old IP is immediately reassigned (common in cloud environments), traffic goes to the wrong service. Fix: drain connections before decommissioning (the old instance returns 503 for a TTL duration), or use connection-level health checks that detect the non-responsive endpoint within seconds.

**Negative caching.** A service briefly goes down. DNS returns NXDOMAIN (no record). Resolvers cache the negative response for the SOA's minimum TTL (which can be minutes to hours). Even after the service recovers and the record is restored, clients see the cached NXDOMAIN. Fix: set the SOA minimum TTL to match your service's recovery SLA, and never return NXDOMAIN for a service name — return an empty record set or a static fallback instead.

## Decision Criteria

Use DNS-based discovery when: you need zero-dependency discovery that works across languages and environments, your services are relatively stable (minutes between changes, not seconds), and you can tolerate TTL-bounded staleness. Use a dedicated service registry (Consul, etcd, ZooKeeper) when: instances change frequently, you need sub-second health-checking, or you need metadata-rich discovery (tags, versions, capabilities). In Kubernetes, the built-in DNS is the default — reach for it before adding complexity.
