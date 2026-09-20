const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HarnessStore } = require("../electron/store.cjs");
const machine = require("../electron/state-machine.cjs");
const { createAgentRunMonitor } = require("../electron/agent-run-monitor.cjs");

test("runtime projection persists Agent completion, result and Git snapshot to the Harness data file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-runtime-persist-"));
  try {
    const store = new HarnessStore(path.join(root, "harness-state.json"), root);
    const project = machine.addProject(store.state, path.join(root, "project"));
    fs.mkdirSync(project.path, { recursive: true });
    const task = machine.createTask(store.state, project.id, { title: "持久化运行态" });
    machine.dispatchTask(store.state, project.id, task.id);
    machine.attachExternalThread(store.state, project.id, task.id, { threadId: "thread-persist", turnId: "turn-persist", processId: 999999, desktopOpened: true });
    store.write();
    const monitor = createAgentRunMonitor({
      state: store.state,
      projectId: project.id,
      taskId: task.id,
      readGit: async () => ({ available: true, branch: "feature/runtime", dirty: false, changeCount: 0, changes: [], commits: [{ shortHash: "abc1234", subject: "runtime" }], checkedAt: new Date().toISOString() }),
      onUpdate: async () => store.write(),
    });
    await monitor.handleNotification({ method: "turn/completed", params: { threadId: "thread-persist", turnId: "turn-persist", turn: { status: "completed", output: "```harness-result\n{\"summary\":\"已自动回写\",\"completed\":[\"runtime\"]}\n```" } } });
    const reloaded = new HarnessStore(path.join(root, "harness-state.json"), root);
    const savedProject = reloaded.state.projects.find((item) => item.id === project.id);
    const savedTask = savedProject.tasks.find((item) => item.id === task.id);
    assert.equal(savedTask.status, "review");
    assert.equal(savedTask.run.status, "completed");
    assert.equal(savedTask.run.resultSource, "agent-auto");
    assert.equal(savedTask.candidate.summary, "已自动回写");
    assert.equal(savedProject.gitSnapshot.branch, "feature/runtime");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("state journal rotates at a bounded size and keeps numbered history", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-journal-rotation-"));
  try {
    const store = new HarnessStore(path.join(root, "state.json"), path.join(root, "project"), { contextRoot: root, journalMaxBytes: 900, journalRotations: 2 });
    for (let index = 0; index < 8; index += 1) {
      store.update((state) => { state.projects[0].events.unshift({ id: String(index), type: "test", at: new Date().toISOString(), detail: "x".repeat(100) }); });
    }
    assert.ok(fs.existsSync(path.join(root, "state.json.jsonl")));
    assert.ok(fs.existsSync(path.join(root, "state.json.jsonl.1")));
    assert.ok(!fs.existsSync(path.join(root, "state.json.jsonl.3")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt primary state recovers the newest valid journal snapshot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-journal-recover-"));
  try {
    const statePath = path.join(root, "state.json");
    const store = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: root });
    const projectId = store.state.selectedProjectId;
    store.update((state) => { state.projects[0].goal = "journal recovery marker"; });
    fs.writeFileSync(statePath, "{broken", "utf8");
    const recovered = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: root });
    assert.equal(recovered.state.selectedProjectId, projectId);
    assert.equal(recovered.state.projects[0].goal, "journal recovery marker");
    assert.ok(fs.readdirSync(root).some((name) => name.includes("state.json.corrupt-")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing primary state can be rebuilt from a durable journal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-journal-missing-"));
  try {
    const statePath = path.join(root, "state.json");
    const store = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: root });
    store.update((state) => { state.projects[0].goal = "保留的目标"; });
    fs.rmSync(statePath, { force: true });
    const restored = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: root });
    assert.equal(restored.state.projects[0].goal, "保留的目标");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("running store reloads an atomic snapshot written by an external CLI writer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-external-reload-"));
  try {
    const statePath = path.join(root, "state.json");
    const writer = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: root });
    const reader = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: root });
    writer.update((state) => { state.projects[0].goal = "来自 CLI"; });
    assert.equal(reader.reloadExternal(), true);
    assert.equal(reader.state.projects[0].goal, "来自 CLI");
    assert.equal(reader.reloadExternal(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("state history is bounded before serialization while recent entries remain", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-history-bound-"));
  try {
    const store = new HarnessStore(path.join(root, "state.json"), path.join(root, "project"), { contextRoot: root, boundHistory: true });
    store.update((state) => {
      state.projects[0].events = Array.from({ length: 1200 }, (_, index) => ({ id: String(index), type: "test", at: new Date().toISOString(), detail: String(index) }));
    });
    assert.equal(store.state.projects[0].events.length, 1000);
    assert.equal(store.state.projects[0].events[0].detail, "0");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("long-lived stores bound history by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-history-default-"));
  try {
    const store = new HarnessStore(path.join(root, "state.json"), path.join(root, "project"), { contextRoot: root });
    store.update((state) => {
      state.projects[0].events = Array.from({ length: 1200 }, (_, index) => ({ id: String(index), type: "test", at: new Date().toISOString(), detail: String(index) }));
    });
    assert.equal(store.state.projects[0].events.length, 1000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("legacy projects gain an explicit Codex sidebar verification state on load", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-sync-migration-"));
  try {
    const statePath = path.join(root, "state.json");
    const first = new HarnessStore(statePath, path.join(root, "project"));
    first.state.projects[0].codexProjectId = "official-project-1";
    delete first.state.projects[0].codexProjectSync;
    fs.writeFileSync(statePath, `${JSON.stringify(first.state, null, 2)}\n`, "utf8");
    const reloaded = new HarnessStore(statePath, path.join(root, "project"));
    assert.equal(reloaded.state.projects[0].codexProjectSync.state, "desktop-restart-required");
    assert.match(reloaded.state.projects[0].codexProjectSync.detail, /冷启动|完全退出/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
