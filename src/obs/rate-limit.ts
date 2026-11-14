// Per architecture/schema-v3.md §3.2
// Per-category rate limiting (samplers, ops, plan).

export interface RateLimitAdapter {
  check(category: string): Promise<{ allowed: boolean; retryAfterMs?: number }>;
  record(category: string): Promise<void>;
}

export interface RateLimiter {
  check(category: string): Promise<{ allowed: boolean; retryAfterMs?: number }>;
  record(category: string): Promise<void>;
}

class MemoryRateLimitAdapter implements RateLimitAdapter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  constructor(maxPerWindow = 60, windowMs = 60_000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  async check(category: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const now = Date.now();
    const window = this.windows.get(category);
    if (!window || now >= window.resetAt) return { allowed: true };
    if (window.count >= this.maxPerWindow) {
      return { allowed: false, retryAfterMs: window.resetAt - now };
    }
    return { allowed: true };
  }

  async record(category: string): Promise<void> {
    const now = Date.now();
    let window = this.windows.get(category);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(category, window);
    }
    window.count++;
  }
}

export function createRateLimiter(adapter?: RateLimitAdapter): RateLimiter {
  const a = adapter ?? new MemoryRateLimitAdapter();
  return { check: (c) => a.check(c), record: (c) => a.record(c) };
}
