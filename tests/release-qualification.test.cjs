const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");
const { createAgentRunMonitor } = require("../electron/agent-run-monitor.cjs");

const result = (summary = "qualified") => ({
  summary,
  completed: ["release contract"],
  remaining: [],
  nextStep: "review",
  acceptance: [{ criterion: "release contract", status: "pass" }],
  evidence: [{ type: "test", value: "node --test tests/release-qualification.test.cjs" }],
});

function fixture(title = "Qualification task", taskInput = {}) {
  const state = machine.createInitialState("C:\\fixture\\qualification");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title, ...taskInput });
  return { state, project, task };
}

function candidate(taskInput = {}) {
  const value = fixture("Candidate", taskInput);
  machine.dispatchTask(value.state, value.project.id, value.task.id);
  machine.submitTaskResult(value.state, value.project.id, value.task.id, result());
  return value;
}

test("ordinary candidate and Review remain behind explicit human Accept", () => {
  const { state, project, task } = candidate();
  assert.equal(project.revision, 1);
  assert.equal(task.status, "review");
  assert.equal(task.reviewMode, "user");
  machine.acceptTaskResult(state, project.id, task.id);
  assert.equal(project.revision, 2);
  assert.equal(task.status, "accepted");
  assert.throws(() => machine.acceptTaskResult(state, project.id, task.id), /No candidate result to accept/);
});

test("explicit auto-review advances once and cannot be regressed by later completion", async () => {
  const { state, project, task } = fixture("Auto review", { reviewMode: "auto" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, { threadId: "auto-thread", turnId: "auto-turn" });
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, autoReview: true });
  await monitor.handleNotification({
    method: "item/completed",
    params: {
      threadId: "auto-thread",
      turnId: "auto-turn",
      item: { type: "agentMessage", text: `\`\`\`harness-result\n${JSON.stringify(result("auto"))}\n\`\`\`` },
    },
  });
  assert.equal(project.revision, 2);
  assert.equal(task.status, "accepted");
  await monitor.handleNotification({ method: "turn/completed", params: { threadId: "auto-thread", turnId: "auto-turn", turn: { status: "completed" } } });
  assert.equal(project.revision, 2);
  assert.equal(task.status, "accepted");
});

test("Reject then Retry then Accept advances HEAD only on the accepted retry", () => {
  const { state, project, task } = candidate();
  machine.requestChanges(state, project.id, task.id);
  assert.equal(project.revision, 1);
  assert.equal(task.status, "changes_requested");
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, result("retry"));
  machine.acceptTaskResult(state, project.id, task.id);
  assert.equal(project.revision, 2);
  assert.deepEqual(project.checkpoints.map((item) => item.revision), [2]);
});

test("Stop is the product cancel transaction and never advances HEAD", () => {
  const { state, project, task } = fixture("Stop task");
  machine.dispatchTask(state, project.id, task.id);
  machine.stopTask(state, project.id, task.id, "human cancelled");
  assert.equal(project.revision, 1);
  assert.equal(task.status, "failed");
  assert.equal(task.run.phase, "stopped");
  assert.match(task.run.error, /human cancelled/);
});

for (const [name, message, status] of [
  ["authentication failure", "401 authentication failed", "failed"],
  ["timeout", "turn/start timed out after 30000ms", "failed"],
  ["process crash", "Codex app-server exited (1)", "failed"],
  ["interrupted", "turn interrupted by user", "cancelled"],
]) {
  test(`Codex ${name} becomes a durable retryable failure`, async () => {
    const { state, project, task } = fixture(name);
    machine.dispatchTask(state, project.id, task.id);
    machine.attachExternalThread(state, project.id, task.id, { threadId: `thread-${name}`, turnId: `turn-${name}` });
    const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id });
    await monitor.handleNotification({
      method: "turn/completed",
      params: { threadId: `thread-${name}`, turnId: `turn-${name}`, turn: { status, error: { message } } },
    });
    assert.equal(task.status, "failed");
    assert.equal(task.run.status, "failed");
    assert.match(task.run.error, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  });
}

