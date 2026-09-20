const test = require("node:test");
const assert = require("node:assert/strict");

test("qualification summary blocks release on required failures but not warnings", async () => {
  const { summarizeResults } = await import("../scripts/qualification-core.mjs");
  const summary = summarizeResults([
    { id: "build", status: "PASS", required: true, severity: "P0" },
    { id: "real-codex-readonly", status: "WARN", required: false, severity: "P1" },
    { id: "state-contract", status: "FAIL", required: true, severity: "P0" },
  ]);

  assert.deepEqual(summary.counts, { PASS: 1, FAIL: 1, WARN: 1 });
  assert.equal(summary.releaseBlocked, true);
  assert.deepEqual(summary.blockingSteps, ["state-contract"]);
});

test("qualification report keeps commands, reproduction hints, and manual gates visible", async () => {
  const { renderMarkdownReport } = await import("../scripts/qualification-core.mjs");
  const report = renderMarkdownReport({
    generatedAt: "2026-09-19T00:00:00.000Z",
    root: "C:\\fixture\\AI-Project-Harness",
    summary: { counts: { PASS: 1, FAIL: 1, WARN: 0 }, releaseBlocked: true, blockingSteps: ["workflow"] },
    results: [{
      id: "workflow",
      label: "Workflow regression",
      command: "node --test tests/release-qualification.test.cjs",
      status: "FAIL",
      severity: "P0",
      required: true,
      reproduction: "Run the command from the repository root.",
      logPath: "C:\\fixture\\qa\\workflow.log",
    }],
    manualGates: ["Windows Sandbox cold start", "Real Codex E2E", "30–60 minute human UX pass"],
  });

  assert.match(report, /Release blocked: YES/);
  assert.match(report, /tests\/release-qualification\.test\.cjs/);
  assert.match(report, /Run the command from the repository root/);
  assert.match(report, /Windows Sandbox cold start/);
});

test("package audit detects secret-shaped text and development-machine paths", async () => {
  const { inspectTextEntry } = await import("../scripts/package-audit.mjs");
  assert.deepEqual(inspectTextEntry("electron/main.cjs", "const ok = true;", { repositoryRoot: "C:\\work\\app" }), []);
  assert.deepEqual(
    inspectTextEntry("electron/leak.cjs", "const root = 'C:\\\\Users\\\\someone\\\\project';", { repositoryRoot: "C:\\work\\app" }),
    ["development-machine absolute path"],
  );
  assert.deepEqual(
    inspectTextEntry("electron/leak.cjs", "const token = 'sk-abcdefghijklmnopqrstuvwxyz123456';", { repositoryRoot: "C:\\work\\app" }),
    ["secret-shaped token"],
  );
});

test("Windows qualification invokes npm through Node instead of spawning npm.cmd", async () => {
  const { resolveStepInvocation } = await import("../scripts/qualification-core.mjs");
  const invocation = resolveStepInvocation(
    { command: "npm", args: ["ci"] },
    { platform: "win32", npmExecPath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", nodeExecutable: "C:\\Program Files\\nodejs\\node.exe" },
  );
  assert.equal(invocation.executable, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(invocation.args, ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "ci"]);
});
