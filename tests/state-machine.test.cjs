const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");

const result = (summary = "Task complete") => ({
  summary,
  completed: ["implementation"],
  remaining: [],
  nextStep: "review",
  acceptance: [{ criterion: "works", status: "pass" }],
  evidence: [{ type: "test", value: "node --test" }],
});

test("accepted task advances Project HEAD and warms its reusable session", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const firstTask = project.tasks[0];
  const checkpoint = machine.acceptTaskResult(state, project.id, firstTask.id);
  assert.equal(project.revision, 2);
  assert.equal(checkpoint.revision, 2);
  assert.equal(firstTask.status, "accepted");
  assert.equal(project.sessions[0].status, "warm");
  assert.equal(project.sessions[0].cursor, 2);
  assert.equal(checkpoint.source.agent, "codex");
});

test("related task reuses a warm workstream session", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  machine.acceptTaskResult(state, project.id, project.tasks[0].id);
  const warmSessionId = project.sessions[0].id;
  const task = machine.createTask(state, project.id, {
    title: "Second desktop task",
    workstream: "desktop-mvp",
    criteria: "Keep the same context",
    agent: "codex",
    sessionPolicy: "auto",
  });
  const dispatched = machine.dispatchTask(state, project.id, task.id);
  assert.equal(dispatched.session.id, warmSessionId);
  assert.equal(dispatched.session.type, "warm");
  assert.match(dispatched.missionPacket, /PROJECT_REVISION: R2/);
  assert.match(project.events[0].type, /^task\.dispatched$/);
  assert.match(project.events[0].detail, /run .* section .* codex/);
});

test("warm session rotates after its bounded accepted-task budget", () => {
  const state = machine.createInitialState("C:\\work\\session-budget");
  const project = state.projects[0];
  project.tasks = [];
  let firstSession;
  for (let index = 0; index < 6; index += 1) {
    const task = machine.createTask(state, project.id, { title: `任务 ${index}`, workstream: "bounded" });
    const run = machine.dispatchTask(state, project.id, task.id);
    firstSession ||= run.session.id;
    machine.submitTaskResult(state, project.id, task.id, { summary: `完成 ${index}` });
    machine.acceptTaskResult(state, project.id, task.id);
  }
  const accepted = project.tasks.filter((task) => task.status === "accepted");
  assert.equal(accepted.length, 6);
  assert.notEqual(accepted[0].sessionId, accepted.at(-1).sessionId);
});

test("reused warm session receives a bounded DELTA packet after its first accepted task", () => {
  const state = machine.createInitialState("C:\\work\\delta");
  const project = state.projects[0];
  project.tasks = [];
  const first = machine.createTask(state, project.id, { title: "第一项", workstream: "delta" });
  const firstRun = machine.dispatchTask(state, project.id, first.id);
  machine.submitTaskResult(state, project.id, first.id, { summary: "第一项完成" });
  machine.acceptTaskResult(state, project.id, first.id);
  const second = machine.createTask(state, project.id, { title: "第二项", workstream: "delta" });
  const secondRun = machine.dispatchTask(state, project.id, second.id);
  assert.equal(secondRun.session.id, firstRun.session.id);
  assert.match(secondRun.missionPacket, /DELTA PACKET/);
});

test("task dependencies block dispatch until prerequisite is accepted", () => {
  const state = machine.createInitialState("C:\\work\\dependencies");
  const project = state.projects[0];
  project.tasks = [];
  const prerequisite = machine.createTask(state, project.id, { title: "前置" });
  const dependent = machine.createTask(state, project.id, { title: "后置", dependsOn: [prerequisite.id] });
  assert.throws(() => machine.dispatchTask(state, project.id, dependent.id), /依赖尚未完成/);
  machine.dispatchTask(state, project.id, prerequisite.id);
  machine.submitTaskResult(state, project.id, prerequisite.id, { summary: "前置完成" });
  machine.acceptTaskResult(state, project.id, prerequisite.id);
  assert.doesNotThrow(() => machine.dispatchTask(state, project.id, dependent.id));
});

