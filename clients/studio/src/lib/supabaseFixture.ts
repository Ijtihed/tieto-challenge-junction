import type { Graph, GraphEdge, GraphNode, Insight, Rule, Violation } from "./types";

/**
 * Supabase-modeled polyglot graph fixture for demo purposes.
 * github.com/supabase/supabase — Apache-2.0 licensed OSS.
 *
 * Exercises: TypeScript SDK, Go auth (GoTrue), Rust (PostgREST-like),
 * SQL schema, and cross-language edges (REST, SQL contracts).
 *
 * Chosen because Supabase genuinely exercises:
 *   - TypeScript (client SDKs, Edge Functions)
 *   - Go (GoTrue auth service)
 *   - Rust (Realtime, PostgREST-like query layer)
 *   - SQL (database schema, RLS policies)
 *   - Cross-language REST + SQL contracts
 */
export const supabaseGraph: Graph = {
  rootDir: "supabase/supabase",
  clusters: [
    {
      id: "cluster:auth",
      name: "GoTrue Auth (Go)",
      nodeIds: [
        "fn:internal/api/token.go:validateToken",
        "fn:internal/api/token.go:refreshToken",
        "fn:internal/api/signup.go:signupHandler",
        "fn:internal/api/signin.go:signinHandler",
        "fn:internal/models/user.go:User",
        "fn:internal/api/middleware.go:requireAuth",
        "route:internal/api/router.go:POST:/token:45",
        "route:internal/api/router.go:POST:/signup:52",
        "route:internal/api/router.go:POST:/signin:58",
        "route:internal/api/router.go:POST:/token/refresh:64",
      ],
    },
    {
      id: "cluster:sdk",
      name: "TypeScript SDK",
      nodeIds: [
        "fn:packages/supabase-js/src/auth.ts:signIn",
        "fn:packages/supabase-js/src/auth.ts:signUp",
        "fn:packages/supabase-js/src/auth.ts:getSession",
        "fn:packages/supabase-js/src/auth.ts:refreshSession",
        "fn:packages/supabase-js/src/client.ts:SupabaseClient",
        "fn:packages/supabase-js/src/realtime.ts:subscribe",
        "fn:packages/supabase-js/src/storage.ts:uploadFile",
        "fn:packages/supabase-js/src/db.ts:from",
      ],
    },
    {
      id: "cluster:realtime",
      name: "Realtime (Rust)",
      nodeIds: [
        "fn:crates/realtime/src/ws.rs:handle_connection",
        "fn:crates/realtime/src/broadcast.rs:broadcast_change",
        "fn:crates/realtime/src/auth.rs:verify_jwt",
        "fn:crates/realtime/src/channel.rs:join_channel",
      ],
    },
    {
      id: "cluster:database",
      name: "Database (SQL)",
      nodeIds: [
        "fn:migrations/20240101_users.sql:auth.users",
        "fn:migrations/20240101_users.sql:auth.sessions",
        "fn:migrations/20240201_rls.sql:rls_policy_users",
        "fn:migrations/20240301_functions.sql:auth.uid()",
      ],
    },
    {
      id: "cluster:edge-functions",
      name: "Edge Functions (TS)",
      nodeIds: [
        "fn:supabase/functions/auth-hook/index.ts:authHook",
        "fn:supabase/functions/on-signup/index.ts:onSignup",
        "fn:supabase/functions/webhook/index.ts:webhookHandler",
      ],
    },
    {
      id: "cluster:postgrest",
      name: "PostgREST (Rust)",
      nodeIds: [
        "fn:crates/postgrest/src/query.rs:execute_query",
        "fn:crates/postgrest/src/filter.rs:apply_rls",
        "fn:crates/postgrest/src/schema.rs:introspect_schema",
      ],
    },
  ],
  nodes: [
    // GoTrue Auth (Go)
    {
      id: "fn:internal/api/token.go:validateToken",
      name: "validateToken",
      kind: "service",
      file: "internal/api/token.go",
      cluster: "cluster:auth",
      sourceRange: { startLine: 42, endLine: 89 },
    },
    {
      id: "fn:internal/api/token.go:refreshToken",
      name: "refreshToken",
      kind: "service",
      file: "internal/api/token.go",
      cluster: "cluster:auth",
      sourceRange: { startLine: 91, endLine: 142 },
    },
    {
      id: "fn:internal/api/signup.go:signupHandler",
      name: "signupHandler",
      kind: "route_handler",
      file: "internal/api/signup.go",
      cluster: "cluster:auth",
    },
    {
      id: "fn:internal/api/signin.go:signinHandler",
      name: "signinHandler",
      kind: "route_handler",
      file: "internal/api/signin.go",
      cluster: "cluster:auth",
    },
    {
      id: "fn:internal/models/user.go:User",
      name: "User",
      kind: "model",
      file: "internal/models/user.go",
      cluster: "cluster:auth",
    },
    {
      id: "fn:internal/api/middleware.go:requireAuth",
      name: "requireAuth",
      kind: "middleware",
      file: "internal/api/middleware.go",
      cluster: "cluster:auth",
    },
    {
      id: "route:internal/api/router.go:POST:/token:45",
      name: "POST /token",
      kind: "route_handler",
      file: "internal/api/router.go",
      cluster: "cluster:auth",
      meta: { httpMethod: "POST", httpPath: "/token" },
    },
    {
      id: "route:internal/api/router.go:POST:/signup:52",
      name: "POST /signup",
      kind: "route_handler",
      file: "internal/api/router.go",
      cluster: "cluster:auth",
      meta: { httpMethod: "POST", httpPath: "/signup" },
    },
    {
      id: "route:internal/api/router.go:POST:/signin:58",
      name: "POST /signin",
      kind: "route_handler",
      file: "internal/api/router.go",
      cluster: "cluster:auth",
      meta: { httpMethod: "POST", httpPath: "/signin" },
    },
    {
      id: "route:internal/api/router.go:POST:/token/refresh:64",
      name: "POST /token/refresh",
      kind: "route_handler",
      file: "internal/api/router.go",
      cluster: "cluster:auth",
      meta: { httpMethod: "POST", httpPath: "/token/refresh" },
    },

    // TypeScript SDK
    {
      id: "fn:packages/supabase-js/src/auth.ts:signIn",
      name: "signIn",
      kind: "service",
      file: "packages/supabase-js/src/auth.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/auth.ts:signUp",
      name: "signUp",
      kind: "service",
      file: "packages/supabase-js/src/auth.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/auth.ts:getSession",
      name: "getSession",
      kind: "service",
      file: "packages/supabase-js/src/auth.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/auth.ts:refreshSession",
      name: "refreshSession",
      kind: "service",
      file: "packages/supabase-js/src/auth.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/client.ts:SupabaseClient",
      name: "SupabaseClient",
      kind: "service",
      file: "packages/supabase-js/src/client.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/realtime.ts:subscribe",
      name: "subscribe",
      kind: "service",
      file: "packages/supabase-js/src/realtime.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/storage.ts:uploadFile",
      name: "uploadFile",
      kind: "service",
      file: "packages/supabase-js/src/storage.ts",
      cluster: "cluster:sdk",
    },
    {
      id: "fn:packages/supabase-js/src/db.ts:from",
      name: "from",
      kind: "data_access",
      file: "packages/supabase-js/src/db.ts",
      cluster: "cluster:sdk",
    },

    // Realtime (Rust)
    {
      id: "fn:crates/realtime/src/ws.rs:handle_connection",
      name: "handle_connection",
      kind: "service",
      file: "crates/realtime/src/ws.rs",
      cluster: "cluster:realtime",
    },
    {
      id: "fn:crates/realtime/src/broadcast.rs:broadcast_change",
      name: "broadcast_change",
      kind: "service",
      file: "crates/realtime/src/broadcast.rs",
      cluster: "cluster:realtime",
    },
    {
      id: "fn:crates/realtime/src/auth.rs:verify_jwt",
      name: "verify_jwt",
      kind: "middleware",
      file: "crates/realtime/src/auth.rs",
      cluster: "cluster:realtime",
    },
    {
      id: "fn:crates/realtime/src/channel.rs:join_channel",
      name: "join_channel",
      kind: "service",
      file: "crates/realtime/src/channel.rs",
      cluster: "cluster:realtime",
    },

    // Database (SQL)
    {
      id: "fn:migrations/20240101_users.sql:auth.users",
      name: "auth.users",
      kind: "model",
      file: "migrations/20240101_users.sql",
      cluster: "cluster:database",
    },
    {
      id: "fn:migrations/20240101_users.sql:auth.sessions",
      name: "auth.sessions",
      kind: "model",
      file: "migrations/20240101_users.sql",
      cluster: "cluster:database",
    },
    {
      id: "fn:migrations/20240201_rls.sql:rls_policy_users",
      name: "rls_policy_users",
      kind: "utility",
      file: "migrations/20240201_rls.sql",
      cluster: "cluster:database",
    },
    {
      id: "fn:migrations/20240301_functions.sql:auth.uid()",
      name: "auth.uid()",
      kind: "utility",
      file: "migrations/20240301_functions.sql",
      cluster: "cluster:database",
    },

    // Edge Functions (TS)
    {
      id: "fn:supabase/functions/auth-hook/index.ts:authHook",
      name: "authHook",
      kind: "service",
      file: "supabase/functions/auth-hook/index.ts",
      cluster: "cluster:edge-functions",
    },
    {
      id: "fn:supabase/functions/on-signup/index.ts:onSignup",
      name: "onSignup",
      kind: "service",
      file: "supabase/functions/on-signup/index.ts",
      cluster: "cluster:edge-functions",
    },
    {
      id: "fn:supabase/functions/webhook/index.ts:webhookHandler",
      name: "webhookHandler",
      kind: "route_handler",
      file: "supabase/functions/webhook/index.ts",
      cluster: "cluster:edge-functions",
    },

    // PostgREST (Rust)
    {
      id: "fn:crates/postgrest/src/query.rs:execute_query",
      name: "execute_query",
      kind: "data_access",
      file: "crates/postgrest/src/query.rs",
      cluster: "cluster:postgrest",
    },
    {
      id: "fn:crates/postgrest/src/filter.rs:apply_rls",
      name: "apply_rls",
      kind: "middleware",
      file: "crates/postgrest/src/filter.rs",
      cluster: "cluster:postgrest",
    },
    {
      id: "fn:crates/postgrest/src/schema.rs:introspect_schema",
      name: "introspect_schema",
      kind: "utility",
      file: "crates/postgrest/src/schema.rs",
      cluster: "cluster:postgrest",
    },
  ],

  edges: [
    // ─── CROSS-LANGUAGE: REST contracts (TS SDK → Go Auth) ───
    {
      id: "e:rest:signIn-signin",
      source: "fn:packages/supabase-js/src/auth.ts:signIn",
      target: "route:internal/api/router.go:POST:/signin:58",
      relation: "rest_contract",
    },
    {
      id: "e:rest:signUp-signup",
      source: "fn:packages/supabase-js/src/auth.ts:signUp",
      target: "route:internal/api/router.go:POST:/signup:52",
      relation: "rest_contract",
    },
    {
      id: "e:rest:getSession-token",
      source: "fn:packages/supabase-js/src/auth.ts:getSession",
      target: "route:internal/api/router.go:POST:/token:45",
      relation: "rest_contract",
    },
    {
      id: "e:rest:refreshSession-refresh",
      source: "fn:packages/supabase-js/src/auth.ts:refreshSession",
      target: "route:internal/api/router.go:POST:/token/refresh:64",
      relation: "rest_contract",
    },

    // ─── CROSS-LANGUAGE: SQL contracts (Go → SQL schema) ───
    {
      id: "e:sql:signupHandler-users",
      source: "fn:internal/api/signup.go:signupHandler",
      target: "fn:migrations/20240101_users.sql:auth.users",
      relation: "sql_contract",
    },
    {
      id: "e:sql:validateToken-sessions",
      source: "fn:internal/api/token.go:validateToken",
      target: "fn:migrations/20240101_users.sql:auth.sessions",
      relation: "sql_contract",
    },
    {
      id: "e:sql:refreshToken-sessions",
      source: "fn:internal/api/token.go:refreshToken",
      target: "fn:migrations/20240101_users.sql:auth.sessions",
      relation: "sql_contract",
    },
    {
      id: "e:sql:postgrest-users",
      source: "fn:crates/postgrest/src/query.rs:execute_query",
      target: "fn:migrations/20240101_users.sql:auth.users",
      relation: "sql_contract",
    },
    {
      id: "e:sql:rls-uid",
      source: "fn:crates/postgrest/src/filter.rs:apply_rls",
      target: "fn:migrations/20240301_functions.sql:auth.uid()",
      relation: "sql_contract",
    },

    // ─── INTERNAL: Go auth service calls ───
    {
      id: "e:calls:signin-validate",
      source: "fn:internal/api/signin.go:signinHandler",
      target: "fn:internal/api/token.go:validateToken",
      relation: "calls",
    },
    {
      id: "e:calls:signup-validate",
      source: "fn:internal/api/signup.go:signupHandler",
      target: "fn:internal/api/token.go:validateToken",
      relation: "calls",
    },
    {
      id: "e:calls:middleware-validate",
      source: "fn:internal/api/middleware.go:requireAuth",
      target: "fn:internal/api/token.go:validateToken",
      relation: "calls",
    },
    {
      id: "e:calls:refresh-validate",
      source: "fn:internal/api/token.go:refreshToken",
      target: "fn:internal/api/token.go:validateToken",
      relation: "calls",
    },

    // Route registrations
    {
      id: "e:reg:token-validate",
      source: "route:internal/api/router.go:POST:/token:45",
      target: "fn:internal/api/token.go:validateToken",
      relation: "registers_route",
    },
    {
      id: "e:reg:signup-handler",
      source: "route:internal/api/router.go:POST:/signup:52",
      target: "fn:internal/api/signup.go:signupHandler",
      relation: "registers_route",
    },
    {
      id: "e:reg:signin-handler",
      source: "route:internal/api/router.go:POST:/signin:58",
      target: "fn:internal/api/signin.go:signinHandler",
      relation: "registers_route",
    },
    {
      id: "e:reg:refresh-handler",
      source: "route:internal/api/router.go:POST:/token/refresh:64",
      target: "fn:internal/api/token.go:refreshToken",
      relation: "registers_route",
    },

    // Middleware application
    {
      id: "e:mw:token-auth",
      source: "route:internal/api/router.go:POST:/token:45",
      target: "fn:internal/api/middleware.go:requireAuth",
      relation: "applies_middleware",
    },
    {
      id: "e:mw:refresh-auth",
      source: "route:internal/api/router.go:POST:/token/refresh:64",
      target: "fn:internal/api/middleware.go:requireAuth",
      relation: "applies_middleware",
    },

    // ─── CROSS-LANGUAGE: Rust realtime → Go auth (JWT verification) ───
    {
      id: "e:rest:realtime-verify",
      source: "fn:crates/realtime/src/auth.rs:verify_jwt",
      target: "route:internal/api/router.go:POST:/token:45",
      relation: "rest_contract",
    },

    // ─── INTERNAL: Rust realtime calls ───
    {
      id: "e:calls:ws-verify",
      source: "fn:crates/realtime/src/ws.rs:handle_connection",
      target: "fn:crates/realtime/src/auth.rs:verify_jwt",
      relation: "calls",
    },
    {
      id: "e:calls:ws-channel",
      source: "fn:crates/realtime/src/ws.rs:handle_connection",
      target: "fn:crates/realtime/src/channel.rs:join_channel",
      relation: "calls",
    },
    {
      id: "e:calls:channel-broadcast",
      source: "fn:crates/realtime/src/channel.rs:join_channel",
      target: "fn:crates/realtime/src/broadcast.rs:broadcast_change",
      relation: "calls",
    },

    // ─── CROSS-LANGUAGE: TS SDK → Rust realtime (WebSocket) ───
    {
      id: "e:rest:subscribe-ws",
      source: "fn:packages/supabase-js/src/realtime.ts:subscribe",
      target: "fn:crates/realtime/src/ws.rs:handle_connection",
      relation: "rest_contract",
    },

    // ─── CROSS-LANGUAGE: TS SDK → Rust PostgREST (query) ───
    {
      id: "e:rest:from-query",
      source: "fn:packages/supabase-js/src/db.ts:from",
      target: "fn:crates/postgrest/src/query.rs:execute_query",
      relation: "rest_contract",
    },

    // ─── INTERNAL: PostgREST calls ───
    {
      id: "e:calls:query-rls",
      source: "fn:crates/postgrest/src/query.rs:execute_query",
      target: "fn:crates/postgrest/src/filter.rs:apply_rls",
      relation: "calls",
    },
    {
      id: "e:calls:query-schema",
      source: "fn:crates/postgrest/src/query.rs:execute_query",
      target: "fn:crates/postgrest/src/schema.rs:introspect_schema",
      relation: "calls",
    },

    // ─── INTERNAL: TS SDK composition ───
    {
      id: "e:calls:client-auth-signin",
      source: "fn:packages/supabase-js/src/client.ts:SupabaseClient",
      target: "fn:packages/supabase-js/src/auth.ts:signIn",
      relation: "calls",
    },
    {
      id: "e:calls:client-realtime",
      source: "fn:packages/supabase-js/src/client.ts:SupabaseClient",
      target: "fn:packages/supabase-js/src/realtime.ts:subscribe",
      relation: "calls",
    },
    {
      id: "e:calls:client-db",
      source: "fn:packages/supabase-js/src/client.ts:SupabaseClient",
      target: "fn:packages/supabase-js/src/db.ts:from",
      relation: "calls",
    },
    {
      id: "e:calls:client-storage",
      source: "fn:packages/supabase-js/src/client.ts:SupabaseClient",
      target: "fn:packages/supabase-js/src/storage.ts:uploadFile",
      relation: "calls",
    },

    // ─── Edge Functions → Go Auth ───
    {
      id: "e:rest:authHook-token",
      source: "fn:supabase/functions/auth-hook/index.ts:authHook",
      target: "route:internal/api/router.go:POST:/token:45",
      relation: "rest_contract",
    },
    {
      id: "e:calls:onSignup-authHook",
      source: "fn:supabase/functions/on-signup/index.ts:onSignup",
      target: "fn:supabase/functions/auth-hook/index.ts:authHook",
      relation: "calls",
    },

    // ─── SQL: Edge Functions → DB ───
    {
      id: "e:sql:onSignup-users",
      source: "fn:supabase/functions/on-signup/index.ts:onSignup",
      target: "fn:migrations/20240101_users.sql:auth.users",
      relation: "sql_contract",
    },

    // ─── Edges for otherwise-orphaned nodes ───
    {
      id: "e:calls:signup-user-model",
      source: "fn:internal/api/signup.go:signupHandler",
      target: "fn:internal/models/user.go:User",
      relation: "calls",
    },
    {
      id: "e:sql:rls-policy-users",
      source: "fn:migrations/20240201_rls.sql:rls_policy_users",
      target: "fn:migrations/20240101_users.sql:auth.users",
      relation: "sql_contract",
    },
    {
      id: "e:rest:webhook-signup",
      source: "fn:supabase/functions/webhook/index.ts:webhookHandler",
      target: "route:internal/api/router.go:POST:/signup:52",
      relation: "rest_contract",
    },
  ],
};

