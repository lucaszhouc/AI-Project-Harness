const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");
const { createAgentRunMonitor } = require("../electron/agent-run-monitor.cjs");

function candidate(summary = "候选", acceptance = [], evidence = [{ type: "test", value: "node --test" }]) {
  return { summary, acceptance, evidence };
}

function reviewFixture(criteria = "A\nB") {
  const state = machine.createInitialState("C:\\fixture\\p0-review");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "P0 review", criteria, reviewMode: "auto" });
  machine.dispatchTask(state, project.id, task.id);
  return { state, project, task };
}

test("P0 R01: empty, pending, missing, duplicate, or evidence-free checks never auto-accept", () => {
  const cases = [
    { name: "empty", acceptance: [], evidence: [{ type: "test", value: "ok" }] },
    { name: "pending", acceptance: [{ criterion: "A", status: "pass" }, { criterion: "B", status: "pending" }], evidence: [{ type: "test", value: "ok" }] },
    { name: "missing", acceptance: [{ criterion: "A", status: "pass" }], evidence: [{ type: "test", value: "ok" }] },
    { name: "duplicate", acceptance: [{ criterion: "A", status: "pass" }, { criterion: "A", status: "pass" }], evidence: [{ type: "test", value: "ok" }] },
    { name: "no evidence", acceptance: [{ criterion: "A", status: "pass" }, { criterion: "B", status: "pass" }], evidence: [] },
  ];

  for (const item of cases) {
    const { state, project, task } = reviewFixture();
    const revision = project.revision;
    machine.submitTaskResult(state, project.id, task.id, candidate(item.name, item.acceptance, item.evidence));
    machine.autoReviewTaskResult(state, project.id, task.id);
    assert.equal(task.status, "review", item.name);
    assert.equal(task.review.status, "inconclusive", item.name);
    assert.equal(project.revision, revision, item.name);
  }
});

test("P0 R02: loading a legacy candidate never creates a new approval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-legacy-"));
  try {
    const statePath = path.join(root, "state.json");
    const first = new HarnessStore(statePath, root, { initialStateMode: "empty", contextRoot: root });
    const project = machine.addProject(first.state, path.join(root, "project"));
    project.tasks = [];
    const task = machine.createTask(first.state, project.id, { title: "legacy", criteria: "A", reviewMode: "auto" });
    machine.dispatchTask(first.state, project.id, task.id);
    machine.submitTaskResult(first.state, project.id, task.id, candidate("legacy", [{ criterion: "A", status: "pass" }]));
    delete task.review;
    const revision = project.revision;
    first.write();

    const loaded = new HarnessStore(statePath, root, { initialStateMode: "empty", contextRoot: root });
    const loadedProject = machine.getProject(loaded.state, project.id);
    const loadedTask = loadedProject.tasks.find((item) => item.id === task.id);
    assert.equal(loadedTask.status, "review");
    assert.equal(loadedTask.review.status, "legacy_unverified");
    assert.equal(loadedTask.review.automatic, false);
    assert.equal(loadedProject.revision, revision);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R03: only the bound successful terminal may submit an Agent result", async () => {
  const state = machine.createInitialState("C:\\fixture\\terminal-only");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "terminal", criteria: "A" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, { threadId: "thread-1", turnId: "turn-1" });
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id });
  const result = "```harness-result\n" + JSON.stringify(candidate("real", [{ criterion: "A", status: "pass" }])) + "\n```";

  await monitor.handleNotification({
    method: "item/completed",
    params: { threadId: "thread-1", turnId: "turn-1", item: { type: "commandExecution", output: result } },
  });
  assert.equal(task.status, "in_progress", "tool output is not an authoritative result channel");

  await monitor.handleNotification({
    method: "item/completed",
    params: { threadId: "thread-1", turnId: "turn-1", item: { type: "agentMessage", text: result } },
  });
  assert.equal(task.status, "in_progress", "an Agent message is buffered until terminal success");

  await monitor.handleNotification({ method: "turn/completed", params: { turn: { status: "completed" } } });
  assert.equal(task.status, "in_progress", "a terminal without bound identity is ignored");

  await monitor.handleNotification({
    method: "turn/completed",
    params: { threadId: "thread-1", turnId: "turn-1", turn: { status: "completed" } },
  });
  assert.equal(task.status, "review");
  assert.equal(task.candidate.summary, "real");
  assert.equal(task.run.status, "completed");
});

