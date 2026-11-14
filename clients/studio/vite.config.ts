import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "next/link": path.resolve(__dirname, "src/shims/next-link.tsx"),
      "next/navigation": path.resolve(__dirname, "src/shims/next-navigation.ts"),
      "next/dynamic": path.resolve(__dirname, "src/shims/next-link.tsx"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/mcp": {
        target: `http://127.0.0.1:${process.env.SCHEMA_PORT ?? "7474"}`,
        changeOrigin: true,
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2023",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    css: true,
    exclude: ["e2e/**", "node_modules/**"],
  },
});
