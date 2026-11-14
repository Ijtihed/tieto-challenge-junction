// Detect Java 21+ on the system for CPG sidecar support.
import { execFile } from "node:child_process";

export interface JavaInfo {
  available: boolean;
  version: string | null;
  meetsMinimum: boolean;
  path: string | null;
}

const MIN_MAJOR = 21;

export async function detectJava(): Promise<JavaInfo> {
  const javaHome = process.env.JAVA_HOME;
  const javaBin = javaHome ? `${javaHome}/bin/java` : "java";

  try {
    const version = await getJavaVersion(javaBin);
    if (!version) {
      return { available: false, version: null, meetsMinimum: false, path: null };
    }
    const major = parseMajorVersion(version);
    return {
      available: true,
      version,
      meetsMinimum: major >= MIN_MAJOR,
      path: javaBin,
    };
  } catch {
    return { available: false, version: null, meetsMinimum: false, path: null };
  }
}

function getJavaVersion(javaBin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(javaBin, ["-version"], { timeout: 5000 }, (_err, _stdout, stderr) => {
      const output = stderr || _stdout || "";
      const match = output.match(/(?:java|openjdk) version "([^"]+)"/i)
        ?? output.match(/(?:java|openjdk)\s+(\d[\d._]+)/i);
      resolve(match ? match[1]! : null);
    });
  });
}

function parseMajorVersion(version: string): number {
  const cleaned = version.replace(/^1\./, "");
  const major = parseInt(cleaned.split(/[._-]/)[0]!, 10);
  return isNaN(major) ? 0 : major;
}
