// Global setup for Studio unit tests (vitest + jsdom).
//
// Per `architecture/v1-launch-plan.md` Step 2 — the Studio test
// harness is the regression safety net that the canvas-firefighting
// commits in §6 audit asked for. Anything global that jsdom doesn't
// give us out of the box (DOM matchers, MCP transport stubs) lives
// here so each test file stays focused on behaviour.

import "@testing-library/jest-dom/vitest";

// jsdom doesn't ship EventSource (the SSE primitive Studio uses to
// subscribe to extractor / bridge / cluster progress). Anything that
// imports `mcp-client` indirectly touches `new EventSource(...)` at
// module-init time; without this shim, every test file would
// reference-error in the first import. The mock is intentionally
// inert — tests that need to drive SSE events do it via `vi.mock`
// on `../mcp-client` so they get a deterministic surface.
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = MockEventSource.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  withCredentials = false;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    this.readyState = MockEventSource.CLOSED;
  }
  addEventListener() { /* no-op */ }
  removeEventListener() { /* no-op */ }
  dispatchEvent() { return true; }
}

Object.defineProperty(globalThis, "EventSource", {
  value: MockEventSource,
  writable: true,
  configurable: true,
});

// jsdom doesn't implement ResizeObserver; React Flow + our canvas
// layout code uses it to track container size changes. Stub it.
class ResizeObserverStub {
  observe() { /* no-op */ }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverStub,
  writable: true,
  configurable: true,
});

// jsdom doesn't implement matchMedia; some components reach for it
// (theme detection, motion-reduce queries). Stub a deterministic
// "doesn't match" result so tests are predictable.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => { /* no-op (legacy) */ },
    removeListener: () => { /* no-op (legacy) */ },
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
    dispatchEvent: () => false,
  }),
});
