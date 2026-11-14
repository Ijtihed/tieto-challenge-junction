import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCpgSidecar } from "../cpg/sidecar.ts";

describe("cpg/sidecar", () => {
  it("creates a sidecar with default port 7475", () => {
    const sidecar = createCpgSidecar();
    assert.equal(sidecar.port, 7475);
    assert.equal(sidecar.baseUrl, "http://127.0.0.1:7475");
  });

  it("creates a sidecar with custom port", () => {
    const sidecar = createCpgSidecar({ port: 9999 });
    assert.equal(sidecar.port, 9999);
    assert.equal(sidecar.baseUrl, "http://127.0.0.1:9999");
  });

  it("reports not available before start", () => {
    const sidecar = createCpgSidecar();
    assert.equal(sidecar.available, false);
  });

  it("isHealthy returns false when nothing is running", async () => {
    const sidecar = createCpgSidecar({ port: 19999 });
    const healthy = await sidecar.isHealthy();
    assert.equal(healthy, false);
  });
});
