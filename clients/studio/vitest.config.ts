// Per `architecture/v1-launch-plan.md` Step 2.
//
// vitest is the inheritance call from v2 (see
// `research/14-runtime-and-completeness-audit.md` row 21 of the
// "23-decision table" — "Test infrastructure for v3 itself …
// commit vitest"). The engine uses node's built-in `node:test`
// because it's startup-sensitive and ESM-import-overhead-sensitive;
// Studio uses vitest because (a) it needs jsdom for React component
// rendering, (b) it shares the Vite resolve/alias chain with the
// dev server which means tests see the exact same module graph
// the user does, and (c) it has first-class `@testing-library/react`
// + `vi.mock` ergonomics that `node:test` doesn't.
//
// IMPORTANT: keep the resolve.alias block here in sync with
// `vite.config.ts`. If Studio adds a new path alias or shim there,
// add it here too or vitest will fail to resolve in the test env.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "next/link": path.resolve(__dirname, "src/shims/next-link.tsx"),
      "next/navigation": path.resolve(__dirname, "src/shims/next-navigation.ts"),
      "next/dynamic": path.resolve(__dirname, "src/shims/next-link.tsx"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "e2e/**",
      "src-tauri/**",
    ],
    css: false,
  },
});
