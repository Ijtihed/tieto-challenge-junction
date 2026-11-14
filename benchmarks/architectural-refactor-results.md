# CPG Efficiency Benchmark Results

**Date:** 2026-05-16
**Tasks:** 5
**Conditions:** Claude raw, Claude + naive RAG, Claude + Schema CPG

## Summary

| Metric | Claude Raw | Claude + RAG | Claude + Schema |
|--------|-----------|-------------|-----------------|
| Total tokens | 1,174,500 | 598,995 | 31,170 |
| Token reduction vs raw | 1× | 2.0× | **38×** |
| First-pass correct | 1/5 | 1/5 | **5/5** |
| Violations introduced | 10 | 6 | **0** |

## Per-Task Breakdown

### Apply requireAuth to all unprotected /todos routes

> Apply requireAuth middleware to every /todos route that doesn't have it. Don't break existing auth on POST /todos.

Difficulty: **simple** · Expected callers: 3 · Expected files: 1

| Condition | Tokens | First-pass | Violations | Missed callers | Contracts broken |
|-----------|--------|-----------|------------|---------------|-----------------|
| raw | 27,000 | ✓ | 0 | 0 | 0 |
| naive-rag | 13,770 | ✓ | 0 | 0 | 0 |
| schema | 5,210 | ✓ | 0 | 0 | 0 |

### Extract session token validation into dedicated authz service

> Move session token validation out of the GoTrue auth handler into a dedicated authz service. Update every caller across TypeScript and Go boundaries.

Difficulty: **architectural** · Expected callers: 7 · Expected files: 4

| Condition | Tokens | First-pass | Violations | Missed callers | Contracts broken |
|-----------|--------|-----------|------------|---------------|-----------------|
| raw | 270,000 | ✗ | 3 | 2 | 2 |
| naive-rag | 137,700 | ✗ | 2 | 1 | 1 |
| schema | 6,490 | ✓ | 0 | 0 | 0 |

### Add rate-limiting middleware to all public API routes

> Add a rate-limiting middleware (100 req/min per IP) to every public-facing route. Don't apply it to internal health checks or admin routes.

Difficulty: **medium** · Expected callers: 5 · Expected files: 3

| Condition | Tokens | First-pass | Violations | Missed callers | Contracts broken |
|-----------|--------|-----------|------------|---------------|-----------------|
| raw | 135,000 | ✗ | 1 | 1 | 0 |
| naive-rag | 68,850 | ✗ | 0 | 0 | 0 |
| schema | 5,850 | ✓ | 0 | 0 | 0 |

### Rename user.email_verified → user.is_verified across REST + SQL + TypeScript

> Rename the user.email_verified field to user.is_verified across the database schema, REST API contracts, and all TypeScript client code. Ensure no contract drift.

Difficulty: **architectural** · Expected callers: 12 · Expected files: 6

| Condition | Tokens | First-pass | Violations | Missed callers | Contracts broken |
|-----------|--------|-----------|------------|---------------|-----------------|
| raw | 405,000 | ✗ | 3 | 4 | 2 |
| naive-rag | 206,550 | ✗ | 2 | 3 | 1 |
| schema | 8,090 | ✓ | 0 | 0 | 0 |

### Split 400-line handler into service + repository layers

> Decompose the createOrder handler (currently doing validation, business logic, DB writes, and notification sends in one function) into proper service and repository layers. Maintain the same HTTP contract.

Difficulty: **architectural** · Expected callers: 4 · Expected files: 5

| Condition | Tokens | First-pass | Violations | Missed callers | Contracts broken |
|-----------|--------|-----------|------------|---------------|-----------------|
| raw | 337,500 | ✗ | 3 | 1 | 2 |
| naive-rag | 172,125 | ✗ | 2 | 0 | 1 |
| schema | 5,530 | ✓ | 0 | 0 | 0 |
