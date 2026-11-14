---
id: "distsys-split-brain"
paradigm: distsys
title: "Split-Brain Scenarios, Partition Handling, and Quorum Systems"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/split-brain"
---

# Split-Brain Scenarios, Partition Handling, and Quorum Systems

Split-brain occurs when a network partition divides a cluster into two or more groups, each believing it is the active cluster and accepting writes independently. When the partition heals, the groups have diverged — reconciliation is difficult or impossible without data loss. Split-brain is the most dangerous failure mode in distributed systems because it silently corrupts data.

## How Split-Brain Happens

A five-node cluster with a single leader suffers a network partition: nodes 1, 2 on one side; nodes 3, 4, 5 on the other. Without quorum-based leader election, both sides might elect their own leader. Each leader accepts writes. When the partition heals, the two leaders have conflicting state. Which writes win? If the system doesn't have conflict resolution, the answer is "it depends on who reconnects first," which is operationally terrifying.

Even with quorum-based systems, split-brain can occur if: the quorum check has a bug (multiple databases have had this), the fencing mechanism fails (the old leader doesn't know it's been deposed), or the system uses sloppy quorums that allow writes on non-primary replicas during partitions.

## Quorum Systems

A quorum system prevents split-brain by requiring a majority (N/2 + 1 for N nodes) to agree before any decision takes effect. In a 5-node cluster, any two partitions cannot both have a majority — at most one has 3+ nodes. The majority partition elects a leader and continues; the minority partition detects it lacks quorum and stops accepting writes.

**Simple majority quorum.** Read quorum R + write quorum W > N. With N=5, W=3, R=3: writes need 3 acks, reads need 3 responses. Any read overlaps with any write. This ensures readers see the latest committed write.

**Weighted quorums.** Not all nodes are equal. Assign weights based on proximity, capacity, or data freshness. A node with weight 2 counts as two votes. This allows flexible placement: a primary data center can have more weight, making local reads satisfy quorum without cross-DC round-trips.

**Hierarchical quorums.** For geo-distributed systems: require a majority of data centers, and within each data center, a majority of nodes. This provides data-center-level fault tolerance while keeping intra-DC operations fast.

## Partition Handling Strategies

**Fail-minority.** The minority partition stops accepting reads and writes. Clients connected to the minority see errors and must reconnect to the majority. This is the CP approach: sacrifice availability on the minority side to prevent divergence. etcd, ZooKeeper, and Consul operate this way.

**Fail-all-on-uncertainty.** If a node can't determine whether it's in the majority (e.g., it can reach exactly half the cluster), it stops serving. This is conservative but prevents the scenario where a node in a 2-2 partition (from a 4-node cluster) incorrectly believes it's in the majority.

**Continue-with-conflicts.** Both sides continue operating. Writes are tagged with vector clocks or causal metadata. On partition heal, conflicts are detected and resolved — either automatically (CRDTs, LWW) or by the application (Dynamo-style "return all versions to the client"). This is the AP approach.

## STONITH (Shoot The Other Node In The Head)

When fencing tokens aren't available and the protected resource can't enforce ordering, the nuclear option is STONITH: the node that believes it should be the leader forcibly power-cycles (or shuts down the network interface of) the node it suspects of being a stale leader. Pacemaker (the Linux HA cluster manager) uses STONITH via IPMI or fencing agents. It's brutal but effective: you can't have split-brain if one side is physically off.

## Failure Scenario

An Elasticsearch cluster with 4 nodes uses `minimum_master_nodes = 2`. A partition splits it 2-2. Both sides have enough nodes to form a master quorum (2 ≥ 2). Both sides elect a master. Both accept index writes. When the partition heals, the cluster has two divergent index states. The fix: set `minimum_master_nodes = 3` (majority of 4, which is impossible on a 2-2 split, so neither side proceeds). In Elasticsearch 7+, this was replaced by automatic quorum calculation that defaults to majority, eliminating this misconfiguration class.

## Decision Criteria

Always use majority quorums for leader election and coordination. Deploy odd-numbered clusters (3, 5, 7) to avoid tied splits. Implement fencing at the resource level — don't rely on the leader knowing it's been deposed. Test partition scenarios explicitly during pre-production chaos testing: simulate asymmetric partitions, transient partitions, and partial partitions (not just clean splits). If your system handles split-brain via conflict resolution, test the resolution logic as thoroughly as the happy path.
