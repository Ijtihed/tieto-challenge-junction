import type { Graph, GraphEdge, GraphNode, Insight, Rule, Violation, CoverageMap } from "./types";
import {
  supabaseGraph,
  supabaseSummary,
  supabaseInsights,
  supabaseRules,
  supabaseViolations,
} from "./supabaseFixture";

/**
 * The bundled example workspace: acme/todos-api, an Express + JWT + SQLite
 * todos service. It ships with a deliberate architectural smell —
 * requireAuth is applied to POST /todos but not to GET /todos or
 * DELETE /todos/:id — so users see Insights work the moment they open the
 * app. Replaced by extracted graphs from real repos.
 */
export const fixtureGraph: Graph = {
  rootDir: "acme/todos-api",
  clusters: [
    {
      id: "cluster:auth",
      name: "Auth",
      nodeIds: [
        "fn:src/middleware/auth.ts:requireAuth",
        "fn:src/services/authService.ts:verifyToken",
        "fn:src/services/authService.ts:signToken",
        "fn:src/routes/auth.ts:loginHandler",
        "route:src/routes/auth.ts:POST:/auth/login:11",
      ],
    },
    {
      id: "cluster:todos",
      name: "Todos",
      nodeIds: [
        "fn:src/services/todoService.ts:listTodos",
        "fn:src/services/todoService.ts:createTodo",
        "fn:src/services/todoService.ts:deleteTodo",
        "fn:src/routes/todos.ts:listHandler",
        "fn:src/routes/todos.ts:createHandler",
        "fn:src/routes/todos.ts:deleteHandler",
        "route:src/routes/todos.ts:GET:/todos:14",
        "route:src/routes/todos.ts:POST:/todos:21",
        "route:src/routes/todos.ts:DELETE:/todos/:id:32",
      ],
    },
    {
      id: "cluster:database",
      name: "Database",
      nodeIds: [
        "fn:src/repos/todoRepo.ts:findAll",
        "fn:src/repos/todoRepo.ts:insert",
        "fn:src/repos/todoRepo.ts:remove",
        "fn:src/repos/userRepo.ts:findByEmail",
        "fn:src/db/connection.ts:getDb",
      ],
    },
    {
      id: "cluster:models",
      name: "Models",
      nodeIds: ["fn:src/models/Todo.ts:Todo", "fn:src/models/User.ts:User"],
    },
  ],
  nodes: [
    // Auth
    {
      id: "fn:src/middleware/auth.ts:requireAuth",
      name: "requireAuth",
      kind: "middleware",
      file: "src/middleware/auth.ts",
      cluster: "cluster:auth",
      sourceRange: { startLine: 6, endLine: 22 },
    },
    {
      id: "fn:src/services/authService.ts:verifyToken",
      name: "verifyToken",
      kind: "service",
      file: "src/services/authService.ts",
      cluster: "cluster:auth",
    },
    {
      id: "fn:src/services/authService.ts:signToken",
      name: "signToken",
      kind: "service",
      file: "src/services/authService.ts",
      cluster: "cluster:auth",
    },
    {
      id: "fn:src/routes/auth.ts:loginHandler",
      name: "loginHandler",
      kind: "route_handler",
      file: "src/routes/auth.ts",
      cluster: "cluster:auth",
    },
    {
      id: "route:src/routes/auth.ts:POST:/auth/login:11",
      name: "POST /auth/login",
      kind: "route_handler",
      file: "src/routes/auth.ts",
      cluster: "cluster:auth",
      meta: { httpMethod: "POST", httpPath: "/auth/login" },
    },

    // Todos services
    {
      id: "fn:src/services/todoService.ts:listTodos",
      name: "listTodos",
      kind: "service",
      file: "src/services/todoService.ts",
      cluster: "cluster:todos",
    },
    {
      id: "fn:src/services/todoService.ts:createTodo",
      name: "createTodo",
      kind: "service",
      file: "src/services/todoService.ts",
      cluster: "cluster:todos",
    },
    {
      id: "fn:src/services/todoService.ts:deleteTodo",
      name: "deleteTodo",
      kind: "service",
      file: "src/services/todoService.ts",
      cluster: "cluster:todos",
    },

    // Todos handlers
    {
      id: "fn:src/routes/todos.ts:listHandler",
      name: "listHandler",
      kind: "route_handler",
      file: "src/routes/todos.ts",
      cluster: "cluster:todos",
    },
    {
      id: "fn:src/routes/todos.ts:createHandler",
      name: "createHandler",
      kind: "route_handler",
      file: "src/routes/todos.ts",
      cluster: "cluster:todos",
    },
    {
      id: "fn:src/routes/todos.ts:deleteHandler",
      name: "deleteHandler",
      kind: "route_handler",
      file: "src/routes/todos.ts",
      cluster: "cluster:todos",
    },

    // Routes (HTTP)
    {
      id: "route:src/routes/todos.ts:GET:/todos:14",
      name: "GET /todos",
      kind: "route_handler",
      file: "src/routes/todos.ts",
      cluster: "cluster:todos",
      meta: { httpMethod: "GET", httpPath: "/todos" },
    },
    {
      id: "route:src/routes/todos.ts:POST:/todos:21",
      name: "POST /todos",
      kind: "route_handler",
      file: "src/routes/todos.ts",
      cluster: "cluster:todos",
      meta: { httpMethod: "POST", httpPath: "/todos" },
    },
    {
      id: "route:src/routes/todos.ts:DELETE:/todos/:id:32",
      name: "DELETE /todos/:id",
      kind: "route_handler",
      file: "src/routes/todos.ts",
      cluster: "cluster:todos",
      meta: { httpMethod: "DELETE", httpPath: "/todos/:id" },
    },

    // Database
    {
      id: "fn:src/repos/todoRepo.ts:findAll",
      name: "findAll",
      kind: "data_access",
      file: "src/repos/todoRepo.ts",
      cluster: "cluster:database",
    },
    {
      id: "fn:src/repos/todoRepo.ts:insert",
      name: "insert",
      kind: "data_access",
      file: "src/repos/todoRepo.ts",
      cluster: "cluster:database",
    },
    {
      id: "fn:src/repos/todoRepo.ts:remove",
      name: "remove",
      kind: "data_access",
      file: "src/repos/todoRepo.ts",
      cluster: "cluster:database",
    },
    {
      id: "fn:src/repos/userRepo.ts:findByEmail",
      name: "findByEmail",
      kind: "data_access",
      file: "src/repos/userRepo.ts",
      cluster: "cluster:database",
    },
    {
      id: "fn:src/db/connection.ts:getDb",
      name: "getDb",
      kind: "utility",
      file: "src/db/connection.ts",
      cluster: "cluster:database",
    },

    // Models
    {
      id: "fn:src/models/Todo.ts:Todo",
      name: "Todo",
      kind: "model",
      file: "src/models/Todo.ts",
      cluster: "cluster:models",
    },
    {
      id: "fn:src/models/User.ts:User",
      name: "User",
      kind: "model",
      file: "src/models/User.ts",
      cluster: "cluster:models",
    },
  ],

  edges: [
    // POST /todos has requireAuth applied
    {
      id: "e:applies:post-todos:requireAuth",
      source: "route:src/routes/todos.ts:POST:/todos:21",
      target: "fn:src/middleware/auth.ts:requireAuth",
      relation: "applies_middleware",
    },

    // Route registrations: route → handler
    {
      id: "e:registers:get-todos",
      source: "route:src/routes/todos.ts:GET:/todos:14",
      target: "fn:src/routes/todos.ts:listHandler",
      relation: "registers_route",
    },
    {
      id: "e:registers:post-todos",
      source: "route:src/routes/todos.ts:POST:/todos:21",
      target: "fn:src/routes/todos.ts:createHandler",
      relation: "registers_route",
    },
    {
      id: "e:registers:delete-todos",
      source: "route:src/routes/todos.ts:DELETE:/todos/:id:32",
      target: "fn:src/routes/todos.ts:deleteHandler",
      relation: "registers_route",
    },
    {
      id: "e:registers:post-login",
      source: "route:src/routes/auth.ts:POST:/auth/login:11",
      target: "fn:src/routes/auth.ts:loginHandler",
      relation: "registers_route",
    },

    // Calls: handler → service
    {
      id: "e:calls:listH-listTodos",
      source: "fn:src/routes/todos.ts:listHandler",
      target: "fn:src/services/todoService.ts:listTodos",
      relation: "calls",
    },
    {
      id: "e:calls:createH-createTodo",
      source: "fn:src/routes/todos.ts:createHandler",
      target: "fn:src/services/todoService.ts:createTodo",
      relation: "calls",
    },
    {
      id: "e:calls:deleteH-deleteTodo",
      source: "fn:src/routes/todos.ts:deleteHandler",
      target: "fn:src/services/todoService.ts:deleteTodo",
      relation: "calls",
    },
    {
      id: "e:calls:loginH-signToken",
      source: "fn:src/routes/auth.ts:loginHandler",
      target: "fn:src/services/authService.ts:signToken",
      relation: "calls",
    },
    {
      id: "e:calls:loginH-findByEmail",
      source: "fn:src/routes/auth.ts:loginHandler",
      target: "fn:src/repos/userRepo.ts:findByEmail",
      relation: "calls",
    },

    // requireAuth → verifyToken
    {
      id: "e:calls:requireAuth-verifyToken",
      source: "fn:src/middleware/auth.ts:requireAuth",
      target: "fn:src/services/authService.ts:verifyToken",
      relation: "calls",
    },

    // Service → repo
    {
      id: "e:calls:listTodos-findAll",
      source: "fn:src/services/todoService.ts:listTodos",
      target: "fn:src/repos/todoRepo.ts:findAll",
      relation: "calls",
    },
    {
      id: "e:calls:createTodo-insert",
      source: "fn:src/services/todoService.ts:createTodo",
      target: "fn:src/repos/todoRepo.ts:insert",
      relation: "calls",
    },
    {
      id: "e:calls:deleteTodo-remove",
      source: "fn:src/services/todoService.ts:deleteTodo",
      target: "fn:src/repos/todoRepo.ts:remove",
      relation: "calls",
    },

    // Repo → getDb
    {
      id: "e:calls:findAll-getDb",
      source: "fn:src/repos/todoRepo.ts:findAll",
      target: "fn:src/db/connection.ts:getDb",
      relation: "calls",
    },
    {
      id: "e:calls:insert-getDb",
      source: "fn:src/repos/todoRepo.ts:insert",
      target: "fn:src/db/connection.ts:getDb",
      relation: "calls",
    },
    {
      id: "e:calls:remove-getDb",
      source: "fn:src/repos/todoRepo.ts:remove",
      target: "fn:src/db/connection.ts:getDb",
      relation: "calls",
    },
    {
      id: "e:calls:findByEmail-getDb",
      source: "fn:src/repos/userRepo.ts:findByEmail",
      target: "fn:src/db/connection.ts:getDb",
      relation: "calls",
    },

    // SQL contract edges: repo → model (typed table access)
    {
      id: "e:sql:findAll-Todo",
      source: "fn:src/repos/todoRepo.ts:findAll",
      target: "fn:src/models/Todo.ts:Todo",
      relation: "sql_contract",
    },
    {
      id: "e:sql:insert-Todo",
      source: "fn:src/repos/todoRepo.ts:insert",
      target: "fn:src/models/Todo.ts:Todo",
      relation: "sql_contract",
    },
    {
      id: "e:sql:remove-Todo",
      source: "fn:src/repos/todoRepo.ts:remove",
      target: "fn:src/models/Todo.ts:Todo",
      relation: "sql_contract",
    },
    {
      id: "e:sql:findByEmail-User",
      source: "fn:src/repos/userRepo.ts:findByEmail",
      target: "fn:src/models/User.ts:User",
      relation: "sql_contract",
    },
  ],
};

