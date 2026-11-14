---
id: "distsys-idempotency"
paradigm: distsys
title: "Idempotency Keys, Exactly-Once Delivery, and Deduplication"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/distsys/idempotency"
---

# Idempotency Keys, Exactly-Once Delivery, and Deduplication

In a distributed system, any request can fail ambiguously: the client doesn't know if the server processed it before the connection dropped. The only safe response is to retry. But if the operation isn't idempotent, a retry can cause double charges, duplicate records, or inconsistent state. Idempotency is the property that performing an operation multiple times has the same effect as performing it once.

## Naturally Idempotent Operations

Some operations are idempotent by nature: setting a value (PUT), deleting a resource (DELETE), reading data (GET). These are safe to retry without additional infrastructure. The problems arise with non-idempotent operations: creating a resource (POST), incrementing a counter, transferring money. Retrying "transfer $100 from A to B" can cause a double transfer.

## Idempotency Keys

The standard pattern for making non-idempotent operations safe: the client generates a unique key (typically a UUID) and includes it with every request. The server stores the key alongside the result. On retry, the server checks if it has already processed that key — if yes, it returns the stored result without re-executing the operation.

Implementation details that matter: the idempotency key must be stored atomically with the operation's side effects. If you insert the key into a deduplication table in a separate transaction from the business operation, a crash between the two creates a window where the operation executed but the key wasn't stored, allowing a duplicate on retry.

Stripe's API is the canonical example: every POST request accepts an `Idempotency-Key` header. The key is associated with the request parameters and the response. Retrying the same key with different parameters returns an error (preventing accidental misuse). Keys expire after 24 hours, bounding storage growth.

## Exactly-Once Delivery

"Exactly-once" is a loaded term. In the general case, exactly-once delivery across a network is impossible — you can only achieve at-least-once delivery with idempotent processing (which gives you effectively-exactly-once semantics). Kafka achieves "exactly-once" within its own system by combining idempotent producers (per-partition sequence numbers that the broker deduplicates), transactional writes (atomic writes across multiple partitions), and consumer offset commits in the same transaction as the output write.

This works because Kafka controls both the delivery mechanism and the state store. When the consumer writes to an external system (a database, an API), the exactly-once guarantee ends at Kafka's boundary. The external write must be made idempotent separately.

## Deduplication Patterns

**Database unique constraint.** Insert the operation with a unique identifier (the idempotency key) in a column with a UNIQUE constraint. Duplicate inserts fail with a constraint violation, which the application catches and treats as "already processed."

**Bloom filter pre-check.** For high-throughput streams where checking a database per message is too expensive, use a Bloom filter as a fast probabilistic check. False positives (thinking a new message is a duplicate) cause occasional dropped messages; false negatives are impossible. Follow up with a database check for messages that pass the Bloom filter.

**Outbox pattern.** Write the business event and a corresponding outbox record in the same database transaction. A separate process reads the outbox and publishes to the message broker. If the publisher crashes, it replays from the outbox on restart. Consumers deduplicate using the event's unique ID. This gives you at-least-once publishing with idempotent consumption.

## Failure Scenario

A payment service processes a charge, returns 200, but the client's connection drops before receiving the response. The client retries. Without an idempotency key, the service charges the customer twice. With an idempotency key, the service recognizes the duplicate and returns the original response. But if the idempotency key lookup and the charge are in separate transactions, a crash between lookup (not found) and charge (executed) followed by a retry can still cause a double charge. The fix: single-transaction atomic check-and-execute.

## Decision Criteria

Make every mutation endpoint idempotent. For internal services, use request IDs propagated through the call chain. For public APIs, require client-supplied idempotency keys. Store keys with TTLs proportional to your retry window (24–72 hours is typical). Use the outbox pattern when you need reliable event publishing without distributed transactions.
