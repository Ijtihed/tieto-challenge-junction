import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectJava } from "../cpg/detect-java.ts";

describe("cpg/detect-java", () => {
  it("returns a JavaInfo object with the expected shape", async () => {
    const info = await detectJava();
    assert.equal(typeof info.available, "boolean");
    assert.equal(typeof info.meetsMinimum, "boolean");
    assert.ok(info.version === null || typeof info.version === "string");
    assert.ok(info.path === null || typeof info.path === "string");
  });

  it("reports meetsMinimum=false when Java is unavailable", async () => {
    const info = await detectJava();
    if (!info.available) {
      assert.equal(info.meetsMinimum, false);
      assert.equal(info.version, null);
    }
  });
});
