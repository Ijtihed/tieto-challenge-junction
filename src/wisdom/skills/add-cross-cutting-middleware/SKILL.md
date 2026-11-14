# Add Cross-cutting Middleware

Insert auth, logging, rate-limiting, or validation middleware consistently across multiple route handlers.

## When to use

- The same concern (auth check, request logging, input validation, rate limiting) needs to apply to multiple handlers
- You're adding a new cross-cutting requirement (e.g., "all admin routes must check RBAC")
- Existing handlers have inconsistent implementations of the same concern (some check auth, some don't)

## Steps

1. **Define the middleware function.** Write a single function with the middleware signature for your framework (`(req, res, next)` in Express, `async (ctx, next)` in Koa, etc.). The function should do exactly one thing. No business logic.
2. **Identify target handlers.** Run `graph.list_nodes` filtered to route handlers. Cross-reference with the concern — e.g., all handlers under `/admin/*` for RBAC, all mutation handlers for audit logging.
3. **Preview the change.** Use `ops.preview` to see which handlers will be affected before applying. Confirm the list matches your expectation — missing a handler means a security gap; hitting an extra handler means a false-positive failure.
4. **Apply the middleware.** Attach it at the router level (not per-handler) when the framework supports it. If per-handler attachment is required, apply it systematically to every target identified in step 2.
5. **Verify coverage.** Run `rules.evaluate` with a rule asserting "every handler matching pattern X has middleware Y applied." This catches current gaps and prevents future regressions.
6. **Test the edges.** Write tests for: middleware passes (happy path), middleware rejects (returns 401/403/429), middleware is absent on routes it shouldn't touch.

## Anti-patterns

- Copying the middleware logic into each handler (defeats the purpose of cross-cutting)
- Applying middleware globally when only a subset of routes need it (causes false rejections on public endpoints)
- Forgetting to test the rejection path — the middleware exists but has never actually blocked a request

## Example

A new compliance requirement says all `/api/admin/*` endpoints must enforce RBAC. You write a `requireRole('admin')` middleware, run `graph.list_nodes` to find 12 admin handlers, attach the middleware at the `/api/admin` router level, then add a `rules.evaluate` rule: "every handler under `/api/admin` must have RBAC middleware." Three months later, a new developer adds a 13th admin route — the rule catches the missing middleware in CI.
