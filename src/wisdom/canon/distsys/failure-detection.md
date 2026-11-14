---
id: "distsys-failure-detection"
paradigm: distsys
title: "Failure Detection in Distributed Systems"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/failure-detection"
---

# Failure Detection in Distributed Systems

In a distributed system, you cannot distinguish a crashed node from a slow one. This is the fundamental impossibility that makes failure detection a probabilistic exercise rather than a deterministic one. Every failure detector trades off between detection speed (how quickly you declare a node dead) and accuracy (how often you're wrong).

## Heartbeat-Based Detection

The simplest approach: every node periodically sends heartbeats to a monitor (or to all peers). If a heartbeat is missed for a configured number of intervals, the node is suspected dead. The parameters are the heartbeat interval (e.g., 1 second) and the failure threshold (e.g., 3 missed heartbeats = suspected failure after 3 seconds).

The problem is tuning. Too aggressive: network congestion or a GC pause causes false positives, triggering unnecessary failovers that cascade into instability. Too conservative: actual failures take tens of seconds to detect, during which the system operates in a degraded state without knowing it. The optimal setting depends on your network characteristics, which change over time.

## Phi Accrual Failure Detector

The phi accrual detector (used by Akka, Cassandra) replaces the binary alive/dead threshold with a continuous suspicion level. It maintains a sliding window of inter-arrival times for heartbeats from each peer. From this distribution, it computes phi — a value that represents the likelihood that the peer has crashed, given how long it's been since the last heartbeat. A phi of 1 means the probability of a false positive is 10%; phi of 8 means the probability is 10^-8.

The advantage is adaptivity. If network latency increases (say, during a cross-region failover), the inter-arrival distribution shifts, and the detector automatically adjusts its sensitivity. A fixed-timeout detector would need manual retuning.

The application chooses a phi threshold based on its tolerance for false positives. A coordination service might use phi > 8 (very conservative — almost never triggers falsely). A load balancer might use phi > 3 (faster detection, tolerating occasional false positives because routing around a "dead" node that's actually alive is harmless).

## SWIM-Based Detection

SWIM (discussed in the gossip-protocols doc) combines failure detection with membership dissemination. Its key innovation is indirect probing: when a direct ping fails, the detector asks k random peers to probe the suspect on its behalf. This distinguishes "the suspect is down" from "the network path between me and the suspect is down." Only if both direct and indirect probes fail is the node suspected.

## Failure Scenario

A Cassandra cluster in AWS spans two availability zones. An AZ networking event introduces 500ms of additional latency between zones. Fixed-timeout detectors (with a 2-second threshold) start flapping: nodes in the other AZ are intermittently declared dead and then alive, causing continuous ring membership churn, streaming-based data movement, and read latency spikes. A phi accrual detector, having observed the increased latency, would shift its distribution and keep phi below the threshold — no false positives, no churn.

Another scenario: a node's disk fills up, causing its JVM to enter continuous full-GC. The node is technically alive (the process is running) but cannot process requests. Heartbeats are delayed but eventually sent during brief GC pauses. The failure detector sees degraded but not absent heartbeats. Application-level health checks — checking not just "is the process up" but "can it serve requests" — are necessary to detect this class of failure. Combine the failure detector with liveness probes that exercise the critical path.

## Decision Criteria

Use phi accrual when: you operate across variable-latency networks (cloud, multi-region, internet-facing) and false positives are expensive. Use fixed-timeout when: your network is predictable (single-datacenter, dedicated network) and simplicity matters more than adaptivity. Always supplement network-level failure detection with application-level health checks for gray failures (the node is reachable but non-functional).
