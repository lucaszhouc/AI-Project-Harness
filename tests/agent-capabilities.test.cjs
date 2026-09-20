const test = require("node:test");
const assert = require("node:assert/strict");
const { detectAgentCapabilities } = require("../electron/agent-capabilities.cjs");

test("agent capability manifest distinguishes Codex backend from user-invoked adapters", async () => {
  const result = await detectAgentCapabilities({ detect: async (id) => ({ installed: id !== "hermes", path: `${id}.cmd` }) });
  assert.equal(result.codex.installed, true);
  assert.ok(result.codex.capabilities.includes("project"));
  assert.equal(result.claude.mode, "用户主动");
  assert.equal(result.hermes.installed, false);
});
