---
id: "cqrs-testing-event-sourced"
paradigm: cqrs
title: "Testing Event-Sourced Systems"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/testing-event-sourced"
---

# Testing Event-Sourced Systems

Event-sourced systems have a natural testing structure: given a history of events, when a command is issued, then specific new events are emitted (or the command is rejected). This given-when-then pattern maps directly to the aggregate's lifecycle and produces tests that read like domain specifications.

## Given-When-Then for Aggregates

The test sets up the aggregate by replaying a sequence of prior events (given), executes a command (when), and asserts on the resulting events or exception (then).

```typescript
describe('Order aggregate', () => {
  it('rejects adding a line to a submitted order', () => {
    given(
      new OrderCreated({ orderId: 'o-1', customerId: 'c-1' }),
      new OrderLineAdded({ orderId: 'o-1', productId: 'p-1', qty: 2 }),
      new OrderSubmitted({ orderId: 'o-1' }),
    )
    .when(new AddOrderLine({ orderId: 'o-1', productId: 'p-2', qty: 1 }))
    .thenThrows(InvariantViolation, 'Cannot modify a submitted order');
  });

  it('applies discount when third line is added', () => {
    given(
      new OrderCreated({ orderId: 'o-1', customerId: 'c-1' }),
      new OrderLineAdded({ orderId: 'o-1', productId: 'p-1', qty: 1 }),
      new OrderLineAdded({ orderId: 'o-1', productId: 'p-2', qty: 1 }),
    )
    .when(new AddOrderLine({ orderId: 'o-1', productId: 'p-3', qty: 1 }))
    .thenEmits(
      new OrderLineAdded({ orderId: 'o-1', productId: 'p-3', qty: 1 }),
      new BulkDiscountApplied({ orderId: 'o-1', discountPercent: 10 }),
    );
  });
});
```

This test framework is straightforward to build:

```typescript
function given(...events: DomainEvent[]) {
  return {
    when(command: Command) {
      return {
        thenEmits(...expected: DomainEvent[]) {
          const aggregate = new OrderAggregate();
          events.forEach(e => aggregate.apply(e));
          const result = aggregate.handle(command);
          expect(result).toEqual(expected);
        },
        thenThrows(errorType: Function, message?: string) {
          const aggregate = new OrderAggregate();
          events.forEach(e => aggregate.apply(e));
          expect(() => aggregate.handle(command)).toThrow(errorType);
          if (message) expect(() => aggregate.handle(command)).toThrow(message);
        },
      };
    },
  };
}
```

## Testing Projections

Projection tests verify that events produce the correct read model state. They operate at a different level than aggregate tests — no commands, no invariants, just event-to-read-model transformation.

```typescript
describe('OrderDashboardProjection', () => {
  it('creates a row on OrderPlaced', async () => {
    const db = createInMemoryReadDb();
    const projection = new OrderDashboardProjection(db);

    await projection.apply(new OrderPlaced({
      orderId: 'o-1', customerName: 'Alice', total: 99.00,
    }));

    const row = await db.get('order_dashboard', 'o-1');
    expect(row.status).toBe('placed');
    expect(row.customerName).toBe('Alice');
  });

  it('handles events idempotently', async () => {
    const db = createInMemoryReadDb();
    const projection = new OrderDashboardProjection(db);
    const event = new OrderPlaced({ orderId: 'o-1', customerName: 'Alice', total: 99.00 });

    await projection.apply(event);
    await projection.apply(event);

    const count = await db.count('order_dashboard', { orderId: 'o-1' });
    expect(count).toBe(1);
  });
});
```

## Testing Sagas and Process Managers

Saga tests verify the state machine transitions: given a saga in state X with event Y, expect commands Z. These are structurally similar to aggregate tests but assert on emitted commands rather than events.

```typescript
it('compensates on payment failure after inventory reservation', () => {
  const saga = givenSaga(OrderSaga,
    new OrderPlaced({ orderId: 'o-1' }),
    new InventoryReserved({ orderId: 'o-1' }),
  );

  const commands = saga.handle(new PaymentFailed({ orderId: 'o-1', reason: 'insufficient_funds' }));

  expect(commands).toEqual([
    new ReleaseInventory({ orderId: 'o-1' }),
    new RejectOrder({ orderId: 'o-1', reason: 'payment failed' }),
  ]);
});
```

## Scenario Testing

End-to-end scenario tests exercise the full command-event-projection pipeline. They submit commands via the application layer, let the projections process the events, and assert on the read model.

These tests are slower and harder to maintain but catch integration failures that unit tests miss: serialization bugs, projection subscription wiring, event-handler routing errors.

## Testing Event Schema Evolution

Upcaster tests are critical and often overlooked. For each version transition, verify that the upcaster transforms a raw event from the old version into the expected new-version shape. Keep a fixtures directory with serialized events from each historical version — these are regression tests against schema drift.