test("Codex Project sync state keeps official creation separate from sidebar visibility", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  project.codexProjectId = "official-project-1";
  const first = machine.setCodexProjectSync(state, project.id, {
    officialProjectId: project.codexProjectId,
    checkedAt: "2026-09-04T10:00:00.000Z",
  });
  assert.equal(first.state, "desktop-restart-required");
  assert.equal(first.officialProjectId, "official-project-1");
  assert.match(first.detail, /完全退出/);
  const timestamp = first.checkedAt;
  const second = machine.setCodexProjectSync(state, project.id, {
    officialProjectId: project.codexProjectId,
    checkedAt: "2026-09-04T10:01:00.000Z",
  });
  assert.equal(second.checkedAt, timestamp, "heartbeat refresh must not rewrite evidence time");
  const registered = machine.setCodexProjectSync(state, project.id, {
    officialProjectId: project.codexProjectId,
    state: "desktop-registered",
    detail: "Desktop 深链已接受",
  });
  assert.equal(registered.state, "desktop-registered");
  assert.equal(registered.detail, "Desktop 深链已接受");
});

test("disposable session retires after acceptance", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const task = project.tasks.find((item) => item.sessionPolicy === "disposable");
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, result());
  machine.acceptTaskResult(state, project.id, task.id);
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  assert.equal(session.status, "retired");
});

test("stale candidate cannot overwrite a newer Project HEAD", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const parallelTask = project.tasks[1];
  machine.dispatchTask(state, project.id, parallelTask.id);
  machine.acceptTaskResult(state, project.id, project.tasks[0].id);
  machine.submitTaskResult(state, project.id, parallelTask.id, result("Stale result"));
  assert.throws(() => machine.acceptTaskResult(state, project.id, parallelTask.id), /STALE_RESULT/);
  assert.equal(project.revision, 2);
  assert.equal(parallelTask.status, "review");
});

test("blank task title is rejected", () => {
  const state = machine.createInitialState("C:\\fixture");
  assert.throws(() => machine.createTask(state, state.projects[0].id, { title: "   " }), /title is required/);
});

test("invalid Section assignment fails atomically without leaving a phantom task", () => {
  const state = machine.createInitialState("C:\\work\\section-atomic");
  const project = state.projects[0];
  const before = project.tasks.length;
  assert.throws(() => machine.createTask(state, project.id, { title: "bad section", sectionId: "missing" }), /Section not found/);
  assert.equal(project.tasks.length, before);
});

test("Claude and Hermes tasks use a user-invoked run without PTY automation", () => {
  const state = machine.createInitialState("C:\\work\\user-agent");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "Claude handoff", agent: "claude" });
  const result = machine.prepareUserAgentTask(state, project.id, task.id);
  assert.equal(result.task.status, "awaiting_result");
  assert.equal(result.task.run.status, "awaiting_user");
  assert.equal(result.task.run.userActionRequired, true);
});

test("running task can be stopped and its reusable section returns to idle", () => {
  const state = machine.createInitialState("C:\\work\\stop-task");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "可停止" });
  machine.dispatchTask(state, project.id, task.id);
  machine.stopTask(state, project.id, task.id, "用户取消");
  assert.equal(task.status, "failed");
  assert.equal(task.run.phase, "stopped");
  const section = project.sections.find((item) => item.id === task.sectionId);
  assert.equal(section.status, "idle");
});

test("task result normalization bounds long fields and fills missing criterion labels", () => {
  const state = machine.createInitialState("C:\\work\\result-bound");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "结果边界", criteria: "必须通过" });
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, {
    summary: "x".repeat(9000),
    acceptance: [{ status: "PASS" }, { criterion: "bad", status: "unknown" }],
    evidence: [{ type: "test", value: "ok" }],
  });
  assert.equal(task.candidate.summary.length, 4000);
  assert.equal(task.candidate.acceptance[0].criterion, "必须通过");
  assert.equal(task.candidate.acceptance[0].status, "pass");
  assert.equal(task.candidate.acceptance[1].status, "pending");
});

test("reject preserves the candidate in provenance while making the run terminal", () => {
  const state = machine.createInitialState("C:\\work\\reject");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "拒绝候选" });
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, { summary: "候选", evidence: [{ type: "test", value: "x" }] });
  machine.rejectTaskResult(state, project.id, task.id, "证据不足");
  assert.equal(task.status, "failed");
  assert.equal(task.rejectedCandidate.summary, "候选");
  assert.equal(task.candidate, undefined);
});

test("project can create an independent discussion session without creating a task", () => {
  const state = machine.createInitialState("C:\\work\\conversation");
  const project = state.projects[0];
  const beforeTasks = project.tasks.length;
  const session = machine.createConversationSession(state, project.id, { title: "架构讨论", type: "warm" });
  assert.equal(project.tasks.length, beforeTasks);
  assert.equal(session.role, "conversation");
  assert.equal(session.cursor, project.revision);
});