export const fixtureSummary =
  "An Express + JWT + SQLite todos service split into Auth, Todos, Database, and Models. Three HTTP routes mount under /api/todos with one shared requireAuth middleware that's currently only applied to POST.";

export const fixtureReadmeExcerpt = `# acme/todos-api

A tiny Express + SQLite todos service.

- \`src/routes/\` mounts under \`/api\`
- \`src/middleware/auth.ts\` exports \`requireAuth\`, a JWT bearer-token check
- Tests live in \`tests/\` and assert that every \`/todos\` route requires auth`;

export const fixtureInsights: Insight[] = [
  {
    id: "ins:auth-asymmetry",
    title: "Auth-asymmetric routes",
    rationale:
      "POST /todos uses requireAuth, but its siblings GET /todos and DELETE /todos/:id do not. Either every /todos route needs auth or none should.",
    severity: "high",
    targetIds: [
      "route:src/routes/todos.ts:GET:/todos:14",
      "route:src/routes/todos.ts:DELETE:/todos/:id:32",
    ],
    suggestedPrompt: "Apply requireAuth middleware to every route that doesn't already have it.",
  },
  {
    id: "ins:hot-getdb",
    title: "Hot service called from many places",
    rationale:
      "getDb is called by 4 data-access functions with no caching. A connection pool or memoization at the repo layer would prevent reopening on every request.",
    severity: "medium",
    targetIds: ["fn:src/db/connection.ts:getDb"],
    suggestedPrompt: "Memoize getDb so the SQLite connection is opened once per process.",
  },
  {
    id: "ins:no-logging",
    title: "No telemetry on auth path",
    rationale:
      "loginHandler and verifyToken handle credentials but emit no logs or spans. Wrapping verifyToken with telemetry would catch slow JWT verifications.",
    severity: "low",
    targetIds: ["fn:src/services/authService.ts:verifyToken"],
    suggestedPrompt:
      "Wrap verifyToken with telemetry so JWT verifications get OpenTelemetry spans.",
  },
  {
    id: "ins:delete-no-validation",
    title: "DELETE route lacks input validation",
    rationale:
      "DELETE /todos/:id passes the route param directly to deleteTodo without validating it's a valid ID format. Malformed IDs will hit the database layer and throw unhandled errors.",
    severity: "medium",
    targetIds: [
      "route:src/routes/todos.ts:DELETE:/todos/:id:32",
      "fn:src/routes/todos.ts:deleteHandler",
    ],
    suggestedPrompt: "Add input validation to the DELETE /todos/:id handler to reject malformed IDs before they reach the service layer.",
  },
  {
    id: "ins:service-god-object",
    title: "todoService has too many responsibilities",
    rationale:
      "todoService handles listing, creation, and deletion. As the API grows, this becomes a god-object. Splitting into query (listTodos) and command (createTodo, deleteTodo) services would improve separation of concerns.",
    severity: "low",
    targetIds: [
      "fn:src/services/todoService.ts:listTodos",
      "fn:src/services/todoService.ts:createTodo",
      "fn:src/services/todoService.ts:deleteTodo",
    ],
    suggestedPrompt: "Split todoService into a query service (listTodos) and a command service (createTodo, deleteTodo).",
  },
  {
    id: "ins:model-no-validation",
    title: "Models lack schema validation",
    rationale:
      "Todo and User are plain type definitions with no runtime validation. Adding Zod schemas or class-validator decorators would catch malformed data at the API boundary instead of deep in the database layer.",
    severity: "low",
    targetIds: [
      "fn:src/models/Todo.ts:Todo",
      "fn:src/models/User.ts:User",
    ],
    suggestedPrompt: "Add Zod schemas to the Todo and User models so input is validated at the API boundary.",
  },
];

