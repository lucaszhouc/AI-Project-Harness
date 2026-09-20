const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");
const { resolveProjectByName } = require("../electron/project-discovery.cjs");
const { ensureCodexProjectFolder, assignCodexThreadToProjectFolder, legacyStateSyncEnabled } = require("../electron/codex-projects.cjs");
const { resolveDataRoot } = require("../electron/runtime-paths.cjs");

test("new projects always receive CTO and Review control sessions", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = machine.addProject(state, "C:\\work\\Local Chat");
  const roles = project.sessions.map((session) => session.role);
  assert.ok(roles.includes("cto"));
  assert.ok(roles.includes("review"));
  assert.deepEqual(Object.keys(project.controlSessions).sort(), ["ctoId", "reviewId"]);
});

test("automatic Review Agent accepts a valid agent result and advances HEAD", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const task = machine.createTask(state, project.id, { title: "自动审核" });
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, {
    source: "agent-auto",
    summary: "完成并附带证据",
    acceptance: [{ criterion: "可验证", status: "pass" }],
    evidence: [{ type: "test", value: "npm test" }],
  });
  const checkpoint = machine.autoReviewTaskResult(state, project.id, task.id);
  assert.equal(task.status, "accepted");
  assert.equal(task.review.status, "approved");
  assert.equal(project.revision, 2);
  assert.equal(checkpoint.revision, 2);
});

test("bounded discovery finds a portfolio project by the personal-website alias", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-broad-discovery-"));
  try {
    const projectPath = path.join(root, "portfolio-layered-hero-2026-08-31");
    fs.mkdirSync(path.join(projectPath, "site"), { recursive: true });
    const result = resolveProjectByName({ name: "个人网站", recentCwds: [root] });
    assert.equal(result.path, projectPath);
    assert.equal(result.match.matchedName, "个人网站");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("default project roots are still scanned when Codex has recent cwd entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-default-root-"));
  try {
    const projectPath = path.join(root, "portfolio-layered-hero-2026-08-31");
    fs.mkdirSync(path.join(projectPath, "site"), { recursive: true });
    const result = resolveProjectByName({
      name: "个人网站",
      recentCwds: ["E:\\Cloudflare\\my-workflow"],
      defaultScanRoots: [root],
    });
    assert.equal(result.path, projectPath);
    assert.equal(result.match.matchedName, "个人网站");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex folder mapping persists project and thread assignment on disk", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-folder-"));
  try {
    const statePath = path.join(root, ".codex-global-state.json");
    const folder = ensureCodexProjectFolder({ projectPath: path.join(root, "Local Chat"), projectName: "Local Chat", threadIds: ["thread-1", "thread-2"], officialProjectId: "official-project-1", statePath, enabled: true });
    assignCodexThreadToProjectFolder({ threadId: "thread-1", projectId: folder.projectId, statePath, enabled: true });
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state["local-projects"][folder.projectId].name, "Local Chat");
    assert.equal(state["thread-project-assignments"]["thread-1"].projectId, folder.projectId);
    assert.equal(state["thread-project-assignments"]["thread-2"].projectId, folder.projectId);
    assert.deepEqual(state["sidebar-project-thread-orders"][folder.projectId].threadIds, ["thread-1", "thread-2"]);
    assert.equal(state["app-server-project-id-by-legacy-project-id-by-host"][`local:${root}`][folder.projectId], "official-project-1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex folder mapping keeps legacy and official ids separate and updates the unified sidebar order", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-unified-sidebar-"));
  try {
    const statePath = path.join(root, ".codex-global-state.json");
    const folder = ensureCodexProjectFolder({
      projectPath: path.join(root, "AI Project Harness"),
      projectName: "AI Project Harness",
      officialProjectId: "official-project-1",
      threadIds: ["control-thread"],
      statePath,
      enabled: true,
    });
    assert.equal(folder.projectId, folder.legacyProjectId);
    assert.equal(folder.officialProjectId, "official-project-1");
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(
      state["electron-persisted-atom-state"]["unified-sidebar-project-order-v1"],
      [`codex:project:${folder.projectId}`],
    );
    assignCodexThreadToProjectFolder({ threadId: "new-thread", projectId: "official-project-1", statePath, enabled: true });
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state["thread-project-assignments"]["new-thread"].projectId, folder.projectId);
    assert.equal(state["sidebar-project-thread-orders"]["official-project-1"], undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex global state sync retries transient Windows rename contention", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-state-retry-"));
  try {
    const statePath = path.join(root, ".codex-global-state.json");
    let renameAttempts = 0;
    const fileSystem = {
      ...fs,
      renameSync(from, to) {
        renameAttempts += 1;
        if (renameAttempts < 3) {
          const error = new Error("target is busy");
          error.code = "EPERM";
          throw error;
        }
        return fs.renameSync(from, to);
      },
    };
    const folder = ensureCodexProjectFolder({
      projectPath: path.join(root, "demo"),
      projectName: "demo",
      statePath,
      fileSystem,
      enabled: true,
    });
    assert.equal(renameAttempts, 3);
    assert.ok(JSON.parse(fs.readFileSync(statePath, "utf8"))["local-projects"][folder.projectId]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy Codex global-state writes are opt-in", () => {
  assert.equal(legacyStateSyncEnabled({}), false);
  assert.equal(legacyStateSyncEnabled({ APH_ENABLE_CODEX_LEGACY_STATE_SYNC: "0" }), false);
  assert.equal(legacyStateSyncEnabled({ APH_ENABLE_CODEX_LEGACY_STATE_SYNC: "1" }), true);
});

test("legacy folder helper does not write unless explicitly enabled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-legacy-guard-"));
  try {
    const statePath = path.join(root, ".codex-global-state.json");
    const result = ensureCodexProjectFolder({ projectPath: path.join(root, "demo"), projectName: "demo", statePath });
    assert.equal(result.skipped, "legacy-sync-disabled");
    assert.equal(fs.existsSync(statePath), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("legacy thread assignment is also a no-op unless explicitly enabled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-thread-guard-"));
  try {
    const statePath = path.join(root, ".codex-global-state.json");
    const result = assignCodexThreadToProjectFolder({ threadId: "thread-1", projectId: "project-1", statePath });
    assert.equal(result.skipped, "legacy-sync-disabled");
    assert.equal(fs.existsSync(statePath), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("explicit data root wins and APH_USER_DATA keeps test profiles isolated", () => {
  assert.equal(resolveDataRoot({ envValue: "E:\\durable-harness", userDataPath: "C:\\temp\\profile", platform: "win32" }), path.resolve("E:\\durable-harness"));
});

test("store writes a replayable JSONL state journal beside the durable state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-journal-"));
  try {
    const statePath = path.join(root, "harness-state.json");
    const store = new HarnessStore(statePath, root);
    store.update((state) => machine.addProject(state, path.join(root, "one")));
    const journalPath = `${statePath}.jsonl`;
    assert.ok(fs.existsSync(journalPath));
    assert.ok(fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(Boolean).length >= 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
