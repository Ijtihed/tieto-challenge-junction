---
id: "cqrs-saga-orchestration"
paradigm: cqrs
title: "Saga Pattern & Orchestration"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/saga-orchestration"
---

# Saga Pattern & Orchestration

A saga coordinates a multi-step business process that spans multiple aggregates or services, where a traditional distributed transaction (2PC) is impractical or undesirable. Each step produces events; if a step fails, preceding steps are undone via compensating actions rather than rollback.

## Choreography vs Orchestration

**Choreography** is decentralized. Each service listens for events and decides independently what to do next. There is no central coordinator.

```
OrderPlaced → [Inventory] → InventoryReserved → [Payment] → PaymentCharged → [Shipping] → ShipmentScheduled
```

Advantages: loose coupling, no single point of failure. Disadvantages: the workflow is implicit — understanding the full saga requires tracing events across services. Debugging failures means correlating distributed logs. Adding a step means modifying multiple services' subscription logic.

**Orchestration** is centralized. A saga orchestrator (a process manager) explicitly defines the sequence of steps, sends commands to participants, and handles their responses.

```typescript
class OrderSaga {
  private state: 'started' | 'inventory_reserved' | 'payment_charged' | 'completed' | 'compensating';

  async handle(event: DomainEvent): Promise<Command[]> {
    switch (this.state) {
      case 'started':
        if (event.type === 'OrderPlaced')
          return [new ReserveInventory(event.orderId, event.items)];
        break;
      case 'inventory_reserved':
        if (event.type === 'InventoryReserved')
          return [new ChargePayment(event.orderId, event.total)];
        if (event.type === 'InventoryInsufficient')
          return [new RejectOrder(event.orderId, 'out of stock')];
        break;
      case 'payment_charged':
        if (event.type === 'PaymentCharged')
          return [new ScheduleShipment(event.orderId)];
        if (event.type === 'PaymentFailed')
          return [new ReleaseInventory(event.orderId), new RejectOrder(event.orderId, 'payment failed')];
        break;
    }
    return [];
  }
}
```

Advantages: the workflow is explicit, testable, and visible in one place. Disadvantages: the orchestrator is a coordination point — not a single point of failure if designed correctly (it's event-sourced and restartable), but a single point of complexity.

## Compensating Transactions

Compensating actions are the inverse of forward actions, but they are not rollbacks. `ChargePayment` is compensated by `RefundPayment`, not by deleting the charge record. Compensation is semantic, not mechanical — the system moves forward to a new consistent state rather than reverting to a prior one.

Key constraints:
- Compensating actions must be idempotent. A retry after a network failure must not double-refund.
- Some actions are non-compensable (sending an email, shipping a package). Design sagas so non-compensable steps occur last, or accept that compensation is "best-effort" with manual intervention for edge cases.
- The compensation order is typically the reverse of the forward order, but domain semantics can override this.

## Failure Handling

Sagas must handle three failure classes:

1. **Participant rejection** (business rule violation): trigger compensation for completed steps.
2. **Participant timeout**: retry with idempotency keys, then compensate if retries are exhausted.
3. **Orchestrator crash**: the orchestrator's state is event-sourced. On restart, it replays its own events to reconstruct the current step and resumes. No saga state is lost.

## Saga vs 2PC

Two-phase commit provides strong consistency at the cost of availability (any participant failure blocks the entire transaction). Sagas provide eventual consistency with higher availability. The tradeoff is explicit: intermediate states are visible to the system. An order may briefly appear as "placed" with inventory reserved but payment not yet charged. The read model must handle these transient states — this is a UX design problem as much as a systems design problem.

For staff+ decision-making: prefer sagas over 2PC in any system where participant latency varies, participants are independently deployable, or the business process naturally has compensable steps. Reserve 2PC for scenarios where the consistency window is truly zero-tolerance (financial ledger entries within a single database).
