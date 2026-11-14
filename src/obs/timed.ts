// Per architecture/schema-v3.md §3.2
import { logger, type LogLevel } from "./logger.ts";

export async function timed<T>(
  level: LogLevel,
  scope: string,
  operation: string,
  fn: () => T | Promise<T>,
  attrs?: Record<string, unknown>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const elapsed = Math.round(performance.now() - start);
    logger[level](scope, `${operation} completed`, { ...attrs, elapsedMs: elapsed });
    return result;
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    logger.error(scope, `${operation} failed`, {
      ...attrs,
      elapsedMs: elapsed,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