test("P0 R04: a truncated journal tail recovers the newest complete snapshot in the same file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-journal-"));
  try {
    const statePath = path.join(root, "state.json");
    const store = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    const project = store.update((state) => machine.addProject(state, path.join(root, "project")));
    store.update((state) => { machine.getProject(state, project.id).goal = "R7 marker"; });
    fs.appendFileSync(`${statePath}.jsonl`, '{"at":"truncated"', "utf8");
    fs.writeFileSync(statePath, "{broken", "utf8");

    const recovered = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    assert.equal(machine.getProject(recovered.state, project.id).goal, "R7 marker");
    assert.equal(recovered.state.recovery?.source, `${statePath}.jsonl`);
    assert.ok(recovered.state.recovery?.skippedCorruptJournalLines >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R04: an existing unrecoverable profile enters explicit recovery mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-unrecoverable-"));
  try {
    const statePath = path.join(root, "state.json");
    fs.writeFileSync(statePath, "{broken", "utf8");
    fs.writeFileSync(`${statePath}.jsonl`, "{also-broken", "utf8");
    const store = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    assert.equal(store.state.recovery?.mode, "safe-recovery");
    assert.equal(store.state.recovery?.status, "unrecoverable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R04: safe recovery mode cannot create a new acceptance", () => {
  const state = machine.createEmptyState();
  state.recovery = { mode: "safe-recovery", status: "unrecoverable" };
  const project = machine.addProject(state, "C:\\fixture\\recovery-block");
  const task = machine.createTask(state, project.id, { title: "must not accept", criteria: "A" });
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, candidate("blocked", [{ criterion: "A", status: "pass" }]));
  assert.throws(() => machine.acceptTaskResult(state, project.id, task.id), /RECOVERY_MODE/);
  assert.equal(project.revision, 1);
  assert.equal(task.status, "review");
});

test("P0 R05: a throwing mutator cannot pollute live or durable state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-atomic-"));
  try {
    const statePath = path.join(root, "state.json");
    const store = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    const project = machine.addProject(store.state, path.join(root, "project"));
    store.write();
    const before = machine.getProject(store.state, project.id).goal;
    assert.throws(() => store.update((state) => {
      machine.getProject(state, project.id).goal = "half state";
      throw new Error("boom");
    }), /boom/);
    assert.equal(machine.getProject(store.state, project.id).goal, before);
    assert.equal(machine.getProject(JSON.parse(fs.readFileSync(statePath, "utf8")), project.id).goal, before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R05: stale direct writers fail with an explicit conflict instead of losing updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-conflict-"));
  try {
    const statePath = path.join(root, "state.json");
    const first = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    const project = machine.addProject(first.state, path.join(root, "project"));
    first.write();
    const stale = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    first.update((state) => { machine.getProject(state, project.id).goal = "newest"; });
    machine.getProject(stale.state, project.id).goal = "stale overwrite";
    assert.throws(() => stale.write(), /STATE_CONFLICT/);
    assert.equal(machine.getProject(JSON.parse(fs.readFileSync(statePath, "utf8")), project.id).goal, "newest");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R05: a failed primary commit cannot publish a newer derived projection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-projection-order-"));
  try {
    const statePath = path.join(root, "state.json");
    const contextRoot = path.join(root, "derived");
    const store = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    const project = machine.addProject(store.state, path.join(root, "project"));
    store.write();
    store.contextRoot = contextRoot;
    fs.rmSync(statePath, { force: true });
    fs.mkdirSync(statePath);
    machine.getProject(store.state, project.id).goal = "must not project";
    assert.throws(() => store.write());
    assert.equal(fs.existsSync(path.join(contextRoot, "projects", project.id, "context", "cto-context.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R05: a projection failure does not turn a committed primary update into a retry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-p0-projection-failure-"));
  try {
    const statePath = path.join(root, "state.json");
    const store = new HarnessStore(statePath, root, { initialStateMode: "empty" });
    const project = store.update((state) => machine.addProject(state, path.join(root, "project")));
    const blockedProjectionRoot = path.join(root, "not-a-directory");
    fs.writeFileSync(blockedProjectionRoot, "blocked", "utf8");
    store.contextRoot = blockedProjectionRoot;
    assert.doesNotThrow(() => store.update((state) => { machine.getProject(state, project.id).goal = "committed"; }));
    const durable = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(machine.getProject(durable, project.id).goal, "committed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P0 R06: contract changes reject results from the old contract", () => {
  const { state, project, task } = reviewFixture("A");
  machine.updateProjectContract(state, project.id, { goal: "new contract" });
  assert.throws(
    () => machine.submitTaskResult(state, project.id, task.id, candidate("stale", [{ criterion: "A", status: "pass" }])),
    /STALE_CONTRACT/,
  );
});

test("P0 R06: a fresh provider task always receives a self-contained FULL packet", () => {
  const state = machine.createInitialState("C:\\fixture\\full-packet");
  const project = state.projects[0];
  project.tasks = [];
  project.goal = "full goal";
  project.constraints = ["keep lightweight"];
  const first = machine.createTask(state, project.id, { title: "first", workstream: "same", criteria: "A" });
  const firstRun = machine.dispatchTask(state, project.id, first.id);
  machine.submitTaskResult(state, project.id, first.id, candidate("first", [{ criterion: "A", status: "pass" }]));
  machine.acceptTaskResult(state, project.id, first.id);
  const second = machine.createTask(state, project.id, { title: "second", workstream: "same", criteria: "B" });
  const secondRun = machine.dispatchTask(state, project.id, second.id);
  assert.equal(secondRun.session.id, firstRun.session.id, "logical workstream session is still reusable");
  assert.match(secondRun.missionPacket, /FULL PACKET/);
  assert.match(secondRun.missionPacket, /full goal/);
  assert.match(secondRun.missionPacket, /keep lightweight/);
  assert.doesNotMatch(secondRun.missionPacket, /DELTA PACKET/);
});
