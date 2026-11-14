---
id: "distsys-log-structured-storage"
paradigm: distsys
title: "Log-Structured Merge Trees, SSTables, and Compaction"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/log-structured-storage"
---

# Log-Structured Merge Trees, SSTables, and Compaction

LSM trees are the storage engine behind Cassandra, RocksDB, LevelDB, HBase, and ScyllaDB. They optimize for write throughput by converting random writes into sequential I/O, at the cost of read amplification and background compaction overhead.

## How LSM Trees Work

Writes go to an in-memory sorted structure (the memtable — typically a red-black tree or skip list). When the memtable reaches a size threshold (e.g., 64MB), it's flushed to disk as an immutable Sorted String Table (SSTable). SSTables are sorted by key, which enables efficient range scans and binary search for point lookups.

Over time, multiple SSTables accumulate on disk. A read must check the memtable plus every SSTable that might contain the key. Without optimization, this is O(N) in the number of SSTables. Bloom filters reduce this: each SSTable has a Bloom filter that probabilistically answers "does this SSTable contain this key?" with no false negatives. A typical Bloom filter with 10 bits per key has a ~1% false positive rate, meaning 99% of SSTables that don't contain the key are skipped without a disk read.

## Compaction Strategies

Compaction merges SSTables to reduce their count, reclaim space from deleted/overwritten keys, and maintain read performance.

**Size-tiered compaction (STCS).** SSTables of similar size are merged together. Simple and good for write-heavy workloads (minimal write amplification). The problem: temporary space amplification during compaction (you need space for both old and new SSTables simultaneously) and the potential for very large SSTables that take a long time to compact.

**Leveled compaction (LCS).** SSTables are organized into levels. Level 0 contains recently flushed SSTables (may overlap in key range). Level 1+ has non-overlapping SSTables — each level's SSTables partition the key space. When a level exceeds its size limit, one SSTable is merged with the overlapping SSTables in the next level. This guarantees bounded read amplification (at most one SSTable per level for a point lookup) but has higher write amplification (each key may be rewritten across multiple levels).

**FIFO compaction.** Simply delete the oldest SSTables. Appropriate for time-series data with a TTL — old data ages out. No merge needed. Extremely efficient but only works when old data is disposable.

**Universal compaction (RocksDB).** A generalization of size-tiered that picks merges to minimize write amplification while bounding space amplification. The merge decision is based on a configurable ratio comparing the sizes of adjacent sorted runs.

## Write Amplification

The total amount of data written to disk for each byte written by the application. An LSM tree with leveled compaction might have a write amplification of 10–30×: each key is written to the memtable, flushed to L0, then merged through L1, L2, L3, etc. This is the fundamental cost of LSM trees. For SSD-based systems, write amplification directly affects drive lifespan and throughput. Tuning the compaction strategy and level size ratios is the primary lever for controlling write amplification.

## SSTables and Tombstones

Deletes in an LSM tree aren't immediate. A delete writes a tombstone — a marker saying "this key is deleted." The tombstone suppresses the key in reads. The actual data is reclaimed only when compaction merges the tombstone with the original entry. Until then, the "deleted" data occupies disk space. In workloads with heavy deletes, tombstones can accumulate and degrade read performance (each read must process tombstones to determine the current state).

## Failure Scenario

A Cassandra cluster uses size-tiered compaction with a 90% disk utilization. A compaction starts on a node, needing temporary space for the merged SSTable. The node runs out of disk. Compaction aborts, leaving the node with too many SSTables. Read latency spikes because the query must check more SSTables. The operator can't add space without restarting the node or adding a new node and rebalancing. The fix: never exceed 50% disk utilization on LSM-tree-based systems (the other 50% is headroom for compaction). Alternatively, switch to leveled compaction, which has lower space amplification at the cost of higher write amplification.

## Decision Criteria

Use LSM trees when: your workload is write-heavy, your access pattern tolerates slightly higher read latency for much higher write throughput, and you can budget disk space for compaction. Use B-tree-based engines (PostgreSQL, MySQL InnoDB) when: read-heavy workloads dominate, you need predictable read latency, and write amplification is less of a concern.
