---
id: "distsys-consistent-hashing"
paradigm: distsys
title: "Consistent Hashing, Virtual Nodes, and Rebalancing"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/consistent-hashing"
---

# Consistent Hashing, Virtual Nodes, and Rebalancing

When you distribute data across N nodes, naive modular hashing (`hash(key) % N`) breaks catastrophically when N changes: almost every key remaps. Consistent hashing solves this by mapping both keys and nodes onto the same hash ring, ensuring that adding or removing a node only redistributes keys from adjacent ring positions — roughly `K/N` keys move instead of nearly all of them.

## The Hash Ring

Imagine the output space of a hash function (e.g., SHA-256) as a circle from 0 to 2^256 - 1, wrapping around. Each node is hashed to a position on this ring. Each key is also hashed, and it's assigned to the first node encountered when walking clockwise from the key's position. When a node is added, it takes ownership of keys between its position and the preceding node. When removed, its keys shift to the next clockwise node. Only keys in the affected arc move.

## Virtual Nodes

With only N physical nodes on the ring, the distribution is typically uneven — some nodes own much larger arcs than others. Virtual nodes (vnodes) fix this: each physical node is represented by V positions on the ring (e.g., V=256). Keys are distributed across vnodes, and since vnodes are spread roughly uniformly, load balances out. When a physical node joins, its V vnodes take small slices from many existing nodes rather than one large chunk from a single neighbor. DynamoDB, Cassandra, and Riak all use vnodes.

The tradeoff: higher V gives better balance but increases the size of the ring metadata that every node must store and gossip. For most systems, V=128 to V=256 per physical node is the sweet spot.

## Rebalancing Strategies

**Passive rebalancing.** When a node joins or leaves, the ring metadata updates and future requests route correctly. Existing data migrates lazily — reads that miss trigger background fetches from the old owner. This minimizes disruption but means stale routing for a window after the topology change.

**Active rebalancing.** The system immediately streams data from old owners to new owners upon ring change. Cassandra's streaming-based bootstrap does this: when a new node joins, it calculates the token ranges it's taking over and streams SSTables from the current owners. This is operationally expensive (it saturates network and disk I/O) but brings the new node to full capacity quickly.

**Bounded load.** Google's "Consistent Hashing with Bounded Loads" adds a capacity constraint: no node handles more than `(1 + ε) × average_load`. When a node is at capacity, the key overflows to the next node on the ring. This prevents hotspots from popular keys clustering on one ring segment.

## Failure Scenario

A Cassandra cluster with RF=3 uses consistent hashing with vnodes. Node D crashes. Its vnode ranges are now served by the replica nodes (the next nodes clockwise for each range). Read and write availability is maintained. But if Node E — which holds replicas for many of D's ranges — also crashes before D recovers, some key ranges lose quorum. The probability of this double failure is a function of how many vnode ranges D and E share, which is why vnode count tuning matters: too many vnodes spread replicas across too many peers, increasing the blast radius of correlated failures.

## Decision Criteria

Use consistent hashing when: you need to distribute data across a dynamic set of nodes with minimal reshuffling (caches, sharded databases, distributed hash tables). Use range-based partitioning instead when: you need range queries across partitions (consistent hashing scatters range-adjacent keys to different nodes).