export const fixtureRules: Rule[] = [
  {
    id: "rule:every-route-has-auth",
    description: "Every /todos route must apply requireAuth.",
    kind: "must_have_edge",
    enabled: true,
    prompt:
      "Apply requireAuth middleware to every route under /todos that doesn't already have it.",
  },
  {
    id: "rule:no-direct-db-from-routes",
    description: "Route handlers must not call getDb directly.",
    kind: "no_edge",
    enabled: true,
    prompt: "Move any direct getDb calls from route handlers into the repos layer.",
  },
  {
    id: "rule:delete-must-validate",
    description: "DELETE handlers must validate input parameters.",
    kind: "prose",
    enabled: true,
    prompt: "Ensure every DELETE route validates its path parameters before passing them to the service layer.",
  },
  {
    id: "rule:services-single-responsibility",
    description: "Service modules should not mix read and write operations.",
    kind: "prose",
    enabled: true,
    prompt: "Split services that handle both queries and commands into separate modules.",
  },
];

export function fixtureViolations(graph: Graph): Violation[] {
  const violations: Violation[] = [];

  const todosRoutes = graph.nodes.filter(
    (n) => n.kind === "route_handler" && n.meta?.httpPath?.startsWith("/todos"),
  );
  const requireAuthId = "fn:src/middleware/auth.ts:requireAuth";

  const unauthed = todosRoutes
    .filter(
      (r) =>
        !graph.edges.some(
          (e) =>
            e.relation === "applies_middleware" &&
            e.source === r.id &&
            e.target === requireAuthId,
        ),
    )
    .map((r) => r.id);

  if (unauthed.length > 0) {
    violations.push({
      ruleId: "rule:every-route-has-auth",
      targetIds: unauthed,
      message: `${unauthed.length} /todos route(s) without requireAuth`,
      suggestedPrompt:
        "Apply requireAuth middleware to every route under /todos that doesn't already have it.",
    });
  }

  violations.push({
    ruleId: "rule:delete-must-validate",
    targetIds: ["route:src/routes/todos.ts:DELETE:/todos/:id:32"],
    message: "DELETE /todos/:id passes unvalidated param to service",
    suggestedPrompt: "Add input validation to the DELETE /todos/:id handler.",
  });

  return violations;
}

export function fixtureCoverage(): CoverageMap {
  const covered = new Set<string>([
    "fn:src/middleware/auth.ts:requireAuth",
    "fn:src/services/authService.ts:signToken",
    "fn:src/services/authService.ts:verifyToken",
    "fn:src/services/todoService.ts:createTodo",
    "fn:src/services/todoService.ts:listTodos",
    "fn:src/repos/todoRepo.ts:findAll",
    "fn:src/repos/todoRepo.ts:insert",
    "fn:src/db/connection.ts:getDb",
    "route:src/routes/todos.ts:POST:/todos:21",
    "route:src/routes/todos.ts:GET:/todos:14",
    "route:src/routes/auth.ts:POST:/auth/login:11",
  ]);
  return { coveredNodeIds: covered, totalNodes: fixtureGraph.nodes.length };
}

export const samplePrompts = [
  "Apply requireAuth to every unprotected route.",
  "Memoize getDb with a connection pool.",
  "Add input validation to the DELETE endpoint.",
  "Split todoService into query and command services.",
  "Add telemetry spans to the auth flow.",
  "Extract the database layer into a standalone module.",
];

// ── MERN e-commerce fixture ────────────────────────────────────────────
// A realistic Express + Mongoose + Stripe e-commerce API with 6 clusters,
// ~45 nodes, and deliberate architectural smells for the Insights panel.

const N = (id: string, name: string, kind: GraphNode["kind"], file: string, cluster: string, meta?: GraphNode["meta"]): GraphNode =>
  ({ id, name, kind, file, cluster, meta });

const R = (id: string, name: string, file: string, cluster: string, method: string, path: string): GraphNode =>
  ({ id, name, kind: "route_handler", file, cluster, meta: { httpMethod: method, httpPath: path } });

const E = (id: string, source: string, target: string, relation: GraphEdge["relation"]): GraphEdge =>
  ({ id, source, target, relation });

