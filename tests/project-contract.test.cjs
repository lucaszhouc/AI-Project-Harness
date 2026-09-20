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

test("archiving blocks active runs and restore returns project to selected active state", () => {
  const state = sm.createInitialState("C:\\projects\\archive");
  const project = state.projects[0];
  project.tasks = [];
  const task = sm.createTask(state, project.id, { title: "进行中" });
  sm.dispatchTask(state, project.id, task.id);
  assert.throws(() => sm.archiveProject(state, project.id), /进行中的任务/);
  sm.markExternalLaunchFailed(state, project.id, task.id, "测试结束");
  sm.archiveProject(state, project.id, "阶段完成");
  assert.equal(project.status, "archived");
  sm.restoreProject(state, project.id);
  assert.equal(project.status, "active");
  assert.equal(state.selectedProjectId, project.id);
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
