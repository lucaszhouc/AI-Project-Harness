const test = require("node:test");
const assert = require("node:assert/strict");

test("standalone cleanup is blocked without a live Desktop removal bridge", async () => {
  const { cleanupTestArtifacts } = await import("../scripts/cleanup-test-artifacts.mjs");
  const result = await cleanupTestArtifacts();
  assert.equal(result.pass, false);
  assert.equal(result.status, "SMOKE_BLOCKED");
});
