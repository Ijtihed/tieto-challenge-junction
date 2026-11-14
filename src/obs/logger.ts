// Per architecture/schema-v3.md §3.2 — obs/logger
// JSON-line format in production; pretty-print in dev.
// Node std lib only — no external deps.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const ENV_LEVEL: LogLevel =
  (process.env["SCHEMA_LOG_LEVEL"] as LogLevel) ?? "info";

const IS_DEV = process.env["NODE_ENV"] !== "production";

const REDACT_PATTERNS = [/API_KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i];

function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (REDACT_PATTERNS.some((p) => p.test(key))) return "***REDACTED***";
  return value;
}

function formatEntry(
  level: LogLevel,
  scope: string,
  message: string,
  attrs?: Record<string, unknown>,
): string {
  const entry: Record<string, unknown> = {
    level,
    scope,
    message,
    at: new Date().toISOString(),
  };
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      entry[k] = redactValue(k, v);
    }
  }
  if (IS_DEV) {
    const tag = `[${level.toUpperCase().padEnd(5)}]`;
    const attrStr = attrs
      ? " " + JSON.stringify(attrs, (k, v) => (k ? redactValue(k, v) : v))
      : "";
    return `${tag} ${scope}: ${message}${attrStr}`;
  }
  return JSON.stringify(entry);
}

function emit(level: LogLevel, scope: string, message: string, attrs?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[ENV_LEVEL]) return;
  const line = formatEntry(level, scope, message, attrs);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stderr.write(line + "\n");
  }
}

export const logger = {
  debug: (scope: string, message: string, attrs?: Record<string, unknown>) =>
    emit("debug", scope, message, attrs),
  info: (scope: string, message: string, attrs?: Record<string, unknown>) =>
    emit("info", scope, message, attrs),
  warn: (scope: string, message: string, attrs?: Record<string, unknown>) =>
    emit("warn", scope, message, attrs),
  error: (scope: string, message: string, attrs?: Record<string, unknown>) =>
    emit("error", scope, message, attrs),
} as const;
