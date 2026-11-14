---
id: "stm-futures-promises"
paradigm: stm
title: "Futures, Promises, and Async Composition"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/futures-promises"
---

# Futures, Promises, and Async Composition

Futures and promises decouple the initiation of a computation from the consumption of its result. A future is a read-handle to a value that may not exist yet. A promise is the write-handle that resolves the future. This split enables concurrent and asynchronous composition without shared mutable state.

## Core Semantics

A future represents a value that will be available at some point. Once resolved, it is immutable — reading a completed future is safe from any thread without synchronisation:

```scala
val future: Future[User] = Future {
  db.findUser(userId)  // runs on a thread pool
}

future.map(user => renderProfile(user))
      .recover { case e: NotFoundException => renderNotFound() }
```

The computation runs concurrently. `map`, `flatMap`, and `recover` attach continuations that execute when the value arrives, without blocking the caller's thread.

## Composition Patterns

**Sequential composition** via `flatMap` (or `then` in JS, `and_then` in Rust) chains dependent async operations:

```typescript
const profile = await fetchUser(id)
  .then(user => fetchPosts(user.id))
  .then(posts => ({ user, posts }));
```

**Parallel composition** via `all` / `zip` runs independent futures concurrently and joins their results:

```rust
let (user, posts, settings) = tokio::join!(
    fetch_user(id),
    fetch_posts(id),
    fetch_settings(id),
);
```

**Race composition** via `select` / `race` returns whichever future completes first:

```javascript
const result = await Promise.race([
  fetchFromPrimary(key),
  fetchFromReplica(key),
]);
```

## Error Propagation

Futures carry failure through the monad. An error in any stage short-circuits subsequent `map`/`flatMap` calls and propagates to the terminal error handler. This replaces try-catch towers with declarative error flow:

```scala
for {
  user  <- fetchUser(id)         // if this fails,
  perms <- fetchPermissions(user) // this never runs,
  page  <- renderPage(user, perms) // nor this
} yield page
// .recover handles the error wherever it occurred
```

## Relationship to STM

Futures and STM solve different problems that interact at system boundaries. STM manages shared mutable state with transactional guarantees. Futures manage asynchronous computation flow. They combine when a transaction must wait for an async result or when an async pipeline must atomically update shared state:

```haskell
-- Haskell: perform I/O asynchronously, then commit to STM
do result <- async (fetchRemoteData url)
   val <- wait result
   atomically $ writeTVar cache val
```

The boundary is sharp: futures handle the async I/O; STM handles the shared-state update. Mixing them (e.g., performing I/O inside a transaction) violates STM's retry-safety invariant.

## Structured Concurrency

Unstructured futures leak: a spawned future outlives its logical scope, holding resources and producing orphaned errors. Structured concurrency (Kotlin coroutines, Java 21 virtual threads with `StructuredTaskScope`, Trio in Python) binds future lifetimes to scopes:

```kotlin
coroutineScope {
    val user = async { fetchUser(id) }
    val posts = async { fetchPosts(id) }
    renderPage(user.await(), posts.await())
}  // scope waits for both; cancels siblings on failure
```

If `fetchUser` fails, `fetchPosts` is cancelled automatically. No orphaned futures, no leaked connections. This is the modern direction: structured concurrency replaces manual future lifecycle management with scope-based guarantees.

## Backpressure and Bounded Concurrency

Unbounded `Future.sequence` over a large collection creates unbounded concurrency. Production code needs bounded parallelism:

```scala
Source(urls)
  .mapAsync(parallelism = 8)(url => fetchData(url))
  .runWith(Sink.seq)
```

This processes at most 8 URLs concurrently, applying backpressure when downstream can't keep up. Without explicit bounds, futures easily overwhelm connection pools, file descriptors, or memory — a failure mode that doesn't exist with synchronous STM transactions.
