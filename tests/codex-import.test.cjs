const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const machine = require("../electron/state-machine.cjs");
const { importPrompt, selectCodexProjectThreads, parseHarnessImport, applyHarnessImport } = require("../electron/codex-import.cjs");
const { launchHarnessImport } = require("../electron/codex-adapter.cjs");
const { ORDINARY_OUTPUT_MAX_CHARS, IMPORT_OUTPUT_MAX_CHARS, createAgentRunMonitor } = require("../electron/agent-run-monitor.cjs");

function payload(projectPath) {
  return {
    version: 1, type: "harness-import",
    generatedAt: "2026-09-04T12:00:00.000Z",
    source: { agent: "codex", codexProjectId: "codex-project-7", sourceRevision: 42, threadIds: ["thread-1"] },
    project: { name: "Demo", path: projectPath, goal: "交付 Demo", objective: "完成导入闭环", techStack: ["Node.js"], constraints: ["本地优先"], blockers: ["待核对部署"] },
    sections: [{ id: "codex-main", name: "实现", kind: "reusable", status: "idle", taskIds: [] }],
    tasks: [{ id: "codex-task-1", title: "修复入口", workstream: "core", status: "accepted", criteria: ["测试通过"], sectionId: "codex-main", externalThreadId: "thread-task", updatedAt: "2026-09-04T10:00:00.000Z" }],
    checkpoints: [{ id: "codex-r42", revision: 42, summary: "入口已经修复", nextStep: "部署", evidence: [{ type: "git-head", value: "abc123" }] }],
    decisions: [{ id: "decision-1", title: "保留本地优先", status: "accepted" }],
    sessions: [{ id: "codex-cto", role: "cto", title: "Codex CTO", status: "warm", externalThreadId: "thread-cto" }],
    git: { available: true, branch: "main", dirty: false, commits: [{ hash: "abc123", subject: "fix entry" }] },
    github: { available: true, remote: { nameWithOwner: "owner/demo", url: "https://github.com/owner/demo" }, issues: [] },
  };
}

function bindImport(project, codexProjectId = "codex-project-7") {
  project.codexProjectId = codexProjectId;
  project.codexImport = { codexProjectId, status: "awaiting_review" };
}

test("import prompt clearly separates read-only Codex pull from new project work", () => {
  const project = { id: "p", name: "Demo", path: "C:\\work\\demo", goal: "old", revision: 2, tasks: [], sections: [], checkpoints: [], decisions: [], events: [], sessions: [] };
  const text = importPrompt(project, { sourceProjectId: "codex-project-7", schemaPath: "C:\\resources\\protocol\\harness-import.schema.json" });
  assert.match(text, /MODE: IMPORT/);
  assert.match(text, /最新时间戳/);
  assert.match(text, /harness-import/);
  assert.match(text, /不得修改代码/);
  assert.match(text, /HARNESS_IMPORT_SCHEMA: C:\\resources\\protocol\\harness-import\.schema\.json/);
});

test("Codex source thread index uses official Project/root/name evidence instead of folder mtimes", () => {
  const project = { id: "codex-site", name: "portfolio-layered-hero-2026-08-31", roots: [{ path: "E:\\site\\portfolio" }] };
  const selected = selectCodexProjectThreads([
    { id: "official", projectId: "codex-site", name: "Review", cwd: "E:\\elsewhere", updatedAt: 10, path: "C:\\sessions\\official.jsonl" },
    { id: "nested", projectId: null, name: "CSS", cwd: "E:\\site\\portfolio\\site", updatedAt: 12, path: "C:\\sessions\\nested.jsonl" },
    { id: "named", projectId: null, name: "个人网站 main", cwd: "E:\\other", updatedAt: 20, path: "C:\\sessions\\named.jsonl" },
    { id: "parent-only", projectId: null, name: "unrelated", cwd: "E:\\site", updatedAt: 30, path: "C:\\sessions\\parent.jsonl" },
    { id: "noise", projectId: null, name: "Local Chat", cwd: "E:\\other", updatedAt: 40, path: "C:\\sessions\\noise.jsonl" },
    { id: "self-import", projectId: "codex-site", name: "portfolio · Harness 导入", cwd: "E:\\site\\portfolio", updatedAt: 50, path: "C:\\sessions\\self.jsonl" },
  ], { project, query: "个人网站", matchedName: "个人网站" });
  assert.deepEqual(selected.map((thread) => thread.id), ["named", "nested", "official"]);
  assert.equal(selected.some((thread) => thread.id === "parent-only"), false);
  assert.equal(selected.some((thread) => thread.id === "self-import"), false);
  assert.equal(selected.some((thread) => Object.hasOwn(thread, "modifiedAt")), false);
});