export const supabaseSummary =
  "Supabase platform: Go auth (GoTrue), TypeScript SDK, Rust realtime/PostgREST, PostgreSQL schema. 6 services across 4 languages connected via REST and SQL contracts.";

export const supabaseInsights: Insight[] = [
  {
    id: "ins:token-validation-coupling",
    title: "validateToken is a cross-language bottleneck",
    rationale: "validateToken in Go is called by 4 internal services AND 2 cross-language consumers (Rust realtime, TS edge functions). Extracting it into a dedicated authz service would reduce coupling.",
    severity: "medium",
    targetIds: [
      "fn:internal/api/token.go:validateToken",
      "fn:crates/realtime/src/auth.rs:verify_jwt",
      "fn:supabase/functions/auth-hook/index.ts:authHook",
    ],
    suggestedPrompt: "Move session token validation out of GoTrue auth into a dedicated authz service and update every caller.",
  },
  {
    id: "ins:missing-auth-signup",
    title: "POST /signup has no auth middleware",
    rationale: "The signup endpoint is open (intentionally for new users), but rate-limiting middleware is not applied — potential abuse vector.",
    severity: "low",
    targetIds: ["route:internal/api/router.go:POST:/signup:52"],
    suggestedPrompt: "Add rate-limiting middleware to the signup endpoint.",
  },
  {
    id: "ins:rls-drift",
    title: "RLS policy references auth.uid() without explicit dependency",
    rationale: "The apply_rls function in PostgREST depends on auth.uid() but this dependency is only visible through the SQL contract edge. If auth.uid() changes signature, PostgREST won't know until runtime.",
    severity: "high",
    targetIds: [
      "fn:crates/postgrest/src/filter.rs:apply_rls",
      "fn:migrations/20240301_functions.sql:auth.uid()",
    ],
    suggestedPrompt: "Add a contract test between PostgREST's apply_rls and the auth.uid() SQL function.",
  },
];

