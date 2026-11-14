---
id: "cqrs-event-schema-evolution"
paradigm: cqrs
title: "Event Schema Evolution"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/cqrs/event-schema-evolution"
---

# Event Schema Evolution

Events are immutable — once persisted, their bytes never change. But the code that produces and consumes events changes constantly. Event schema evolution is the set of strategies for bridging this gap without corrupting the event store or breaking downstream consumers.

## The Versioning Problem

An `OrderPlaced` event written 18 months ago may have a different shape than one written today. Fields are added, removed, renamed, or restructured. The event store contains both versions. Every consumer — projections, sagas, reprocessing jobs — must handle every version it might encounter during replay.

## Weak Schema vs Strong Schema

**Weak schema** treats events as loosely typed maps. Consumers extract fields defensively with fallback defaults. This is operationally simple but pushes validation to runtime, where mismatches surface as silent bugs in projections.

**Strong schema** assigns explicit version numbers and enforces structural contracts (JSON Schema, Avro, Protobuf). Breaking changes require a new version. This catches incompatibilities at deploy time but demands disciplined schema registry management.

Most production systems land between the two: events carry a version field, consumers use typed deserialization, and a schema registry enforces backward compatibility rules at publish time.

## Upcasting

Upcasting transforms an old event shape into the current shape at read time, before the event reaches the consumer. The event store bytes are untouched; the transformation happens in the deserialization pipeline.

```typescript
interface Upcaster {
  eventType: string;
  fromVersion: number;
  toVersion: number;
  upcast(raw: Record<string, unknown>): Record<string, unknown>;
}

const upcasters: Upcaster[] = [
  {
    eventType: 'OrderPlaced',
    fromVersion: 1,
    toVersion: 2,
    upcast(raw) {
      return {
        ...raw,
        currency: raw.currency ?? 'USD',
        version: 2,
      };
    },
  },
  {
    eventType: 'OrderPlaced',
    fromVersion: 2,
    toVersion: 3,
    upcast(raw) {
      return {
        ...raw,
        lineItems: raw.items, // renamed field
        version: 3,
      };
    },
  },
];
```

Upcasters chain: a v1 event passes through the v1→v2 upcaster, then v2→v3, arriving at the consumer in the current shape. This keeps consumer code clean — it only handles the latest version — at the cost of maintaining the upcaster chain.

## Evolution Strategies

**Additive-only changes** (new optional fields) are backward-compatible and require no upcasting. This should be the default. Design event schemas with this in mind: prefer optional fields over required ones for anything that might change.

**Rename/restructure** requires upcasting. The upcaster maps old field names to new ones. Consumers see only the latest structure.

**Semantic changes** (a field's meaning changes, e.g., `amount` shifts from cents to dollars) are the most dangerous. Upcasters must transform values, not just structure. These changes should be rare and heavily tested.

**New event types** replace deprecated ones. Instead of evolving `OrderPlaced` to v7, introduce `OrderPlacedV2` as a new event type with a clean schema. The old type remains in the store for historical events; new writes use the new type. Projections handle both.

## Copy-Transform for Major Migrations

When upcaster chains become unwieldy (10+ versions deep), a copy-transform migration creates a new stream by replaying the old stream through all upcasters and writing the resulting events to a new store. The old store is archived. This is expensive but resets the upcaster chain and improves replay performance.

## Registry Integration

A schema registry (Confluent Schema Registry, AWS Glue, or a simple git-backed JSON Schema directory) enforces compatibility at publish time. Configure it for backward compatibility: new event versions must be readable by old consumers. This gives you a safety net — a deploy that would publish an incompatible event version fails before reaching production.