test("parser accepts the last complete harness-import block and redacts credentials", () => {
  const value = payload("C:\\work\\demo");
  value.project.goal = `token ${"sk-or-"}v1-12345678901234567890`;
  const parsed = parseHarnessImport(`noise\n\`\`\`harness-import\n${JSON.stringify(value)}\n\`\`\``);
  assert.equal(parsed.type, "harness-import");
  assert.equal(parsed.tasks.length, 1);
  assert.match(parsed.project.goal, /已脱敏/);
  assert.throws(() => parseHarnessImport("no result"), /HARNESS_IMPORT_MISSING/);
});

test("parser accepts a generic json fence when the protocol type is harness-import", () => {
  const value = { version: 1, type: "harness-import", generatedAt: "2026-09-05T00:00:00.000Z", source: { agent: "codex", codexProjectId: "codex-project-json-fence" }, project: { name: "JSON fence", path: "C:\\fixture" }, tasks: [], sections: [], checkpoints: [], decisions: [] };
  const parsed = parseHarnessImport(`Here is the snapshot:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``);
  assert.equal(parsed.source.codexProjectId, "codex-project-json-fence");
});

test("normalization orders checkpoints and commits by evidence time, not Agent array order", () => {
  const value = payload("C:\\work\\demo");
  value.checkpoints = [
    { id: "old", revision: 2, summary: "旧进展", acceptedAt: "2026-08-31T10:00:00.000Z", evidence: [] },
    { id: "new", revision: 3, summary: "9 月 4 日最新进展", acceptedAt: "2026-09-04T10:00:00.000Z", evidence: [] },
  ];
  value.git.commits = [
    { hash: "old", subject: "old", date: "2026-08-31T10:00:00.000Z" },
    { hash: "new", subject: "new", date: "2026-09-04T10:00:00.000Z" },
  ];
  const parsed = parseHarnessImport(`\`\`\`harness-import\n${JSON.stringify(value)}\n\`\`\``);
  assert.equal(parsed.checkpoints[0].id, "new");
  assert.equal(parsed.git.commits[0].hash, "new");
});

test("applyHarnessImport merges Codex tasks, sections, progress, Git and source metadata idempotently", () => {
  const root = path.resolve("C:\\work\\demo");
  const state = machine.createInitialState(root);
  const project = state.projects[0];
  bindImport(project);
  const first = applyHarnessImport(state, project.id, payload(root), { now: () => "2026-09-04T12:00:00.000Z" });
  assert.equal(first.sourceRevision, 42);
  assert.equal(project.tasks.some((task) => task.externalId === "codex-task-1"), true);
  assert.equal(project.tasks.find((task) => task.externalId === "codex-task-1").run.externalThreadId, "thread-task");
  assert.equal(project.sections.some((section) => section.name === "实现"), true);
  assert.equal(project.checkpoints.some((checkpoint) => checkpoint.id === "codex-r42"), true);
  assert.equal(project.gitSnapshot.branch, "main");
  assert.equal(project.githubSnapshot.remote.nameWithOwner, "owner/demo");
  const count = project.tasks.length;
  applyHarnessImport(state, project.id, payload(root), { now: () => "2026-09-04T12:01:00.000Z" });
  assert.equal(project.tasks.length, count);
  assert.equal(project.imports.length, 2);
  assert.throws(() => applyHarnessImport(state, project.id, payload("C:\\work\\other")), /PROJECT_MISMATCH/);
});

