---
id: "stm-channel-based"
paradigm: stm
title: "Channel-Based Concurrency"
author: "Schema team"
license: "MIT"
sourceUrl: "https://schema.dev/canon/stm/channel-based"
---

# Channel-Based Concurrency

Channel-based concurrency structures communication between concurrent processes through typed, bounded conduits. The principle — "don't communicate by sharing memory; share memory by communicating" — originates with CSP (Communicating Sequential Processes) and is the primary concurrency model in Go, a major pattern in Clojure's core.async, and available in Rust through `mpsc` and crossbeam channels.

## Go Channels

Go channels are first-class typed conduits with optional buffering. A send on an unbuffered channel blocks until a receiver is ready, creating a synchronisation point:

```go
ch := make(chan int)      // unbuffered
buf := make(chan int, 10) // buffered, capacity 10

go func() {
    result := expensiveComputation()
    ch <- result  // blocks until receiver reads
}()

val := <-ch  // blocks until sender writes
```

`select` multiplexes across multiple channels, enabling timeout patterns and fan-in:

```go
select {
case msg := <-inbox:
    handle(msg)
case <-time.After(5 * time.Second):
    handleTimeout()
case outbox <- result:
    // sent successfully
}
```

The directional channel type system (`chan<-` for send-only, `<-chan` for receive-only) encodes protocol roles at compile time.

## Clojure core.async

core.async brings CSP to Clojure with `go` blocks (lightweight coroutines) and channels:

```clojure
(let [ch (chan 10)]
  (go
    (>! ch (expensive-computation)))  ;; park until space available
  (go
    (let [val (<! ch)]                ;; park until value available
      (process val))))
```

`<!` and `>!` are parking operations — they yield the go block's thread back to the pool, not block it. `alts!` is the Clojure equivalent of Go's `select`:

```clojure
(go
  (let [[val port] (alts! [ch1 ch2 (timeout 5000)])]
    (condp = port
      ch1     (handle-msg val)
      ch2     (handle-event val)
      :default (handle-timeout))))
```

Transducers on channels enable in-channel transformation without intermediate collections — a `(chan 10 (filter even?))` drops odd values before they reach the consumer.

## Rust mpsc and crossbeam

Rust's standard library provides `mpsc` (multi-producer, single-consumer) channels with ownership transfer:

```rust
use std::sync::mpsc;

let (tx, rx) = mpsc::channel();
let tx2 = tx.clone();  // multiple producers

std::thread::spawn(move || {
    tx.send(compute_a()).unwrap();
});
std::thread::spawn(move || {
    tx2.send(compute_b()).unwrap();
});

for received in rx {
    process(received);
}
```

Crossbeam extends this with multi-consumer channels, `select!` macro, and scoped threads that eliminate `'static` lifetime requirements.

## Channels vs STM

Channels excel at pipeline and producer-consumer patterns where data flows in one direction. STM excels at coordinated state updates where multiple variables must change atomically.

The tension surfaces in fan-in/fan-out coordination: merging results from multiple channels into a consistent state update requires application-level protocols. STM handles this atomically. Conversely, STM has no built-in notion of backpressure or flow control — channels provide this naturally through buffer bounds.

## Deadlock in Channel Systems

Channels can deadlock: two goroutines each waiting to send to the other on unbuffered channels. Go's runtime does not detect this (except for the global "all goroutines asleep" panic). Bounded buffers reduce but don't eliminate the risk. The mitigation is structural: design channel topologies as DAGs, avoid bidirectional synchronous communication, and use timeouts on all blocking operations.

## Practical Channel Patterns

- **Fan-out/fan-in:** dispatch work to N workers via one channel, collect results via another
- **Pipeline:** chain stages with channels between them, each stage a goroutine/go-block
- **Semaphore:** a buffered channel of capacity N acts as a counting semaphore
- **Cancellation:** a close-only channel (Go's `done` idiom or `context.Done()`) broadcasts shutdown to all listeners