function withStore(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-release-store-"));
  const statePath = path.join(root, "data", "harness-state.json");
  try {
    return run({ root, statePath, store: new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false }) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("restart preserves in-progress, review, and accepted states without duplicate HEAD movement", () => withStore(({ root, statePath, store }) => {
  const project = store.state.projects[0];
  const initialRevision = project.revision;
  project.tasks = [];
  const task = machine.createTask(store.state, project.id, { title: "restart matrix" });
  machine.dispatchTask(store.state, project.id, task.id);
  store.write();
  let reloaded = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
  assert.equal(machine.getProject(reloaded.state, project.id).tasks[0].status, "in_progress");

  machine.submitTaskResult(store.state, project.id, task.id, result("persisted candidate"));
  store.write();
  reloaded = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
  assert.equal(machine.getProject(reloaded.state, project.id).tasks[0].status, "review");
  assert.equal(machine.getProject(reloaded.state, project.id).revision, initialRevision);

  machine.acceptTaskResult(store.state, project.id, task.id);
  store.write();
  reloaded = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
  assert.equal(machine.getProject(reloaded.state, project.id).tasks[0].status, "accepted");
  assert.equal(machine.getProject(reloaded.state, project.id).revision, initialRevision + 1);
}));

test("missing, corrupt, and interrupted state writes recover without a crash loop", () => withStore(({ root, statePath, store }) => {
  const selectedProjectId = store.state.selectedProjectId;
  const revision = machine.getProject(store.state, selectedProjectId).revision;
  fs.writeFileSync(`${statePath}.tmp-interrupted`, "{partial", "utf8");
  let recovered = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
  assert.equal(recovered.state.schemaVersion, 1);
  assert.equal(recovered.state.selectedProjectId, selectedProjectId);
  assert.equal(machine.getProject(recovered.state, selectedProjectId).revision, revision);

  fs.writeFileSync(statePath, "{broken", "utf8");
  recovered = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
  assert.equal(recovered.state.schemaVersion, 1);
  assert.ok(fs.readdirSync(path.dirname(statePath)).some((name) => name.includes(".corrupt-")));

  fs.unlinkSync(statePath);
  recovered = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
  assert.equal(recovered.state.schemaVersion, 1);
  assert.ok(fs.existsSync(statePath));
}));

for (const megabytes of [1, 5, 8, 9.5, 9.9, 10, 10.1, 15]) {
  test(`state storage survives a ${megabytes} MB object`, () => withStore(({ root, statePath, store }) => {
    const length = Math.floor(megabytes * 1024 * 1024);
    store.state.qualificationBlob = "x".repeat(length);
    store.write();
    const reloaded = new HarnessStore(statePath, path.join(root, "source"), { persistJournal: false });
    assert.equal(reloaded.state.qualificationBlob.length, length);
  }));
}

for (const [label, segments] of [
  ["ordinary", ["normal", "project"]],
  ["spaces", ["folder with spaces", "project name"]],
  ["Chinese", ["中文目录", "项目验收"]],
  ["long", Array.from({ length: 12 }, (_, index) => `segment-${index}-${"x".repeat(12)}`)],
]) {
  test(`${label} Windows path persists and reloads`, () => withStore(({ root }) => {
    const dataRoot = path.join(root, ...segments);
    const statePath = path.join(dataRoot, "harness-state.json");
    const projectPath = path.join(root, ...segments, "repo");
    fs.mkdirSync(projectPath, { recursive: true });
    const store = new HarnessStore(statePath, projectPath, { persistJournal: false });
    const reloaded = new HarnessStore(statePath, projectPath, { persistJournal: false });
    assert.equal(reloaded.state.projects[0].path, projectPath);
    assert.ok(fs.existsSync(statePath));
    assert.equal(store.state.schemaVersion, 1);
  }));
}