export const mernGraph: Graph = {
  rootDir: "shopwave/api",
  clusters: [
    { id: "cluster:auth", name: "Auth", nodeIds: [
      "fn:src/middleware/auth.ts:requireAuth", "fn:src/middleware/auth.ts:requireAdmin",
      "fn:src/services/authService.ts:hashPassword", "fn:src/services/authService.ts:comparePassword",
      "fn:src/services/authService.ts:signToken", "fn:src/services/authService.ts:verifyToken",
      "fn:src/routes/auth.ts:registerHandler", "fn:src/routes/auth.ts:loginHandler", "fn:src/routes/auth.ts:refreshHandler",
      "route:src/routes/auth.ts:POST:/auth/register:10", "route:src/routes/auth.ts:POST:/auth/login:25",
      "route:src/routes/auth.ts:POST:/auth/refresh:40",
    ]},
    { id: "cluster:products", name: "Products", nodeIds: [
      "fn:src/services/productService.ts:listProducts", "fn:src/services/productService.ts:getProduct",
      "fn:src/services/productService.ts:createProduct", "fn:src/services/productService.ts:updateProduct",
      "fn:src/services/productService.ts:deleteProduct",
      "fn:src/routes/products.ts:listHandler", "fn:src/routes/products.ts:getHandler",
      "fn:src/routes/products.ts:createHandler", "fn:src/routes/products.ts:updateHandler",
      "fn:src/routes/products.ts:deleteHandler",
      "route:src/routes/products.ts:GET:/products:8", "route:src/routes/products.ts:GET:/products/:id:15",
      "route:src/routes/products.ts:POST:/products:22", "route:src/routes/products.ts:PUT:/products/:id:30",
      "route:src/routes/products.ts:DELETE:/products/:id:38",
    ]},
    { id: "cluster:cart", name: "Cart", nodeIds: [
      "fn:src/services/cartService.ts:getCart", "fn:src/services/cartService.ts:addItem",
      "fn:src/services/cartService.ts:removeItem", "fn:src/services/cartService.ts:clearCart",
      "fn:src/routes/cart.ts:getHandler", "fn:src/routes/cart.ts:addHandler",
      "fn:src/routes/cart.ts:removeHandler", "fn:src/routes/cart.ts:clearHandler",
      "route:src/routes/cart.ts:GET:/cart:6", "route:src/routes/cart.ts:POST:/cart/items:14",
      "route:src/routes/cart.ts:DELETE:/cart/items/:id:22", "route:src/routes/cart.ts:DELETE:/cart:30",
    ]},
    { id: "cluster:orders", name: "Orders", nodeIds: [
      "fn:src/services/orderService.ts:createOrder", "fn:src/services/orderService.ts:listOrders",
      "fn:src/services/orderService.ts:getOrder", "fn:src/services/orderService.ts:cancelOrder",
      "fn:src/routes/orders.ts:createHandler", "fn:src/routes/orders.ts:listHandler",
      "fn:src/routes/orders.ts:getHandler", "fn:src/routes/orders.ts:cancelHandler",
      "route:src/routes/orders.ts:POST:/orders:8", "route:src/routes/orders.ts:GET:/orders:16",
      "route:src/routes/orders.ts:GET:/orders/:id:24", "route:src/routes/orders.ts:DELETE:/orders/:id:32",
    ]},
    { id: "cluster:payments", name: "Payments", nodeIds: [
      "fn:src/services/paymentService.ts:createCheckout", "fn:src/services/paymentService.ts:confirmPayment",
      "fn:src/services/paymentService.ts:refundPayment",
      "fn:src/routes/payments.ts:checkoutHandler", "fn:src/routes/payments.ts:webhookHandler",
      "route:src/routes/payments.ts:POST:/payments/checkout:8", "route:src/routes/payments.ts:POST:/payments/webhook:20",
      "fn:src/services/paymentService.ts:stripeClient",
    ]},
    { id: "cluster:database", name: "Database", nodeIds: [
      "fn:src/models/User.ts:User", "fn:src/models/Product.ts:Product",
      "fn:src/models/Cart.ts:Cart", "fn:src/models/Order.ts:Order",
      "fn:src/db/connection.ts:connectDB", "fn:src/db/connection.ts:getDB",
    ]},
  ],
  nodes: [
    // ─── Auth ────────────────────────────────────────────────
    N("fn:src/middleware/auth.ts:requireAuth", "requireAuth", "middleware", "src/middleware/auth.ts", "cluster:auth"),
    N("fn:src/middleware/auth.ts:requireAdmin", "requireAdmin", "middleware", "src/middleware/auth.ts", "cluster:auth"),
    N("fn:src/services/authService.ts:hashPassword", "hashPassword", "service", "src/services/authService.ts", "cluster:auth"),
    N("fn:src/services/authService.ts:comparePassword", "comparePassword", "service", "src/services/authService.ts", "cluster:auth"),
    N("fn:src/services/authService.ts:signToken", "signToken", "service", "src/services/authService.ts", "cluster:auth"),
    N("fn:src/services/authService.ts:verifyToken", "verifyToken", "service", "src/services/authService.ts", "cluster:auth"),
    N("fn:src/routes/auth.ts:registerHandler", "registerHandler", "route_handler", "src/routes/auth.ts", "cluster:auth"),
    N("fn:src/routes/auth.ts:loginHandler", "loginHandler", "route_handler", "src/routes/auth.ts", "cluster:auth"),
    N("fn:src/routes/auth.ts:refreshHandler", "refreshHandler", "route_handler", "src/routes/auth.ts", "cluster:auth"),
    R("route:src/routes/auth.ts:POST:/auth/register:10", "POST /auth/register", "src/routes/auth.ts", "cluster:auth", "POST", "/auth/register"),
    R("route:src/routes/auth.ts:POST:/auth/login:25", "POST /auth/login", "src/routes/auth.ts", "cluster:auth", "POST", "/auth/login"),
    R("route:src/routes/auth.ts:POST:/auth/refresh:40", "POST /auth/refresh", "src/routes/auth.ts", "cluster:auth", "POST", "/auth/refresh"),

    // ─── Products ────────────────────────────────────────────
    N("fn:src/services/productService.ts:listProducts", "listProducts", "service", "src/services/productService.ts", "cluster:products"),
    N("fn:src/services/productService.ts:getProduct", "getProduct", "service", "src/services/productService.ts", "cluster:products"),
    N("fn:src/services/productService.ts:createProduct", "createProduct", "service", "src/services/productService.ts", "cluster:products"),
    N("fn:src/services/productService.ts:updateProduct", "updateProduct", "service", "src/services/productService.ts", "cluster:products"),
    N("fn:src/services/productService.ts:deleteProduct", "deleteProduct", "service", "src/services/productService.ts", "cluster:products"),
    N("fn:src/routes/products.ts:listHandler", "listHandler", "route_handler", "src/routes/products.ts", "cluster:products"),
    N("fn:src/routes/products.ts:getHandler", "getHandler", "route_handler", "src/routes/products.ts", "cluster:products"),
    N("fn:src/routes/products.ts:createHandler", "createHandler", "route_handler", "src/routes/products.ts", "cluster:products"),
    N("fn:src/routes/products.ts:updateHandler", "updateHandler", "route_handler", "src/routes/products.ts", "cluster:products"),
    N("fn:src/routes/products.ts:deleteHandler", "deleteHandler", "route_handler", "src/routes/products.ts", "cluster:products"),
    R("route:src/routes/products.ts:GET:/products:8", "GET /products", "src/routes/products.ts", "cluster:products", "GET", "/products"),
    R("route:src/routes/products.ts:GET:/products/:id:15", "GET /products/:id", "src/routes/products.ts", "cluster:products", "GET", "/products/:id"),
    R("route:src/routes/products.ts:POST:/products:22", "POST /products", "src/routes/products.ts", "cluster:products", "POST", "/products"),
    R("route:src/routes/products.ts:PUT:/products/:id:30", "PUT /products/:id", "src/routes/products.ts", "cluster:products", "PUT", "/products/:id"),
    R("route:src/routes/products.ts:DELETE:/products/:id:38", "DELETE /products/:id", "src/routes/products.ts", "cluster:products", "DELETE", "/products/:id"),

    // ─── Cart ────────────────────────────────────────────────
    N("fn:src/services/cartService.ts:getCart", "getCart", "service", "src/services/cartService.ts", "cluster:cart"),
    N("fn:src/services/cartService.ts:addItem", "addItem", "service", "src/services/cartService.ts", "cluster:cart"),
    N("fn:src/services/cartService.ts:removeItem", "removeItem", "service", "src/services/cartService.ts", "cluster:cart"),
    N("fn:src/services/cartService.ts:clearCart", "clearCart", "service", "src/services/cartService.ts", "cluster:cart"),
    N("fn:src/routes/cart.ts:getHandler", "getCartHandler", "route_handler", "src/routes/cart.ts", "cluster:cart"),
    N("fn:src/routes/cart.ts:addHandler", "addItemHandler", "route_handler", "src/routes/cart.ts", "cluster:cart"),
    N("fn:src/routes/cart.ts:removeHandler", "removeItemHandler", "route_handler", "src/routes/cart.ts", "cluster:cart"),
    N("fn:src/routes/cart.ts:clearHandler", "clearCartHandler", "route_handler", "src/routes/cart.ts", "cluster:cart"),
    R("route:src/routes/cart.ts:GET:/cart:6", "GET /cart", "src/routes/cart.ts", "cluster:cart", "GET", "/cart"),
    R("route:src/routes/cart.ts:POST:/cart/items:14", "POST /cart/items", "src/routes/cart.ts", "cluster:cart", "POST", "/cart/items"),
    R("route:src/routes/cart.ts:DELETE:/cart/items/:id:22", "DELETE /cart/items/:id", "src/routes/cart.ts", "cluster:cart", "DELETE", "/cart/items/:id"),
    R("route:src/routes/cart.ts:DELETE:/cart:30", "DELETE /cart", "src/routes/cart.ts", "cluster:cart", "DELETE", "/cart"),

    // ─── Orders ──────────────────────────────────────────────
    N("fn:src/services/orderService.ts:createOrder", "createOrder", "service", "src/services/orderService.ts", "cluster:orders"),
    N("fn:src/services/orderService.ts:listOrders", "listOrders", "service", "src/services/orderService.ts", "cluster:orders"),
    N("fn:src/services/orderService.ts:getOrder", "getOrder", "service", "src/services/orderService.ts", "cluster:orders"),
    N("fn:src/services/orderService.ts:cancelOrder", "cancelOrder", "service", "src/services/orderService.ts", "cluster:orders"),
    N("fn:src/routes/orders.ts:createHandler", "createOrderHandler", "route_handler", "src/routes/orders.ts", "cluster:orders"),
    N("fn:src/routes/orders.ts:listHandler", "listOrdersHandler", "route_handler", "src/routes/orders.ts", "cluster:orders"),
    N("fn:src/routes/orders.ts:getHandler", "getOrderHandler", "route_handler", "src/routes/orders.ts", "cluster:orders"),
    N("fn:src/routes/orders.ts:cancelHandler", "cancelOrderHandler", "route_handler", "src/routes/orders.ts", "cluster:orders"),
    R("route:src/routes/orders.ts:POST:/orders:8", "POST /orders", "src/routes/orders.ts", "cluster:orders", "POST", "/orders"),
    R("route:src/routes/orders.ts:GET:/orders:16", "GET /orders", "src/routes/orders.ts", "cluster:orders", "GET", "/orders"),
    R("route:src/routes/orders.ts:GET:/orders/:id:24", "GET /orders/:id", "src/routes/orders.ts", "cluster:orders", "GET", "/orders/:id"),
    R("route:src/routes/orders.ts:DELETE:/orders/:id:32", "DELETE /orders/:id", "src/routes/orders.ts", "cluster:orders", "DELETE", "/orders/:id"),

    // ─── Payments ────────────────────────────────────────────
    N("fn:src/services/paymentService.ts:createCheckout", "createCheckout", "service", "src/services/paymentService.ts", "cluster:payments"),
    N("fn:src/services/paymentService.ts:confirmPayment", "confirmPayment", "service", "src/services/paymentService.ts", "cluster:payments"),
    N("fn:src/services/paymentService.ts:refundPayment", "refundPayment", "service", "src/services/paymentService.ts", "cluster:payments"),
    N("fn:src/services/paymentService.ts:stripeClient", "stripeClient", "external", "src/services/paymentService.ts", "cluster:payments"),
    N("fn:src/routes/payments.ts:checkoutHandler", "checkoutHandler", "route_handler", "src/routes/payments.ts", "cluster:payments"),
    N("fn:src/routes/payments.ts:webhookHandler", "webhookHandler", "route_handler", "src/routes/payments.ts", "cluster:payments"),
    R("route:src/routes/payments.ts:POST:/payments/checkout:8", "POST /payments/checkout", "src/routes/payments.ts", "cluster:payments", "POST", "/payments/checkout"),
    R("route:src/routes/payments.ts:POST:/payments/webhook:20", "POST /payments/webhook", "src/routes/payments.ts", "cluster:payments", "POST", "/payments/webhook"),

    // ─── Database / Models ───────────────────────────────────
    N("fn:src/models/User.ts:User", "User", "model", "src/models/User.ts", "cluster:database"),
    N("fn:src/models/Product.ts:Product", "Product", "model", "src/models/Product.ts", "cluster:database"),
    N("fn:src/models/Cart.ts:Cart", "Cart", "model", "src/models/Cart.ts", "cluster:database"),
    N("fn:src/models/Order.ts:Order", "Order", "model", "src/models/Order.ts", "cluster:database"),
    N("fn:src/db/connection.ts:connectDB", "connectDB", "utility", "src/db/connection.ts", "cluster:database"),
    N("fn:src/db/connection.ts:getDB", "getDB", "utility", "src/db/connection.ts", "cluster:database"),
  ],
  edges: [
    // Auth route → handler registrations
    E("e:reg:auth-register", "route:src/routes/auth.ts:POST:/auth/register:10", "fn:src/routes/auth.ts:registerHandler", "registers_route"),
    E("e:reg:auth-login", "route:src/routes/auth.ts:POST:/auth/login:25", "fn:src/routes/auth.ts:loginHandler", "registers_route"),
    E("e:reg:auth-refresh", "route:src/routes/auth.ts:POST:/auth/refresh:40", "fn:src/routes/auth.ts:refreshHandler", "registers_route"),
    // Auth handler → service
    E("e:call:regH-hash", "fn:src/routes/auth.ts:registerHandler", "fn:src/services/authService.ts:hashPassword", "calls"),
    E("e:call:regH-sign", "fn:src/routes/auth.ts:registerHandler", "fn:src/services/authService.ts:signToken", "calls"),
    E("e:call:loginH-compare", "fn:src/routes/auth.ts:loginHandler", "fn:src/services/authService.ts:comparePassword", "calls"),
    E("e:call:loginH-sign", "fn:src/routes/auth.ts:loginHandler", "fn:src/services/authService.ts:signToken", "calls"),
    E("e:call:refreshH-verify", "fn:src/routes/auth.ts:refreshHandler", "fn:src/services/authService.ts:verifyToken", "calls"),
    E("e:call:refreshH-sign", "fn:src/routes/auth.ts:refreshHandler", "fn:src/services/authService.ts:signToken", "calls"),
    E("e:call:requireAuth-verify", "fn:src/middleware/auth.ts:requireAuth", "fn:src/services/authService.ts:verifyToken", "calls"),

    // Products route → handler registrations
    E("e:reg:prod-list", "route:src/routes/products.ts:GET:/products:8", "fn:src/routes/products.ts:listHandler", "registers_route"),
    E("e:reg:prod-get", "route:src/routes/products.ts:GET:/products/:id:15", "fn:src/routes/products.ts:getHandler", "registers_route"),
    E("e:reg:prod-create", "route:src/routes/products.ts:POST:/products:22", "fn:src/routes/products.ts:createHandler", "registers_route"),
    E("e:reg:prod-update", "route:src/routes/products.ts:PUT:/products/:id:30", "fn:src/routes/products.ts:updateHandler", "registers_route"),
    E("e:reg:prod-delete", "route:src/routes/products.ts:DELETE:/products/:id:38", "fn:src/routes/products.ts:deleteHandler", "registers_route"),
    // Products handler → service
    E("e:call:prodListH-listS", "fn:src/routes/products.ts:listHandler", "fn:src/services/productService.ts:listProducts", "calls"),
    E("e:call:prodGetH-getS", "fn:src/routes/products.ts:getHandler", "fn:src/services/productService.ts:getProduct", "calls"),
    E("e:call:prodCreateH-createS", "fn:src/routes/products.ts:createHandler", "fn:src/services/productService.ts:createProduct", "calls"),
    E("e:call:prodUpdateH-updateS", "fn:src/routes/products.ts:updateHandler", "fn:src/services/productService.ts:updateProduct", "calls"),
    E("e:call:prodDeleteH-deleteS", "fn:src/routes/products.ts:deleteHandler", "fn:src/services/productService.ts:deleteProduct", "calls"),
    // Products: admin routes require auth
    E("e:mw:prod-create-auth", "route:src/routes/products.ts:POST:/products:22", "fn:src/middleware/auth.ts:requireAdmin", "applies_middleware"),
    E("e:mw:prod-update-auth", "route:src/routes/products.ts:PUT:/products/:id:30", "fn:src/middleware/auth.ts:requireAdmin", "applies_middleware"),
    E("e:mw:prod-delete-auth", "route:src/routes/products.ts:DELETE:/products/:id:38", "fn:src/middleware/auth.ts:requireAdmin", "applies_middleware"),

    // Cart route → handler registrations
    E("e:reg:cart-get", "route:src/routes/cart.ts:GET:/cart:6", "fn:src/routes/cart.ts:getHandler", "registers_route"),
    E("e:reg:cart-add", "route:src/routes/cart.ts:POST:/cart/items:14", "fn:src/routes/cart.ts:addHandler", "registers_route"),
    E("e:reg:cart-remove", "route:src/routes/cart.ts:DELETE:/cart/items/:id:22", "fn:src/routes/cart.ts:removeHandler", "registers_route"),
    E("e:reg:cart-clear", "route:src/routes/cart.ts:DELETE:/cart:30", "fn:src/routes/cart.ts:clearHandler", "registers_route"),
    // Cart: all routes require auth
    E("e:mw:cart-get-auth", "route:src/routes/cart.ts:GET:/cart:6", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    E("e:mw:cart-add-auth", "route:src/routes/cart.ts:POST:/cart/items:14", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    E("e:mw:cart-remove-auth", "route:src/routes/cart.ts:DELETE:/cart/items/:id:22", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    E("e:mw:cart-clear-auth", "route:src/routes/cart.ts:DELETE:/cart:30", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    // Cart handler → service
    E("e:call:cartGetH-getS", "fn:src/routes/cart.ts:getHandler", "fn:src/services/cartService.ts:getCart", "calls"),
    E("e:call:cartAddH-addS", "fn:src/routes/cart.ts:addHandler", "fn:src/services/cartService.ts:addItem", "calls"),
    E("e:call:cartRemoveH-removeS", "fn:src/routes/cart.ts:removeHandler", "fn:src/services/cartService.ts:removeItem", "calls"),
    E("e:call:cartClearH-clearS", "fn:src/routes/cart.ts:clearHandler", "fn:src/services/cartService.ts:clearCart", "calls"),
    // Cart service → product service (validates product exists)
    E("e:call:addItem-getProduct", "fn:src/services/cartService.ts:addItem", "fn:src/services/productService.ts:getProduct", "calls"),

    // Orders route → handler registrations
    E("e:reg:order-create", "route:src/routes/orders.ts:POST:/orders:8", "fn:src/routes/orders.ts:createHandler", "registers_route"),
    E("e:reg:order-list", "route:src/routes/orders.ts:GET:/orders:16", "fn:src/routes/orders.ts:listHandler", "registers_route"),
    E("e:reg:order-get", "route:src/routes/orders.ts:GET:/orders/:id:24", "fn:src/routes/orders.ts:getHandler", "registers_route"),
    E("e:reg:order-cancel", "route:src/routes/orders.ts:DELETE:/orders/:id:32", "fn:src/routes/orders.ts:cancelHandler", "registers_route"),
    // Orders: all require auth
    E("e:mw:order-create-auth", "route:src/routes/orders.ts:POST:/orders:8", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    E("e:mw:order-list-auth", "route:src/routes/orders.ts:GET:/orders:16", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    E("e:mw:order-get-auth", "route:src/routes/orders.ts:GET:/orders/:id:24", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    E("e:mw:order-cancel-auth", "route:src/routes/orders.ts:DELETE:/orders/:id:32", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    // Orders handler → service
    E("e:call:orderCreateH-createS", "fn:src/routes/orders.ts:createHandler", "fn:src/services/orderService.ts:createOrder", "calls"),
    E("e:call:orderListH-listS", "fn:src/routes/orders.ts:listHandler", "fn:src/services/orderService.ts:listOrders", "calls"),
    E("e:call:orderGetH-getS", "fn:src/routes/orders.ts:getHandler", "fn:src/services/orderService.ts:getOrder", "calls"),
    E("e:call:orderCancelH-cancelS", "fn:src/routes/orders.ts:cancelHandler", "fn:src/services/orderService.ts:cancelOrder", "calls"),
    // Orders service → cart (to snapshot cart at checkout) + payment
    E("e:call:createOrder-getCart", "fn:src/services/orderService.ts:createOrder", "fn:src/services/cartService.ts:getCart", "calls"),
    E("e:call:createOrder-clearCart", "fn:src/services/orderService.ts:createOrder", "fn:src/services/cartService.ts:clearCart", "calls"),
    E("e:call:createOrder-checkout", "fn:src/services/orderService.ts:createOrder", "fn:src/services/paymentService.ts:createCheckout", "calls"),
    E("e:call:cancelOrder-refund", "fn:src/services/orderService.ts:cancelOrder", "fn:src/services/paymentService.ts:refundPayment", "calls"),

    // Payments route → handler registrations
    E("e:reg:pay-checkout", "route:src/routes/payments.ts:POST:/payments/checkout:8", "fn:src/routes/payments.ts:checkoutHandler", "registers_route"),
    E("e:reg:pay-webhook", "route:src/routes/payments.ts:POST:/payments/webhook:20", "fn:src/routes/payments.ts:webhookHandler", "registers_route"),
    E("e:mw:pay-checkout-auth", "route:src/routes/payments.ts:POST:/payments/checkout:8", "fn:src/middleware/auth.ts:requireAuth", "applies_middleware"),
    // Payments handler → service
    E("e:call:checkoutH-createCheckout", "fn:src/routes/payments.ts:checkoutHandler", "fn:src/services/paymentService.ts:createCheckout", "calls"),
    E("e:call:webhookH-confirm", "fn:src/routes/payments.ts:webhookHandler", "fn:src/services/paymentService.ts:confirmPayment", "calls"),
    // Payments service → Stripe client
    E("e:call:createCheckout-stripe", "fn:src/services/paymentService.ts:createCheckout", "fn:src/services/paymentService.ts:stripeClient", "calls"),
    E("e:call:confirmPayment-stripe", "fn:src/services/paymentService.ts:confirmPayment", "fn:src/services/paymentService.ts:stripeClient", "calls"),
    E("e:call:refundPayment-stripe", "fn:src/services/paymentService.ts:refundPayment", "fn:src/services/paymentService.ts:stripeClient", "calls"),

    // Service → model (data access)
    E("e:call:regH-User", "fn:src/routes/auth.ts:registerHandler", "fn:src/models/User.ts:User", "calls"),
    E("e:call:loginH-User", "fn:src/routes/auth.ts:loginHandler", "fn:src/models/User.ts:User", "calls"),
    E("e:call:listProducts-Product", "fn:src/services/productService.ts:listProducts", "fn:src/models/Product.ts:Product", "calls"),
    E("e:call:getProduct-Product", "fn:src/services/productService.ts:getProduct", "fn:src/models/Product.ts:Product", "calls"),
    E("e:call:createProduct-Product", "fn:src/services/productService.ts:createProduct", "fn:src/models/Product.ts:Product", "calls"),
    E("e:call:getCart-Cart", "fn:src/services/cartService.ts:getCart", "fn:src/models/Cart.ts:Cart", "calls"),
    E("e:call:addItem-Cart", "fn:src/services/cartService.ts:addItem", "fn:src/models/Cart.ts:Cart", "calls"),
    E("e:call:createOrder-Order", "fn:src/services/orderService.ts:createOrder", "fn:src/models/Order.ts:Order", "calls"),
    E("e:call:listOrders-Order", "fn:src/services/orderService.ts:listOrders", "fn:src/models/Order.ts:Order", "calls"),
    E("e:call:getOrder-Order", "fn:src/services/orderService.ts:getOrder", "fn:src/models/Order.ts:Order", "calls"),

    // Models → getDB
    E("e:call:User-getDB", "fn:src/models/User.ts:User", "fn:src/db/connection.ts:getDB", "calls"),
    E("e:call:Product-getDB", "fn:src/models/Product.ts:Product", "fn:src/db/connection.ts:getDB", "calls"),
    E("e:call:Cart-getDB", "fn:src/models/Cart.ts:Cart", "fn:src/db/connection.ts:getDB", "calls"),
    E("e:call:Order-getDB", "fn:src/models/Order.ts:Order", "fn:src/db/connection.ts:getDB", "calls"),
  ],
};

export const mernInsights: Insight[] = [
  {
    id: "ins:mern-unauthed-reads",
    title: "Product reads are fully public",
    rationale: "GET /products and GET /products/:id have no auth middleware. Fine for a storefront, but if pricing varies by user tier this is a data-leak vector.",
    severity: "medium",
    targetIds: ["route:src/routes/products.ts:GET:/products:8", "route:src/routes/products.ts:GET:/products/:id:15"],
    suggestedPrompt: "Add requireAuth to GET /products routes if per-user pricing is planned.",
  },
  {
    id: "ins:mern-webhook-no-sig",
    title: "Stripe webhook lacks signature verification",
    rationale: "POST /payments/webhook calls confirmPayment without verifying the Stripe signature header. Any HTTP client can forge payment confirmations.",
    severity: "high",
    targetIds: ["fn:src/routes/payments.ts:webhookHandler", "fn:src/services/paymentService.ts:confirmPayment"],
    suggestedPrompt: "Add Stripe signature verification to the webhook handler before calling confirmPayment.",
  },
  {
    id: "ins:mern-hot-getdb",
    title: "getDB called from 4 models without pooling",
    rationale: "Every Mongoose model call goes through getDB. Without connection pooling, high-traffic endpoints will exhaust the connection limit.",
    severity: "medium",
    targetIds: ["fn:src/db/connection.ts:getDB"],
    suggestedPrompt: "Initialize the Mongoose connection pool once in connectDB and remove per-call getDB.",
  },
  {
    id: "ins:mern-cart-race",
    title: "Cart updates lack optimistic locking",
    rationale: "addItem and removeItem read-then-write the cart document without version checks. Two concurrent requests can lose items.",
    severity: "high",
    targetIds: ["fn:src/services/cartService.ts:addItem", "fn:src/services/cartService.ts:removeItem"],
    suggestedPrompt: "Add optimistic concurrency control (Mongoose __v or a version field) to cart mutations.",
  },
];

export const mernRules: Rule[] = [
  {
    id: "rule:mern-every-mutation-has-auth",
    description: "Every POST/PUT/DELETE route must apply requireAuth or requireAdmin.",
    kind: "must_have_edge",
    enabled: true,
    prompt: "Apply requireAuth or requireAdmin to every mutating route that doesn't already have it.",
  },
  {
    id: "rule:mern-no-direct-model-from-routes",
    description: "Route handlers must not call Mongoose models directly — go through a service.",
    kind: "no_edge",
    enabled: true,
    prompt: "Move direct model calls from route handlers into the service layer.",
  },
  {
    id: "rule:mern-webhook-verify",
    description: "Webhook handlers must verify request signatures before processing.",
    kind: "prose",
    enabled: true,
    prompt: "Add Stripe signature verification middleware to the webhook route.",
  },
];

export function mernViolations(graph: Graph): Violation[] {
  const violations: Violation[] = [];
  const authIds = new Set([
    "fn:src/middleware/auth.ts:requireAuth",
    "fn:src/middleware/auth.ts:requireAdmin",
  ]);

  const mutatingRoutes = graph.nodes.filter(
    (n) =>
      n.kind === "route_handler" &&
      n.meta?.httpMethod &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(n.meta.httpMethod as string),
  );

  const unauthed = mutatingRoutes
    .filter(
      (r) =>
        !graph.edges.some(
          (e) => e.relation === "applies_middleware" && e.source === r.id && authIds.has(e.target),
        ),
    )
    .map((r) => r.id);

  if (unauthed.length > 0) {
    violations.push({
      ruleId: "rule:mern-every-mutation-has-auth",
      targetIds: unauthed,
      message: `${unauthed.length} mutating route(s) without auth middleware`,
      suggestedPrompt: "Apply requireAuth or requireAdmin to every mutating route.",
    });
  }

  // Route handlers calling models directly (bypass service layer)
  const routeHandlers = new Set(
    graph.nodes.filter((n) => n.kind === "route_handler").map((n) => n.id),
  );
  const models = new Set(
    graph.nodes.filter((n) => n.kind === "model").map((n) => n.id),
  );
  const directModelCalls = graph.edges.filter(
    (e) => e.relation === "calls" && routeHandlers.has(e.source) && models.has(e.target),
  );
  if (directModelCalls.length > 0) {
    violations.push({
      ruleId: "rule:mern-no-direct-model-from-routes",
      targetIds: directModelCalls.map((e) => e.source),
      message: `${directModelCalls.length} route handler(s) call models directly`,
      suggestedPrompt: "Move direct model calls from route handlers into the service layer.",
    });
  }

  return violations;
}

export const mernSummary =
  "A MERN e-commerce API (Express + Mongoose + Stripe) with 6 clusters: Auth, Products, Cart, Orders, Payments, and Database. 16 HTTP routes, JWT auth with role-based access, Stripe checkout integration, and deliberate architectural smells (unverified webhooks, missing auth on reads, cart race conditions).";

// ─────────────────────────────────────────────────────────────────────

export interface SampleRepo {
  id: string;
  label: string;
  desc: string;
  origin: "local" | "github";
  /** If set, clicking the card calls /api/extract on this folder instead
   *  of routing straight to /app with the bundled fixture. */
  extractPath?: string;
  /** If set, load this bundled fixture graph instead of the default. */
  fixtureKey?: string;
}

export const sampleRepos: SampleRepo[] = [
  {
    id: "supabase/supabase",
    label: "supabase/supabase",
    desc: "polyglot platform · Go + TS + Rust + SQL · cross-language edges",
    origin: "local",
    fixtureKey: "supabase",
  },
  {
    id: "shopwave/api",
    label: "shopwave/api",
    desc: "MERN e-commerce · express + mongoose + stripe · 6 clusters, 60+ nodes",
    origin: "local",
    fixtureKey: "mern",
  },
  {
    id: "acme/todos-api",
    label: "acme/todos-api",
    desc: "bundled example · express + jwt + sqlite · cached",
    origin: "local",
  },
  {
    id: "demo/with-clusters",
    label: "demo/feature-folders",
    desc: "live ts-morph extraction · auth + todos clusters",
    origin: "local",
    extractPath: "tests/fixtures/extract/with-clusters",
  },
  {
    id: "demo/hono-todos",
    label: "demo/hono",
    desc: "Hono · same shape as Express, free win in the recogniser",
    origin: "local",
    extractPath: "tests/fixtures/extract/hono-todos",
  },
  {
    id: "demo/nextjs-app-router",
    label: "demo/nextjs-app",
    desc: "Next.js App Router · file-based GET/POST/DELETE handlers",
    origin: "local",
    extractPath: "tests/fixtures/extract/nextjs-app-router",
  },
  {
    id: "demo/nextjs-pages-api",
    label: "demo/nextjs-pages",
    desc: "Next.js Pages Router · default-export handlers under pages/api",
    origin: "local",
    extractPath: "tests/fixtures/extract/nextjs-pages-api",
  },
  {
    id: "demo/js-express",
    label: "demo/js-express",
    desc: "plain JavaScript · CommonJS Express, allowJs extractor",
    origin: "local",
    extractPath: "tests/fixtures/extract/js-express",
  },
  {
    id: "demo/nestjs-todos",
    label: "demo/nestjs",
    desc: "NestJS · @Controller + @Get/@Post + class-level @UseGuards",
    origin: "local",
    extractPath: "tests/fixtures/extract/nestjs-todos",
  },
  {
    id: "demo/trpc-todos",
    label: "demo/trpc",
    desc: "tRPC · router({...}).query/.mutation procedures",
    origin: "local",
    extractPath: "tests/fixtures/extract/trpc-todos",
  },
];

export interface FixtureBundle {
  graph: Graph;
  summary: string;
  insights: Insight[];
  rules: Rule[];
  violations: Violation[];
  repoLabel: string;
  repoSubtitle: string;
}

export function getFixtureByKey(key: string): FixtureBundle | null {
  if (key === "supabase") {
    return {
      graph: supabaseGraph,
      summary: supabaseSummary,
      insights: supabaseInsights,
      rules: supabaseRules,
      violations: supabaseViolations(supabaseGraph),
      repoLabel: "supabase/supabase",
      repoSubtitle: "Go + TypeScript + Rust + SQL · polyglot",
    };
  }
  return null;
}

export { supabaseGraph, supabaseSummary, supabaseInsights, supabaseRules, supabaseViolations };
