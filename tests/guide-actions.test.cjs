const test = require("node:test");
const assert = require("node:assert/strict");

const { createGuideState } = require("../electron/guide-state.cjs");
const { createGuideActionExecutor } = require("../electron/guide-actions.cjs");

test("side-effect action is persisted before execution and duplicate clicks share one result", async () => {
  const state = createGuideState();
  const writes = [];
  let calls = 0;
  let resolveAction;
  const executor = createGuideActionExecutor({
    state,
    persist: () => writes.push(JSON.parse(JSON.stringify(state))),
    handlers: { "project.create-blank": async () => { calls += 1; return new Promise((resolve) => { resolveAction = resolve; }); } },
  });
  const input = { operationId: "op-create", actionId: "project.create-blank", targetFingerprint: "blank:alpha", confirmedAt: "2026-09-20T00:00:00Z", payload: { name: "Alpha" } };
  const first = executor.execute(input);
  const second = executor.execute(input);
  assert.equal(writes[0].operations["op-create"].status, "running");
  assert.equal(calls, 1);
  resolveAction({ projectId: "p1" });
  assert.deepEqual(await first, { status: "completed", result: { projectId: "p1" }, reused: false });
  assert.deepEqual(await second, { status: "completed", result: { projectId: "p1" }, reused: true });
  assert.equal(state.operations["op-create"].result.projectId, "p1");
});

test("completed operation returns its recorded result without executing again", async () => {
  const state = createGuideState();
  let calls = 0;
  const executor = createGuideActionExecutor({ state, persist: () => {}, handlers: { "project.connect": async () => { calls += 1; return { connected: true }; } } });
  const input = { operationId: "op-connect", actionId: "project.connect", targetFingerprint: "project:p1", payload: {} };
  await executor.execute(input);
  const replay = await executor.execute(input);
  assert.equal(calls, 1);
  assert.equal(replay.reused, true);
  assert.deepEqual(replay.result, { connected: true });
});

