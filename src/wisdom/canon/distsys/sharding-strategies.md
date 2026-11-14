---
id: "distsys-sharding-strategies"
paradigm: distsys
title: "Sharding Strategies"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/sharding-strategies"
---

# Sharding Strategies

Sharding partitions data across multiple nodes so that no single node holds the entire dataset. It's the primary horizontal scaling mechanism for databases, caches, and storage systems. The sharding strategy determines data distribution, query routing, and the pain level of rebalancing when the cluster changes.

## Hash-Based Sharding

Compute `hash(partition_key) % num_shards` to assign each record to a shard. Distribution is uniform (assuming a good hash function and sufficient cardinality in the partition key). The problem: changing `num_shards` remaps almost every record. Adding a 5th shard to a 4-shard cluster moves ~80% of data. Consistent hashing (covered in its own doc) solves this by remapping only `K/N` keys on rebalance.

Hash sharding scatters range-adjacent keys across shards. A query for "all orders from 2024-01" hits every shard if the partition key is `order_id`. This is the fundamental tradeoff: uniform distribution at the cost of range-query efficiency.

## Range-Based Sharding

Assign contiguous key ranges to each shard: shard 1 gets keys A–F, shard 2 gets G–M, etc. Range queries (`WHERE name BETWEEN 'Alice' AND 'Charlie'`) hit a single shard. Time-series data naturally benefits: today's data lives on the latest shard.

The risk: hotspots. If all current writes go to the latest time range, one shard absorbs the entire write load. Solutions include: salting the key (prepending a random byte to distribute writes, at the cost of complicating range queries), or adaptive range splitting (the hot shard splits into two smaller ranges automatically).

Google Bigtable, HBase, and CockroachDB use range-based sharding with automatic split/merge. When a range exceeds a size threshold (e.g., 64MB in CockroachDB), it splits. When adjacent ranges are small, they merge. This adaptive behavior means the shard map evolves with the data distribution.

## Directory-Based Sharding

A lookup table (the directory) maps each key or key range to a shard. Any distribution strategy is possible — you can place specific tenants on specific hardware, co-locate related keys, or implement arbitrary placement policies. The directory itself becomes a critical dependency: every read and write requires a directory lookup. The directory must be highly available, low-latency, and consistently replicated.

MongoDB's config servers are a directory-based approach: the config server stores the chunk-to-shard mapping, and mongos routers consult it to route queries. If config servers are unavailable, chunk migrations stall (though reads and writes to existing chunks continue via cached routing tables).

## Resharding

Resharding — changing the number of shards or the key-to-shard mapping — is the operational nightmare of sharded systems. It requires moving data between nodes while the system continues serving reads and writes. Strategies:

**Online resharding.** Double-write during migration: new writes go to both old and new shards. Background copy moves historical data. Once complete, cut over reads to the new shard map. Vitess and Spanner do this transparently.

**Shadow sharding.** Introduce the new shard layout alongside the old one. Replicate all writes to both layouts. Once the new layout has caught up, switch reads and decommission the old layout. Higher resource cost but lower risk.

**Ghost table migration.** GitHub's gh-ost pattern for MySQL: create a shadow table with the new schema/sharding, apply binlog events to keep it in sync, then atomic rename. Applicable at the table level rather than the cluster level.

## Failure Scenario

An e-commerce platform hash-shards orders by `customer_id`. A flash sale drives 60% of orders from a single enterprise customer. That customer's shard absorbs 60% of total write load while other shards are idle. Hash sharding provided uniform distribution across customers but not across load. The fix: composite shard key (`customer_id + order_id`) distributes that customer's orders across all shards, at the cost of requiring a scatter-gather query to fetch all orders for that customer.

## Decision Criteria

Use hash sharding when: access patterns are primarily point lookups by key and you need uniform distribution. Use range sharding when: range queries are common and you can manage hotspot mitigation. Use directory sharding when: you need fine-grained placement control (multi-tenancy, compliance, data locality requirements). Whatever strategy you choose, plan for resharding from day one — it's not a question of if, but when.
