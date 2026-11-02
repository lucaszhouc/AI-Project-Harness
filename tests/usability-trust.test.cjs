const test = require("node:test");
const assert = require("node:assert/strict");
const machine = require("../electron/state-machine.cjs");
const { eventForNotification, createAgentRunMonitor } = require("../electron/agent-run-monitor.cjs");
const { createTaskOpenHandler } = require("../electron/task-open.cjs");

function fixture() {
  const state = machine.createEmptyState();
  const project = machine.createBlankProject(state, { name: "Trust boundary", path: __dirname });
  const task = machine.createTask(state, project.id, { title: "Check a real result", criteria: "Evidence exists" });
  machine.dispatchTask(state, project.id, task.id);
  return { state, project, task };
}

test("notifications without measured progress never synthesize a percentage", () => {
  for (const method of ["turn/started", "item/started", "item/completed", "turn/updated", "unknown/event"]) {
    const event = eventForNotification({ method, params: { item: { type: "commandExecution" } } });
    assert.equal(event.progress, undefined, method);
  }
});

test("progress accepts only an actual numeric observation", () => {
  for (const value of [null, "", "45", undefined]) {
    assert.equal(eventForNotification({ method: "turn/updated", params: { progress: value } }).progress, undefined);
  }
  assert.equal(eventForNotification({ method: "turn/updated", params: { progress: 0.25 } }).progress, 25);
});

test("agent self-reported pass and a missing file cannot advance HEAD or impersonate a reviewer", () => {
  const { state, project, task } = fixture();
  const revision = project.revision;
  machine.submitTaskResult(state, project.id, task.id, {
    summary: "Implemented a change", acceptance: [{ criterion: "Evidence exists", status: "pass" }],
    evidence: [{ type: "file", value: "THIS_FILE_DOES_NOT_EXIST.audit" }],
  });
  machine.autoReviewTaskResult(state, project.id, task.id);
  assert.equal(project.revision, revision);
  assert.equal(task.status, "review");
  assert.equal(task.review.agent, "rule-checker");
  assert.equal(task.review.automatic, false);
  assert.doesNotMatch(task.review.notes, /Review Agent 已核对/);
});

test("protocol template placeholders are rejected before becoming results", () => {
  const { state, project, task } = fixture();
  assert.throws(() => machine.submitTaskResult(state, project.id, task.id, {
    summary: "What changed or what was learned", nextStep: "Smallest useful next action",
    evidence: [{ type: "file | git | test | note", value: "verifiable reference" }],
  }), /TEMPLATE_RESULT/);
});

test("opening an old completed task never kills a reused process ID", async () => {
  const { state, project, task } = fixture();
  task.run.status = "completed";
  task.run.processId = 424242;
  task.run.externalThreadId = "owned-in-the-past";
  const terminated = [];
  const open = createTaskOpenHandler({
    store: { state }, machine, detectCodex: async () => ({ installed: true, path: "fixture" }),
    isProcessAlive: () => true, terminateProcessTree: async processId => { terminated.push(processId); return { terminated: true }; },
    openDesktop: async () => ({ opened: true, capability: "thread-deep-link" }), buildSnapshot: async () => ({}),
  });
  await open(project.id, task.id);
  assert.deepEqual(terminated, []);
});

test("one hundred streamed events are batched without one hundred Git scans", async () => {
  const { state, project, task } = fixture();
  let scans = 0;
  let updates = 0;
  const monitor = createAgentRunMonitor({
    state, projectId: project.id, taskId: task.id,
    readGit: async () => { scans += 1; return undefined; }, onUpdate: () => { updates += 1; },
  });
  for (let index = 0; index < 100; index += 1) await monitor.handleNotification({ method: "item/agentMessage/delta", params: { delta: "observed" } });
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(scans, 0);
  assert.equal(updates, 1);
  await monitor.handleNotification({ method: "turn/completed", params: { turn: { status: "completed" } } });
  assert.ok(updates >= 2);
});