test("project onboarding creates one Codex warm run and reuses it while active", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = machine.addProject(state, "C:\\work\\named-project");
  const first = machine.createAndDispatchOnboarding(state, project.id);
  const second = machine.createAndDispatchOnboarding(state, project.id);

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.task.id, first.task.id);
  assert.equal(second.session.id, first.session.id);
  assert.equal(second.task.agent, "codex");
  assert.equal(second.task.sessionPolicy, "warm");
  assert.match(second.missionPacket, /识别真实技术栈、入口和现有文档/);
});

test("blank project creation is local-only and does not require a path or Codex metadata", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = machine.createBlankProject(state, { name: "我的空白项目", goal: "先定义产品边界" });
  assert.equal(project.name, "我的空白项目");
  assert.equal(project.path, "");
  assert.equal(project.source.kind, "blank");
  assert.equal(project.codexProjectId, undefined);
  assert.equal(project.tasks.length, 0);
  assert.equal(project.codexImport, undefined);
  assert.equal(project.sessions.some((session) => session.role === "cto"), true);
  assert.equal(project.sessions.some((session) => session.role === "review"), true);
  assert.equal(state.selectedProjectId, project.id);
  assert.equal(project.events[0].type, "project.created.blank");
});

test("blank projects are not background-provisioned into Codex until explicitly connected", () => {
  const state = machine.createInitialState("C:\\fixture");
  const blank = machine.createBlankProject(state, { name: "本地草稿", path: "C:\\work\\draft" });
  assert.equal(machine.shouldAutoProvisionCodexProject(blank), false);
  blank.codexProjectId = "official-after-user-action";
  assert.equal(machine.shouldAutoProvisionCodexProject(blank), true);
  const withoutPath = machine.createBlankProject(state, { name: "无目录" });
  withoutPath.codexProjectId = "official-without-root";
  assert.equal(machine.shouldAutoProvisionCodexProject(withoutPath), false);
});

test("blank project requires a human-readable name", () => {
  const state = machine.createInitialState("C:\\fixture");
  assert.throws(() => machine.createBlankProject(state, { name: "  " }), /Project name is required/);
});

test("blank project can bind a workspace later without changing identity", () => {
  const state = machine.createInitialState("C:\\fixture");
  const blank = machine.createBlankProject(state, { name: "稍后绑定" });
  const originalId = blank.id;
  machine.updateProjectContract(state, blank.id, { path: "C:\\work\\later" });
  assert.equal(blank.id, originalId);
  assert.equal(blank.path, path.resolve("C:\\work\\later"));
});

test("Codex import request creates a queued hydration task without dispatching an Agent", () => {
  const state = machine.createInitialState("C:\\fixture");
  const result = machine.requestCodexProjectImport(state, {
    codexProjectId: "codex-project-42",
    name: "远端项目",
    path: "C:\\work\\remote-project",
  });
  assert.equal(result.reused, false);
  assert.equal(result.project.source.kind, "codex-import");
  assert.equal(result.project.codexProjectId, "codex-project-42");
  assert.equal(result.project.codexImport.status, "queued");
  assert.equal(result.project.codexImport.taskId, result.task.id);
  assert.equal(result.task.workstream, "codex-project-import");
  assert.equal(result.task.status, "ready");
  assert.equal(result.task.run, undefined, "import request must not launch or dispatch Codex");
  assert.equal(result.project.events[0].type, "project.codex-import.requested");
});

test("Codex import request is idempotent for an existing project and active import task", () => {
  const state = machine.createInitialState("C:\\fixture");
  const first = machine.requestCodexProjectImport(state, { codexProjectId: "codex-project-42", name: "远端项目" });
  const second = machine.requestCodexProjectImport(state, { codexProjectId: "codex-project-42", name: "别名" });
  assert.equal(second.reused, true);
  assert.equal(second.project.id, first.project.id);
  assert.equal(second.task.id, first.task.id);
  assert.equal(state.projects.filter((project) => project.codexProjectId === "codex-project-42").length, 1);
});

