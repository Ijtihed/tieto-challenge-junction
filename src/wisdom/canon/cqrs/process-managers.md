---
id: "cqrs-process-managers"
paradigm: cqrs
title: "Process Managers"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/process-managers"
---

# Process Managers

A process manager is a stateful event-driven coordinator that routes events to commands across aggregate boundaries. It is often conflated with sagas — the distinction matters. A saga defines compensating transactions for a linear sequence of steps. A process manager generalizes this to arbitrary state machines with branching, parallel paths, and complex completion conditions.

## Process Manager vs Saga

A saga is a specific pattern: a sequence of steps where each step has a compensating action. A process manager is a broader construct: it receives events, maintains internal state, and emits commands based on that state. Every saga can be modeled as a process manager, but not every process manager is a saga.

Use "saga" when the workflow is a linear chain with compensation semantics. Use "process manager" when the workflow has branching logic, parallel tracks, timeouts, or completion conditions that go beyond "undo the last step."

## State Machine Design

Process managers are most maintainable when modeled as explicit state machines:

```typescript
type ShipmentState =
  | { phase: 'awaiting_payment' }
  | { phase: 'awaiting_items'; receivedItems: Set<string> }
  | { phase: 'ready_to_ship' }
  | { phase: 'shipped'; trackingId: string }
  | { phase: 'failed'; reason: string };

class ShipmentProcess {
  constructor(private state: ShipmentState, private orderId: string) {}

  handle(event: DomainEvent): Command[] {
    switch (this.state.phase) {
      case 'awaiting_payment':
        if (event.type === 'PaymentConfirmed') {
          this.state = { phase: 'awaiting_items', receivedItems: new Set() };
          return [new RequestWarehousePick(this.orderId)];
        }
        if (event.type === 'PaymentFailed') {
          this.state = { phase: 'failed', reason: 'payment_declined' };
          return [new CancelOrder(this.orderId)];
        }
        break;

      case 'awaiting_items':
        if (event.type === 'ItemPicked') {
          this.state.receivedItems.add(event.itemId);
          if (this.state.receivedItems.size === event.totalItems) {
            this.state = { phase: 'ready_to_ship' };
            return [new ScheduleCarrierPickup(this.orderId)];
          }
        }
        break;

      case 'ready_to_ship':
        if (event.type === 'CarrierPickedUp') {
          this.state = { phase: 'shipped', trackingId: event.trackingId };
          return [new NotifyCustomerShipped(this.orderId, event.trackingId)];
        }
        break;
    }
    return [];
  }
}
```

Discriminated unions make illegal states unrepresentable. The `receivedItems` set exists only in the `awaiting_items` phase; accessing it in another phase is a type error.

## Long-Running Workflows

Process managers are inherently long-running — days, weeks, or months. An insurance claim process manager might live for 90 days. This requires:

- **Persistent state.** The process manager is event-sourced: it records its transitions as events and rebuilds on restart by replaying them.
- **Timeout handling.** Use scheduled events or a deadline tracker. If no `PaymentConfirmed` arrives within 30 minutes, emit a `PaymentTimedOut` event that the process manager handles like any other event.
- **Idempotency.** Events may be delivered more than once. The process manager must detect duplicates — typically by checking whether the transition has already occurred (the state machine is already past the relevant phase).

## Correlation

A process manager needs a correlation ID to associate incoming events with the correct instance. In order-based workflows, the `orderId` is the natural correlation key. For cross-domain processes, use an explicit `processId` that all participants propagate in their events.

```typescript
interface ProcessManagerRepository {
  loadByCorrelation(correlationId: string): Promise<ProcessManager>;
  save(pm: ProcessManager): Promise<void>;
}
```

## When to Use

Reach for a process manager when: the workflow has more than two steps, involves conditional branching, needs timeout handling, or coordinates more than two aggregates. For simple two-step choreography, direct event subscription between aggregates is sufficient and adds less infrastructure.
