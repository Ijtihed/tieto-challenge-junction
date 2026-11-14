// Per architecture/schema-v3.md §3.4
export interface NetAdapter {
  fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ status: number; body: string; headers: Record<string, string> }>;
}

const real: NetAdapter = {
  fetch: async (url, opts) => {
    const controller = new AbortController();
    const timeout = opts?.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
    try {
      const init: RequestInit = {
        method: opts?.method ?? "GET",
        signal: opts?.signal ?? controller.signal,
      };
      if (opts?.headers) init.headers = opts.headers;
      if (opts?.body) init.body = opts.body;
      const res = await globalThis.fetch(url, init);
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return { status: res.status, body, headers };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  },
};

const demo: NetAdapter = {
  fetch: async () => ({ status: 200, body: "{}", headers: {} }),
};

export const netAdapterImpls = { real, demo } as const;