test("Codex import can target an existing blank project without creating a duplicate", () => {
  const state = machine.createInitialState("C:\\fixture");
  const blank = machine.createBlankProject(state, { name: "先手动建的项目" });
  const result = machine.requestCodexProjectImport(state, {
    targetProjectId: blank.id,
    codexProjectId: "codex-project-target",
  });
  assert.equal(result.project.id, blank.id);
  assert.equal(result.project.source.kind, "codex-import");
  assert.equal(result.project.path, "");
  assert.equal(state.projects.filter((project) => project.id === blank.id).length, 1);
});

test("Codex import binds an empty blank path and rejects an existing mismatched path", () => {
  const state = machine.createInitialState("C:\\fixture");
  const blank = machine.createBlankProject(state, { name: "待绑定" });
  const result = machine.requestCodexProjectImport(state, { targetProjectId: blank.id, codexProjectId: "codex-bind", path: "C:\\work\\bound" });
  assert.equal(result.project.path, path.resolve("C:\\work\\bound"));

  const other = machine.createBlankProject(state, { name: "已有路径", path: "C:\\work\\one" });
  assert.throws(() => machine.requestCodexProjectImport(state, { targetProjectId: other.id, codexProjectId: "codex-other", path: "C:\\work\\two" }), /CODEX_IMPORT_PATH_MISMATCH/);
});

test("an existing Harness project cannot silently rebind to another Codex Project", () => {
  const state = machine.createInitialState("C:\\fixture");
  const blank = machine.createBlankProject(state, { name: "Bound", path: "C:\\work\\bound" });
  machine.requestCodexProjectImport(state, { targetProjectId: blank.id, codexProjectId: "codex-one", path: "C:\\work\\bound" });
  assert.throws(() => machine.requestCodexProjectImport(state, { targetProjectId: blank.id, codexProjectId: "codex-two", path: "C:\\work\\bound" }), /CODEX_IMPORT_SOURCE_REBIND_REQUIRED/);
});

test("failed Codex import retries reuse the same durable task", () => {
  const state = machine.createInitialState("C:\\fixture");
  const first = machine.requestCodexProjectImport(state, { codexProjectId: "codex-retry", name: "Retry", path: "C:\\fixture" });
  machine.dispatchTask(state, first.project.id, first.task.id);
  machine.markRunFailed(state, first.project.id, first.task.id, "temporary failure");
  const retry = machine.requestCodexProjectImport(state, { codexProjectId: "codex-retry", name: "Retry", path: "C:\\fixture" });
  assert.equal(retry.reused, true);
  assert.equal(retry.task.id, first.task.id);
  assert.equal(first.project.tasks.filter((task) => task.workstream === "codex-project-import").length, 1);
});

test("a later Codex refresh preserves the accepted source revision guard", () => {
  const state = machine.createInitialState("C:\\fixture");
  const first = machine.requestCodexProjectImport(state, { codexProjectId: "codex-refresh", name: "Refresh", path: "C:\\fixture" });
  first.project.codexImport.sourceRevision = 22;
  first.task.status = "accepted";
  const refresh = machine.requestCodexProjectImport(state, { codexProjectId: "codex-refresh", name: "Refresh", path: "C:\\fixture" });
  assert.equal(refresh.reused, false);
  assert.notEqual(refresh.task.id, first.task.id);
  assert.equal(refresh.project.codexImport.sourceRevision, 22);
});

test("Codex import request requires an external Project id", () => {
  const state = machine.createInitialState("C:\\fixture");
  assert.throws(() => machine.requestCodexProjectImport(state, { name: "没有 ID" }), /Codex Project id is required/);
});

