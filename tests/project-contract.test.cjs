const test = require("node:test");
const assert = require("node:assert/strict");
const sm = require("../electron/state-machine.cjs");

test("project contract updates keep long-lived goal, stack, constraints and blockers", () => {
  const state = sm.createInitialState("C:\\projects\\contract");
  const project = state.projects[0];
  sm.updateProjectContract(state, project.id, {
    goal: "把工程状态从对话中抽离",
    objectiveTitle: "完成跨 Agent 交接",
    techStack: "Electron\nTypeScript",
    constraints: "本地优先\n不自动上传 transcript",
    blockers: "等待 Claude 用户主动调用",
  });
  assert.equal(project.goal, "把工程状态从对话中抽离");
  assert.deepEqual(project.techStack, ["Electron", "TypeScript"]);
  assert.deepEqual(project.constraints, ["本地优先", "不自动上传 transcript"]);
  assert.deepEqual(project.blockers, ["等待 Claude 用户主动调用"]);
  assert.equal(project.objective.title, "完成跨 Agent 交接");
});

test("archiving stops active runs, hides the project, and restore returns it to selected active state", () => {
  const state = sm.createInitialState("C:\\projects\\archive");
  const project = state.projects[0];
  project.tasks = [];
  const task = sm.createTask(state, project.id, { title: "进行中" });
  sm.dispatchTask(state, project.id, task.id);
  sm.archiveProject(state, project.id, "阶段完成");
  assert.equal(project.status, "archived");
  assert.equal(task.status, "timed_out");
  assert.equal(task.run.status, "timed_out");
  assert.equal(task.run.phase, "project_archived");
  assert.match(task.run.error, /归档/);
  assert.equal(state.selectedProjectId, "");
  sm.restoreProject(state, project.id);
  assert.equal(project.status, "active");
  assert.equal(state.selectedProjectId, project.id);
});

test("lease expiry ignores preparation and review states, then times out a real run at 24 hours", () => {
  const state = sm.createInitialState("C:\\projects\\lease");
  const project = state.projects[0];
  project.tasks = [];
  const ready = sm.createTask(state, project.id, { title: "准备中" });
  const awaiting = sm.createTask(state, project.id, { title: "等待用户" });
  const running = sm.createTask(state, project.id, { title: "真实运行" });
  sm.dispatchTask(state, project.id, awaiting.id);
  awaiting.status = "awaiting_result";
  awaiting.run.status = "awaiting_user";
  awaiting.run.userActionRequired = true;
  sm.dispatchTask(state, project.id, running.id);
  running.run.status = "running";
  running.run.externalThreadId = "thread-real";
  running.run.externalTurnId = "turn-real";
  running.run.leaseStartedAt = "2026-10-09T00:00:00.000Z";
  const before = sm.expireTaskLeases(state, Date.parse("2026-10-09T23:59:59.999Z"));
  assert.deepEqual(before, []);
  assert.equal(ready.status, "ready");
  assert.equal(awaiting.status, "awaiting_result");
  assert.equal(running.status, "in_progress");
  const expired = sm.expireTaskLeases(state, Date.parse("2026-10-10T00:00:00.000Z"));
  assert.equal(expired.length, 1);
  assert.equal(expired[0].taskId, running.id);
  assert.equal(running.status, "timed_out");
  assert.equal(running.run.status, "timed_out");
  assert.equal(running.run.timeoutAt, "2026-10-10T00:00:00.000Z");

  const legacy = sm.createTask(state, project.id, { title: "旧格式真实运行" });
  sm.dispatchTask(state, project.id, legacy.id);
  legacy.run.status = "running";
  legacy.run.leaseStartedAt = undefined;
  legacy.run.externalThreadId = undefined;
  legacy.run.externalTurnId = undefined;
  legacy.run.processId = undefined;
  legacy.run.startedAt = "2026-10-01T00:00:00.000Z";
  const legacyExpired = sm.expireTaskLeases(state, Date.parse("2026-10-02T00:00:00.000Z"));
  assert.ok(legacyExpired.some((item) => item.taskId === legacy.id));
  assert.equal(legacy.status, "timed_out");
});

test("timed out tasks can be retried while keeping the old run in history", () => {
  const state = sm.createInitialState("C:\\projects\\retry-timeout");
  const project = state.projects[0];
  project.tasks = [];
  const task = sm.createTask(state, project.id, { title: "可重试任务" });
  sm.dispatchTask(state, project.id, task.id);
  task.run.status = "running";
  task.run.externalThreadId = "old-thread";
  task.run.externalTurnId = "old-turn";
  task.run.leaseStartedAt = "2026-10-01T00:00:00.000Z";
  sm.expireTaskLeases(state, Date.parse("2026-10-02T00:00:00.000Z"));
  const oldRunId = task.run.id;
  sm.dispatchTask(state, project.id, task.id);
  assert.equal(task.status, "in_progress");
  assert.notEqual(task.run.id, oldRunId);
  assert.equal(task.runHistory[0].id, oldRunId);
  assert.equal(task.runHistory[0].status, "timed_out");
});

test("removing a project is reversible at the state boundary and blocks active runs", () => {
  const state = sm.createEmptyState();
  const project = sm.createBlankProject(state, { name: "可恢复移出" });
  const removed = sm.removeProject(state, project.id, "用户清理");
  assert.equal(removed.id, project.id);
  assert.equal(removed.removal.reason, "用户清理");
  assert.equal(state.projects.length, 0);
  assert.equal(state.selectedProjectId, "");

  const runningState = sm.createInitialState("C:\\projects\\remove-running");
  const runningProject = runningState.projects[0];
  const task = sm.createTask(runningState, runningProject.id, { title: "运行中的任务" });
  sm.dispatchTask(runningState, runningProject.id, task.id);
  assert.throws(() => sm.removeProject(runningState, runningProject.id), /进行中的任务/);
});

test("objective rotation leaves at most one active objective and preserves history", () => {
  const state = sm.createInitialState("C:\\projects\\objectives");
  const project = state.projects[0];
  const first = project.objective;
  const second = sm.createObjective(state, project.id, { title: "第二阶段", supersede: true });
  assert.equal(project.objective.id, second.id);
  assert.equal(project.objectives.filter((item) => item.status === "active").length, 1);
  assert.equal(project.objectives.find((item) => item.id === first.id).status, "superseded");
  sm.setObjectiveStatus(state, project.id, "completed");
  assert.equal(project.objective.status, "completed");
});
