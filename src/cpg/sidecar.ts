// CPG sidecar lifecycle: spawn, health-check, and kill the JVM-based
// Fraunhofer-AISEC CPG MCP server as a child process.
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../obs/index.ts";
import { detectJava, type JavaInfo } from "./detect-java.ts";

export interface CpgSidecarOptions {
  port?: number;
  cpgDistDir?: string;
  startupTimeoutMs?: number;
}

export interface CpgSidecar {
  readonly available: boolean;
  readonly port: number;
  readonly java: JavaInfo;
  readonly baseUrl: string;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

const DEFAULT_PORT = 7475;
const DEFAULT_STARTUP_TIMEOUT = 30_000;

function findCpgDist(): string | null {
  const candidates = [
    join(process.cwd(), "cpg", "build", "install", "cpg", "bin", "cpg"),
    join(process.cwd(), "cpg", "build", "install", "cpg-mcp", "bin", "cpg-mcp"),
    resolve(__dirname, "..", "..", "cpg", "build", "install", "cpg", "bin", "cpg"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function createCpgSidecar(options: CpgSidecarOptions = {}): CpgSidecar {
  const port = options.port ?? DEFAULT_PORT;
  const startupTimeout = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT;
  let proc: ChildProcess | null = null;
  let java: JavaInfo = { available: false, version: null, meetsMinimum: false, path: null };

  return {
    get available() { return java.available && java.meetsMinimum; },
    get port() { return port; },
    get java() { return java; },
    get baseUrl() { return `http://127.0.0.1:${port}`; },

    async start(): Promise<boolean> {
      java = await detectJava();
      if (!java.available || !java.meetsMinimum) {
        logger.info("cpg-sidecar", `Java ${java.version ?? "not found"} — CPG sidecar disabled`);
        return false;
      }

      const cpgBin = options.cpgDistDir ?? findCpgDist();
      if (!cpgBin) {
        logger.info("cpg-sidecar", "CPG distribution not found — run: cd cpg && ./gradlew installDist");
        return false;
      }

      logger.info("cpg-sidecar", `starting on port ${port} via ${cpgBin}`);
      proc = spawn(cpgBin, ["--http", String(port)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, JAVA_HOME: java.path?.replace(/\/bin\/java$/, "") ?? process.env.JAVA_HOME },
      });

      proc.stdout?.on("data", (chunk: Buffer) => {
        logger.info("cpg-sidecar", chunk.toString().trim());
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        logger.warn("cpg-sidecar", chunk.toString().trim());
      });
      proc.on("exit", (code) => {
        logger.info("cpg-sidecar", `exited with code ${code}`);
        proc = null;
      });

      const healthy = await this.waitForHealthy(startupTimeout);
      if (!healthy) {
        logger.warn("cpg-sidecar", "startup timed out — killing");
        await this.stop();
        return false;
      }

      logger.info("cpg-sidecar", `ready at http://127.0.0.1:${port}`);
      return true;
    },

    async stop(): Promise<void> {
      if (!proc) return;
      proc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { proc?.kill("SIGKILL"); resolve(); }, 5000);
        proc?.on("exit", () => { clearTimeout(timer); resolve(); });
      });
      proc = null;
    },

    async isHealthy(): Promise<boolean> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        return res.ok;
      } catch {
        return false;
      }
    },

    async waitForHealthy(timeoutMs: number): Promise<boolean> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await this.isHealthy()) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    },
  } as CpgSidecar & { waitForHealthy(ms: number): Promise<boolean> };
}