test("Codex import candidate stays behind review until explicit acceptance", () => {
  const state = machine.createInitialState("C:\\fixture");
  const requested = machine.requestCodexProjectImport(state, {
    codexProjectId: "codex-project-review",
    name: "Review Project",
    path: "C:\\fixture",
  });
  const dispatched = machine.dispatchTask(state, requested.project.id, requested.task.id);
  const candidate = {
    version: 1,
    type: "harness-import",
    generatedAt: "2026-09-04T12:00:00.000Z",
    source: { agent: "codex", codexProjectId: "codex-project-review", sourceRevision: 17 },
    project: { name: "Review Project", path: "C:\\fixture", goal: "真实目标", objective: "最新目标", techStack: ["Node.js"], constraints: [], blockers: [] },
    sections: [{ id: "remote-section", name: "核心实现", kind: "reusable", status: "idle", agent: "codex", taskIds: [] }],
    tasks: [{ id: "remote-task", title: "远端任务", workstream: "core", status: "accepted", criteria: [], sectionId: "remote-section" }],
    checkpoints: [{ id: "remote-r17", revision: 17, summary: "9 月 4 日最新进展", nextStep: "继续验证", evidence: [] }],
    decisions: [],
    sessions: [],
    git: { available: true, branch: "main", dirty: false, commits: [{ hash: "abc", subject: "latest", date: "2026-09-04T22:00:00.000Z" }] },
    notes: [],
  };
  machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, candidate);
  const project = machine.getProject(state, requested.project.id);
  const task = project.tasks.find((item) => item.id === dispatched.task.id);
  assert.equal(task.status, "review");
  assert.equal(project.codexImport.status, "awaiting_review");
  assert.match(task.candidate.summary, /9 月 4 日最新进展/);
  assert.equal(project.tasks.some((item) => item.externalId === "remote-task"), false, "candidate must not mutate tasks before acceptance");

  // Applying the candidate and accepting the import are intentionally two
  // explicit operations, mirroring the main-process review gate.
  const { applyHarnessImport } = require("../electron/codex-import.cjs");
  applyHarnessImport(state, requested.project.id, candidate);
  machine.acceptCodexImportCandidate(state, requested.project.id, dispatched.task.id);
  assert.equal(task.status, "accepted");
  assert.equal(project.codexImport.status, "completed");
  assert.equal(project.tasks.some((item) => item.externalId === "remote-task"), true);
  assert.equal(project.checkpoints[0].source.agent, "codex");
});

test("repeated Codex import candidate notifications are idempotent", () => {
  const state = machine.createInitialState("C:\\fixture");
  const requested = machine.requestCodexProjectImport(state, { codexProjectId: "codex-project-repeat", name: "Repeat", path: "C:\\fixture" });
  const dispatched = machine.dispatchTask(state, requested.project.id, requested.task.id);
  const candidate = { version: 1, type: "harness-import", generatedAt: "2026-09-04T12:00:00.000Z", source: { agent: "codex", codexProjectId: "codex-project-repeat" }, project: { name: "Repeat", path: "C:\\fixture" }, tasks: [], sections: [], checkpoints: [], decisions: [], notes: [] };
  machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, candidate);
  const eventCount = requested.project.events.length;
  machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, candidate);
  assert.equal(requested.project.events.length, eventCount);
  assert.equal(requested.project.tasks.filter((task) => task.workstream === "codex-project-import").length, 1);
});

test("Codex import candidate requires the bound official Project and root before review", () => {
  const state = machine.createInitialState("C:\\fixture");
  const requested = machine.requestCodexProjectImport(state, { codexProjectId: "codex-bound", name: "Bound", path: "C:\\fixture" });
  const dispatched = machine.dispatchTask(state, requested.project.id, requested.task.id);
  const base = { version: 1, type: "harness-import", generatedAt: "2026-09-04T12:00:00.000Z", source: { agent: "codex", codexProjectId: "codex-bound", sourceRevision: 3 }, project: { name: "Bound", path: "C:\\fixture" }, tasks: [], sections: [], checkpoints: [], decisions: [] };
  const missingSource = JSON.parse(JSON.stringify(base));
  delete missingSource.source.codexProjectId;
  assert.throws(() => machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, missingSource), /HARNESS_IMPORT_SOURCE_REQUIRED/);
  const wrongRoot = JSON.parse(JSON.stringify(base));
  wrongRoot.project.path = "C:\\other";
  assert.throws(() => machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, wrongRoot), /HARNESS_IMPORT_PROJECT_MISMATCH/);
  machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, base);
  assert.equal(dispatched.task.status, "review");
  const stale = JSON.parse(JSON.stringify(base));
  stale.source.sourceRevision = 2;
  assert.throws(() => machine.recordCodexImportCandidate(state, requested.project.id, dispatched.task.id, stale), /HARNESS_IMPORT_STALE_SOURCE/);
});

test("corrupt local state is preserved as a backup and safely reseeded", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-store-"));
  const statePath = path.join(tempRoot, "state.json");
  fs.writeFileSync(statePath, "{broken", "utf8");
  const store = new HarnessStore(statePath, tempRoot);
  assert.equal(store.state.schemaVersion, 1);
  const backups = fs.readdirSync(tempRoot).filter((name) => name.startsWith("state.json.corrupt-"));
  assert.equal(backups.length, 1);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
