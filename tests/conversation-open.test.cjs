const test = require("node:test");
const assert = require("node:assert/strict");
const { runStillOwnsThread } = require("../electron/conversation-open.cjs");

test("a completed run with a live app-server process still owns its thread", () => {
  assert.equal(runStillOwnsThread({ status: "completed", processId: 4312 }, () => true), true);
});

test("a run without a live process can use its exact conversation deep link", () => {
  assert.equal(runStillOwnsThread({ status: "completed", processId: 4312 }, () => false), false);
  assert.equal(runStillOwnsThread({ status: "completed" }, () => true), false);
});

test("starting and running statuses always keep the project-path fallback", () => {
  const isProcessAlive = () => false;
  assert.equal(runStillOwnsThread({ status: "starting" }, isProcessAlive), true);
  assert.equal(runStillOwnsThread({ status: "running" }, isProcessAlive), true);
});