test("import remaps task dependencies and a stale source revision cannot regress Git", () => {
  const root = path.resolve("C:\\work\\demo");
  const state = machine.createInitialState(root);
  const project = state.projects[0];
  bindImport(project);
  const fresh = payload(root);
  fresh.source.sourceRevision = 9;
  fresh.tasks = [
    { id: "task-review-acid-mvp", externalId: "remote-a", title: "A", workstream: "core", status: "accepted", criteria: [] },
    { id: "remote-b", title: "B", workstream: "core", status: "ready", criteria: [], dependsOn: ["task-review-acid-mvp"] },
  ];
  fresh.git.commits[0].hash = "fresh-head";
  applyHarnessImport(state, project.id, fresh, { now: () => "2026-09-04T13:00:00.000Z" });
  const taskA = project.tasks.find((task) => task.externalId === "remote-a");
  const taskB = project.tasks.find((task) => task.externalId === "remote-b");
  assert.deepEqual(taskB.dependsOn, [taskA.id]);

  const stale = payload(root);
  stale.source.sourceRevision = 8;
  stale.git.commits[0].hash = "stale-head";
  assert.throws(() => applyHarnessImport(state, project.id, stale, { now: () => "2026-09-04T13:01:00.000Z" }), /HARNESS_IMPORT_STALE_SOURCE/);
  assert.equal(project.gitSnapshot.commits[0].hash, "fresh-head");
});

test("imported CTO and Review sessions hydrate the durable control slots", () => {
  const root = path.resolve("C:\\work\\demo");
  const state = machine.createInitialState(root);
  const project = state.projects[0];
  bindImport(project);
  const value = payload(root);
  value.sessions = [
    { id: "remote-cto", role: "cto", title: "旧 CTO", status: "warm", externalThreadId: "thread-cto-imported" },
    { id: "remote-review", role: "review", title: "旧 Review", status: "warm", externalThreadId: "thread-review-imported" },
  ];
  applyHarnessImport(state, project.id, value);
  assert.equal(project.sessions.filter((session) => session.role === "cto").length, 1);
  assert.equal(project.sessions.find((session) => session.role === "cto").externalThreadId, "thread-cto-imported");
  assert.equal(project.sessions.filter((session) => session.role === "review").length, 1);
  assert.equal(project.sessions.find((session) => session.role === "review").externalThreadId, "thread-review-imported");
});

test("import apply requires the exact bound Codex Project and root before any merge", () => {
  const root = path.resolve("C:\\work\\demo");
  const state = machine.createInitialState(root);
  const project = state.projects[0];
  bindImport(project);
  const missingSource = payload(root);
  delete missingSource.source.codexProjectId;
  assert.throws(() => applyHarnessImport(state, project.id, missingSource), /HARNESS_IMPORT_SOURCE_REQUIRED/);
  const wrongSource = payload(root);
  wrongSource.source.codexProjectId = "other-project";
  assert.throws(() => applyHarnessImport(state, project.id, wrongSource), /HARNESS_IMPORT_SOURCE_MISMATCH/);
  const wrongRoot = payload("C:\\work\\other");
  assert.throws(() => applyHarnessImport(state, project.id, wrongRoot), /HARNESS_IMPORT_PROJECT_MISMATCH/);
  assert.equal(project.tasks.some((task) => task.externalId === "codex-task-1"), false);
});

test("generatedAt prevents an unversioned older import from replacing newer project truth", () => {
  const root = path.resolve("C:\\work\\demo");
  const state = machine.createInitialState(root);
  const project = state.projects[0];
  bindImport(project);
  project.codexImport.sourceGeneratedAt = "2026-09-05T00:00:00.000Z";
  const older = payload(root);
  delete older.source.sourceRevision;
  older.generatedAt = "2026-09-04T23:00:00.000Z";
  assert.throws(() => applyHarnessImport(state, project.id, older), /HARNESS_IMPORT_STALE_SOURCE/);
  assert.equal(project.tasks.some((task) => task.externalId === "codex-task-1"), false);
});

test("launchHarnessImport uses an isolated fake app-server and never starts an implementation task", async () => {
  class FakeImportClient {
    static requests = [];
    constructor() { this.requests = FakeImportClient.requests; this.process = { pid: 4321 }; }
    async start() {}
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "import-thread" } };
      if (method === "turn/start") return { turn: { id: "import-turn" } };
      return {};
    }
    close() {}
  }
  const result = await launchHarnessImport({
    executable: "codex.exe", project: { id: "p", name: "Demo", path: "C:\\work\\demo" },
    sourceProjectId: "codex-project-7", skillPath: "C:\\skills\\SKILL.md", Client: FakeImportClient,
  });
  assert.equal(result.threadId, "import-thread");
  assert.equal(result.turnId, "import-turn");
  assert.deepEqual(FakeImportClient.requests.map((item) => item.method), ["thread/start", "thread/name/set", "turn/start"]);
  const turn = FakeImportClient.requests.find((item) => item.method === "turn/start");
  assert.equal(turn.params.input[0].type, "skill");
  assert.match(turn.params.input[1].text, /MODE: IMPORT/);
  assert.equal(FakeImportClient.requests.some((item) => item.method === "project/create"), false);
});

