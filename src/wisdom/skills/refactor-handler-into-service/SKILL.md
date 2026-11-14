# Refactor Handler into Service

Extract business logic from a route handler into a testable service layer.

## When to use

- Handler exceeds ~30 lines of logic
- Handler imports database or ORM modules directly
- Handler contains conditional business logic (validation, branching, computation)
- You need to reuse the same logic from a second entry point (CLI, queue worker, scheduled job)

## Steps

1. **Identify extractable logic.** Run `graph.find_callees` on the handler to see what it touches. Everything that isn't request-parsing or response-formatting is a service candidate.
2. **Create the service file.** Place it adjacent to the handler or in a `services/` directory. Name it after the domain concept, not the HTTP verb (`OrderFulfillment`, not `PostOrder`).
3. **Move logic into a pure function.** The service function takes domain inputs (not `req`/`res`/`ctx`) and returns a result or throws a domain error. No framework types cross the boundary.
4. **Thin the handler.** The handler becomes: parse request → call service → format response. Three lines, no branches.
5. **Write unit tests for the service.** Test business rules with plain objects. No HTTP fixtures, no mocks of the framework.
6. **Convert the handler test to integration.** The handler test now only asserts HTTP-level concerns: status codes, content-type, auth gating. It calls the real service.
7. **Verify structure.** Run `rules.evaluate` to confirm the handler no longer imports database modules directly. Run `graph.summary` to confirm the new service node appears in the graph.

## Anti-patterns

- Moving `req`/`res` into the service function (leaks transport concerns)
- Creating a service that mirrors the handler 1:1 with no added testability
- Skipping the integration test because "the unit test covers it"

## Example

A `POST /orders` handler validates inventory, calculates pricing, writes to the database, and sends a confirmation email — all inline. After extraction: `OrderService.fulfill(items, customer)` contains the logic and returns `{ order, invoice }`. The handler calls it, sets `res.status(201)`, and returns the result. The service is now testable without spinning up an HTTP server, and the same `fulfill` call works from a CLI backfill script.
