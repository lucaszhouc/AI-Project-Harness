const test = require("node:test");
const assert = require("node:assert/strict");
const { detectCommand, resolveCommandInvocation } = require("../electron/command-runtime.cjs");

test("Codex detection is Desktop-native and never probes executables", async () => {
  const result = await detectCommand("codex");
  assert.equal(result.native, true);
  assert.equal(result.cliDisabled, true);
  assert.equal(result.path, "");
});

test("all command invocation attempts are blocked before process launch", () => {
  assert.throws(
    () => resolveCommandInvocation("C:\\tools\\agent.exe", ["--stdio"]),
    (error) => error.code === "CLI_DISABLED",
  );
});