test("import-mode run monitor exposes a validated candidate without treating it as a task result", async () => {
  const state = machine.createInitialState("C:\\work\\demo");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "导入 Codex 项目", workstream: "codex-project-import" });
  machine.dispatchTask(state, project.id, task.id);
  const candidates = [];
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, importMode: true, onImportCandidate: async (value) => candidates.push(value) });
  const value = payload("C:\\work\\demo");
  const output = "```harness-import\n" + JSON.stringify(value) + "\n```";
  await monitor.handleNotification({ method: "item/completed", params: { threadId: "t", turnId: "r", item: { type: "agentMessage", text: output } } });
  assert.equal(candidates.length, 0, "candidate must wait for terminal success");
  await monitor.handleNotification({ method: "turn/completed", params: { threadId: "t", turnId: "r", turn: { status: "completed" } } });
  assert.equal(candidates.length, 1);
  assert.equal(task.candidate, undefined);
});

test("one large final Agent message is not truncated at the ordinary 12KiB text limit", async () => {
  const state = machine.createInitialState("C:\\work\\demo");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "large import", workstream: "codex-project-import" });
  machine.dispatchTask(state, project.id, task.id);
  const candidates = [];
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, importMode: true, onImportCandidate: async (value) => candidates.push(value) });
  const value = payload("C:\\work\\demo");
  value.tasks = Array.from({ length: 80 }, (_, index) => ({ id: `task-${index}`, title: `任务 ${index} ${"x".repeat(220)}`, status: "backlog", criteria: [] }));
  const output = "```harness-import\n" + JSON.stringify(value) + "\n```";
  assert.ok(output.length > 12_000);
  await monitor.handleNotification({ method: "item/completed", params: { item: { type: "agentMessage", text: output } } });
  await monitor.handleNotification({ method: "turn/completed", params: { turn: { status: "completed" } } });
  assert.equal(candidates[0].tasks.length, 80);
});

test("an import run that completes without harness-import becomes retryable instead of hanging", async () => {
  const state = machine.createInitialState("C:\\work\\demo");
  const requested = machine.requestCodexProjectImport(state, { codexProjectId: "codex-project-7", name: "Demo", path: "C:\\work\\demo" });
  machine.dispatchTask(state, requested.project.id, requested.task.id);
  const monitor = createAgentRunMonitor({ state, projectId: requested.project.id, taskId: requested.task.id, importMode: true });
  await monitor.handleNotification({ method: "turn/completed", params: { status: "completed", message: { text: "done without structured payload" } } });
  assert.equal(requested.task.status, "failed");
  assert.equal(requested.task.run.phase, "invalid_result");
  assert.equal(requested.project.codexImport.status, "failed");
});

test("import monitor keeps a 1MiB bounded candidate buffer while normal tasks stay at 50KiB", async () => {
  const state = machine.createInitialState("C:\\work\\monitor-bounds");
  const project = state.projects[0];
  project.tasks = [];
  const ordinaryTask = machine.createTask(state, project.id, { title: "ordinary" });
  const importTask = machine.createTask(state, project.id, { title: "import", workstream: "codex-project-import" });
  machine.dispatchTask(state, project.id, ordinaryTask.id);
  machine.dispatchTask(state, project.id, importTask.id);
  const ordinary = createAgentRunMonitor({ state, projectId: project.id, taskId: ordinaryTask.id });
  const imported = createAgentRunMonitor({ state, projectId: project.id, taskId: importTask.id, importMode: true });
  const text = "x".repeat(12_000);
  for (let index = 0; index < 5; index += 1) {
    await ordinary.handleNotification({ method: "item/completed", params: { item: { type: "agentMessage", text } } });
    await imported.handleNotification({ method: "item/completed", params: { item: { type: "agentMessage", text } } });
  }
  assert.equal(IMPORT_OUTPUT_MAX_CHARS, 1024 * 1024);
  assert.equal(ordinary.getOutput().length, ORDINARY_OUTPUT_MAX_CHARS);
  assert.ok(imported.getOutput().length > ORDINARY_OUTPUT_MAX_CHARS);
  assert.ok(imported.getOutput().length <= IMPORT_OUTPUT_MAX_CHARS);
});
