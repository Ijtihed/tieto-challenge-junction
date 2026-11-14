---
id: "distsys-clock-synchronization"
paradigm: distsys
title: "Clock Synchronization"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/clock-synchronization"
---

# Clock Synchronization

Distributed systems need time for ordering events, expiring leases, measuring latency, and correlating logs. But physical clocks across machines drift, jump, and lie. The choice of time source determines what consistency guarantees your system can offer and what failure modes it inherits.

## NTP (Network Time Protocol)

NTP synchronizes clocks to a reference time source over the network. A typical NTP setup achieves accuracy within 1–10ms on a LAN and 10–100ms over the internet. NTP clients periodically poll servers, measure round-trip times, and adjust their local clock using statistical filtering to compensate for network jitter.

NTP clocks can go backwards. A clock that's running fast will be stepped or slewed back. Step adjustments (jumping the clock backward) break any software that assumes monotonic time. Slew adjustments (gradually slowing the clock) are safer but can take hours for large corrections. Linux's `CLOCK_MONOTONIC` provides a monotonically increasing time source independent of NTP adjustments — use it for measuring durations; use wall-clock time only for human-facing timestamps.

The fundamental problem: NTP's accuracy is bounded by network latency variance. If you need sub-millisecond clock agreement, NTP over a WAN is insufficient.

## Google's TrueTime

TrueTime, used by Google Spanner, provides a time interval `[earliest, latest]` rather than a point estimate. The interval bounds the true time with high confidence. Spanner uses GPS receivers and atomic clocks in each data center to keep the uncertainty interval (ε) typically under 7ms. When Spanner commits a transaction, it waits for ε to elapse (the "commit wait") to ensure that any future transaction will see a later timestamp. This converts clock uncertainty into latency — a direct tradeoff.

TrueTime enables Spanner's externally consistent (linearizable) transactions across data centers without consensus on every read. The cost: specialized hardware (GPS + atomic clocks) and commit-wait latency proportional to clock uncertainty. If ε grows (GPS antenna failure, atomic clock drift), commit latency grows proportionally.

CockroachDB approximates TrueTime's guarantees using NTP. Without hardware time sources, CockroachDB's clock uncertainty is larger (typically 250ms by default), which means longer commit waits and wider uncertainty windows. It uses a technique called "clock offset tracking" where nodes track observed clock differences with peers and refuse to operate if the offset exceeds the configured maximum.

## Hybrid Logical Clocks (HLC)

HLCs combine a physical clock component with a logical counter. The physical component tracks wall time (bounded by NTP accuracy). The logical component breaks ties when events happen within the same physical timestamp. The result: an always-increasing timestamp that correlates with wall time (unlike pure Lamport timestamps) but doesn't depend on perfect clock synchronization (unlike TrueTime).

HLCs guarantee: if event A causally precedes event B, then `HLC(A) < HLC(B)`. If A and B are concurrent, their HLCs may be in any order, but both correlate with their physical time. CockroachDB uses HLCs for its MVCC timestamps.

The limitation: HLCs can drift from physical time by at most the NTP uncertainty bound. If NTP accuracy degrades, HLC timestamps diverge from wall time, and operations that depend on "real time" ordering (like TTL expiry) become unreliable.

## Failure Scenarios

**NTP step-back during lease.** A lease expires at wall time T+10. NTP steps the clock back 5 seconds. The lease holder now believes it has 15 seconds remaining when it actually has 10. If another node (with correct time) acquires the lease at T+10, two nodes hold the lease simultaneously. Fix: use monotonic clocks for lease timing, never wall clocks.

**GPS antenna failure in a Spanner-like system.** One data center loses GPS sync. Its TrueTime uncertainty ε grows from 7ms to 200ms. Commit-wait latency jumps from 7ms to 200ms for any transaction touching that data center. The system remains correct (it waits longer to compensate for uncertainty) but throughput drops dramatically. The operational response: redundant time sources (GPS + atomic clock) so that losing one doesn't immediately degrade ε.

## Decision Criteria

Use NTP when: millisecond-level accuracy is sufficient and you're not basing correctness on clock agreement (log correlation, human-facing timestamps). Use HLCs when: you need causal ordering that correlates with wall time (MVCC, event ordering). Consider TrueTime-style approaches when: you need externally consistent transactions across data centers and can invest in hardware time sources. Always use monotonic clocks for measuring durations and enforcing timeouts.
