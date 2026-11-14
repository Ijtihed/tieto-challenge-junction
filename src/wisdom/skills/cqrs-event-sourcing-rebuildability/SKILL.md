# CQRS + Event Sourcing Rebuildability

Design event-sourced systems where read models can be rebuilt from the event log.

## When to use

- Building an event-sourced system and need to ensure projections are rebuildable
- Auditing an existing event-sourced system for correctness and recoverability
- Adding a new read model to an existing event stream
- Debugging a corrupted projection by replaying from the event store

## Steps

1. **Verify event completeness.** Every state change must be captured as a domain event. If you can't rebuild the current state by replaying events from an empty starting point, you have a gap. Test this: drop the read model, replay all events, compare. Any discrepancy means a mutation is bypassing the event log.
2. **Design events as facts, not commands.** Events record what happened (`OrderShipped`), not what was requested (`ShipOrder`). Facts are idempotent to replay; commands are not. If your event names are imperative verbs, you have commands masquerading as events.
3. **Version your event schema.** Events are immutable — you can't change old events. When the schema evolves, use upcasters: functions that transform old event shapes to the current shape during replay. Register upcasters by event type and version. Never silently drop fields.
4. **Build projections as pure folds.** A projection is a left fold over the event stream: `state = events.reduce(apply, initialState)`. The `apply` function must be pure — same event, same prior state, same output. No side effects, no external lookups, no timestamps from `Date.now()`.
5. **Separate projection from subscription.** The subscription (live event consumer) and the rebuild (full replay) must use the same `apply` function. If they diverge, the rebuilt projection won't match the live one. Extract `apply` into a shared module.
6. **Snapshot for performance.** Full replay gets slow as the event count grows. Snapshot the projection state periodically. On rebuild, load the latest snapshot and replay only events after it. Snapshots are an optimization, not a source of truth — you must always be able to rebuild without them.
7. **Test rebuildability.** In CI, run a rebuild test: insert N events, build the projection, drop it, replay, assert equality. This is your rebuildability invariant. If it breaks, something in the pipeline has side effects.

## Anti-patterns

- Mutating state outside the event log ("just update the database directly for this one field")
- Events that depend on wall-clock time or external state during replay (non-deterministic projections)
- Treating snapshots as the source of truth (if the snapshot is corrupt, you must be able to discard it and rebuild)
- Projections that call external services during replay (network calls during rebuild are slow, flaky, and non-deterministic)

## Example

An e-commerce system has events: `ItemAdded`, `ItemRemoved`, `OrderPlaced`, `OrderShipped`. The "order history" read model is a projection that folds these events into a denormalized view. A new requirement needs a "revenue by region" dashboard. Instead of backfilling from the database, you write a new projection that replays the same event stream with a different fold function. The new read model is built in 4 minutes from 2M events, is provably consistent with the order history (same source events), and requires zero changes to the write side.