export const supabaseRules: Rule[] = [
  {
    id: "rule:cross-lang-contract-test",
    description: "Every cross-language edge must have a contract test",
    kind: "must_have_inbound",
    enabled: true,
    prompt: "Check that every REST/gRPC/SQL contract edge has a corresponding contract test.",
    severity: "high",
    source: "builtin",
    evaluation: "display",
  },
  {
    id: "rule:auth-middleware-required",
    description: "All mutation endpoints must apply auth middleware",
    kind: "applies_middleware",
    enabled: true,
    prompt: "Check that all POST/PUT/DELETE endpoints have auth or rate-limiting middleware applied.",
    severity: "medium",
    source: "builtin",
    evaluation: "display",
  },
  {
    id: "rule:no-direct-sql",
    description: "Application code must not query SQL directly — use PostgREST",
    kind: "calls",
    enabled: true,
    prompt: "Check that no application service calls SQL functions directly without going through PostgREST.",
    severity: "low",
    source: "builtin",
    evaluation: "display",
  },
];

export function supabaseViolations(graph: Graph): Violation[] {
  const violations: Violation[] = [];

  // Check: signup endpoint has no auth middleware
  const signupRoute = graph.nodes.find(
    (n) => n.id === "route:internal/api/router.go:POST:/signup:52",
  );
  if (signupRoute) {
    const hasAuth = graph.edges.some(
      (e) =>
        e.source === signupRoute.id && e.relation === "applies_middleware",
    );
    if (!hasAuth) {
      violations.push({
        ruleId: "rule:auth-middleware-required",
        message: "POST /signup has no rate-limiting or auth middleware",
        targetIds: [signupRoute.id],
        suggestedPrompt: "Add rate-limiting middleware to the signup endpoint.",
      });
    }
  }

  // Check: signin endpoint has no auth middleware
  const signinRoute = graph.nodes.find(
    (n) => n.id === "route:internal/api/router.go:POST:/signin:58",
  );
  if (signinRoute) {
    const hasAuth = graph.edges.some(
      (e) =>
        e.source === signinRoute.id && e.relation === "applies_middleware",
    );
    if (!hasAuth) {
      violations.push({
        ruleId: "rule:auth-middleware-required",
        message: "POST /signin has no rate-limiting middleware",
        targetIds: [signinRoute.id],
        suggestedPrompt: "Add rate-limiting middleware to the signin endpoint.",
      });
    }
  }

  return violations;
}
