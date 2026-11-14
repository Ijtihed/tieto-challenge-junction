// Per architecture/schema-v3.md §3.4 + §7.5
// Phase 1 stub — better-sqlite3 wired in Phase 2 when session caching lands.

export interface SqliteAdapter {
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): { changes: number };
  exec(sql: string): void;
  close(): void;
}

const demo: SqliteAdapter = {
  get: () => undefined,
  all: () => [],
  run: () => ({ changes: 0 }),
  exec: () => {},
  close: () => {},
};

export const sqliteAdapterImpls = {
  real: demo,
  demo,
} as const;
