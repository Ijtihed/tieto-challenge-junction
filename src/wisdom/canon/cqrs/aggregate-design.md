---
id: "cqrs-aggregate-design"
paradigm: cqrs
title: "Aggregate Root Design"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/aggregate-design"
---

# Aggregate Root Design

An aggregate is a cluster of domain objects treated as a single unit for consistency purposes. The aggregate root is the sole entry point for mutations — all commands target the root, and the root enforces all invariants within the boundary. In event-sourced systems, the aggregate root is the unit of event stream partitioning: one stream per aggregate instance.

## Consistency Boundaries

The aggregate boundary defines where transactional consistency is guaranteed. Within the boundary: immediate consistency. Across boundaries: eventual consistency. Getting the boundary wrong is the most consequential design mistake in an event-sourced system.

**Too large:** an `Order` aggregate that contains the full `Customer` profile and `Inventory` state creates contention — every order command locks all related entities. Throughput collapses under concurrency.

**Too small:** an `OrderLine` as its own aggregate means adding a line item and applying an order-level discount cannot be atomic. You're forced into a saga for what should be a single-aggregate operation.

## Sizing Heuristics

Vaughn Vernon's rule: **design small aggregates**. An aggregate should protect a true invariant — a business rule that must be consistent at all times, not eventually.

```typescript
class Order {
  private id: string;
  private lines: OrderLine[];
  private status: OrderStatus;
  private discountPolicy: DiscountPolicy;

  addLine(product: ProductId, qty: number, unitPrice: Money): OrderLineAdded {
    if (this.status !== 'draft')
      throw new InvariantViolation('Cannot modify a submitted order');
    if (this.lines.length >= 100)
      throw new InvariantViolation('Order line limit exceeded');
    const line = new OrderLine(product, qty, unitPrice);
    const discount = this.discountPolicy.calculate(this.lines.concat(line));
    return new OrderLineAdded(this.id, line, discount);
  }

  apply(event: OrderLineAdded): void {
    this.lines.push(event.line);
  }
}
```

Here `Order` owns `OrderLine` because the discount invariant spans all lines. If the discount rule didn't exist, individual lines could be separate aggregates.

Questions to determine boundary:
1. **What must be immediately consistent?** That's one aggregate.
2. **What can tolerate milliseconds of staleness?** That's a separate aggregate updated via events.
3. **What's the concurrency contention?** High-traffic entities should be small aggregates to reduce conflict rates.

## Aggregate Loading in Event-Sourced Systems

Loading an aggregate means replaying its event stream from the store:

```typescript
async function load<T extends AggregateRoot>(
  id: string, factory: () => T, store: EventStore
): Promise<T> {
  const aggregate = factory();
  for await (const event of store.read(id)) {
    aggregate.apply(event);
  }
  return aggregate;
}
```

Long-lived aggregates with thousands of events need snapshotting to keep load times acceptable. The snapshot stores the aggregate's state at a point in time; loading replays only events after the snapshot.

## Identity and Stream Mapping

The aggregate ID is the event stream ID. Use deterministic, globally unique identifiers (UUIDs or domain-meaningful composites like `order-2024-00042`). Avoid database-generated sequence IDs — they create a dependency on the write store for identity generation and don't compose well in distributed systems.

## Cross-Aggregate References

Aggregates reference each other by ID, never by direct object reference. An `Order` holds a `customerId: string`, not a `customer: Customer`. This enforces the boundary: to act on the customer, you issue a command to the Customer aggregate, not call a method on a nested object.

When a business process spans aggregates, use a saga or process manager to coordinate. The order aggregate emits `OrderPlaced`; a saga listens and sends `ReserveInventory` to the inventory aggregate. The two aggregates never share a transaction.
