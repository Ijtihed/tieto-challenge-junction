---
id: "cqrs-eventual-consistency"
paradigm: cqrs
title: "Eventual Consistency UX Patterns"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/eventual-consistency"
---

# Eventual Consistency UX Patterns

In a CQRS system with async projections, the read model lags behind the write model. The lag is typically milliseconds, but it's non-zero and can spike under load. This creates a UX problem: a user submits a command, the command succeeds, and the subsequent read returns stale data. The user sees their action as "lost." Solving this is a design problem, not an infrastructure problem.

## Optimistic UI Updates

The client assumes the command will succeed and immediately reflects the expected state in the UI without waiting for the read model to update.

```typescript
async function submitOrder(order: OrderDraft) {
  const optimisticOrder = {
    ...order,
    status: 'placed',
    placedAt: new Date().toISOString(),
  };

  dispatch({ type: 'ORDER_PLACED_OPTIMISTIC', payload: optimisticOrder });

  try {
    await api.post('/commands/place-order', order);
  } catch (err) {
    dispatch({ type: 'ORDER_PLACE_FAILED', payload: { orderId: order.id, error: err } });
  }
}
```

The UI shows the placed order immediately. A background poll or subscription eventually reconciles with the real read model state. If the command fails (invariant violation, conflict), the UI rolls back the optimistic update and shows an error.

Tradeoff: the UI may briefly show a state that never materializes server-side. This is acceptable for most user-facing flows but dangerous for operations with financial or legal implications.

## Write-Model Read-Back

After issuing a command, the client reads directly from the write model (aggregate state) rather than the read model. This gives immediate consistency at the cost of bypassing the read model's optimizations.

```typescript
const result = await api.post('/commands/place-order', order);
const confirmedState = await api.get(`/aggregates/order/${order.id}/state`);
```

Use sparingly — the write model isn't designed for complex queries. This pattern works for "confirm this specific entity's state" immediately after mutation, not for list views or dashboards.

## Causal Consistency Tokens

The command response includes a token (e.g., the event's sequence number or a logical timestamp). The client sends this token with subsequent read requests. The read API waits until the read model has processed at least up to that token before responding.

```typescript
const { eventPosition } = await api.post('/commands/place-order', order);
const orders = await api.get('/queries/my-orders', {
  headers: { 'X-Consistency-Token': eventPosition },
});
```

The read endpoint blocks (with a timeout) until its projection has caught up to the requested position. This guarantees the user sees their own writes without requiring global strong consistency.

## Conflict Resolution

When two users modify the same entity concurrently, the write side rejects one via optimistic concurrency (expected version mismatch). The UX must handle this gracefully:

- **Last-writer-wins** with merge: show the user the current state and their attempted changes side by side. Let them merge manually or re-apply their intent.
- **Automatic merge** for commutative operations: if both users added different line items to an order, merge both additions. If they edited the same field, prompt for manual resolution.
- **Retry with rebase**: reload the latest aggregate state, re-apply the user's intent against the new state, and resubmit. This works when the user's command is idempotent and intent-preserving.

## Subscription-Based Reconciliation

Instead of polling, the client subscribes to a real-time event feed (WebSocket, SSE) and updates the UI as events arrive. This eliminates the consistency window for connected clients.

```typescript
const es = new EventSource(`/streams/order/${orderId}`);
es.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  dispatch({ type: 'SERVER_EVENT', payload: event });
};
```

The UI state is a projection running in the browser — same mental model as a server-side projection, just materialized in the client's store.

## Decision Framework

For user-facing mutations: optimistic UI + subscription reconciliation. For admin/back-office: causal consistency tokens (correctness matters more than perceived speed). For cross-user visibility (dashboards, shared views): accept eventual consistency and design the UI to communicate "data as of X seconds ago" when freshness matters.
