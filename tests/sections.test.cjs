const test = require("node:test");
const assert = require("node:assert/strict");
const sm = require("../electron/state-machine.cjs");

function state() { return sm.createInitialState("C:\\projects\\sections"); }

test("project gets a reusable main section and task can be assigned", () => {
  const s = state(); const p = s.projects[0];
  assert.equal(p.sections.length, 1);
  assert.equal(p.sections[0].kind, "main");
  const task = sm.createTask(s, p.id, { title: "section task" });
  const worker = sm.createSection(s, p.id, { title: "执行区", kind: "reusable" });
  sm.assignTaskToSection(s, p.id, task.id, worker.id);
  assert.equal(task.sectionId, worker.id);
  assert.deepEqual(worker.taskIds, [task.id]);
});

test("one-shot section closes when its reviewed task is accepted", () => {
  const s = state(); const p = s.projects[0];
  const section = sm.createSection(s, p.id, { title: "一次性修复", kind: "one-shot" });
  const task = sm.createTask(s, p.id, { title: "修复" });
  sm.assignTaskToSection(s, p.id, task.id, section.id);
  sm.dispatchTask(s, p.id, task.id);
  sm.submitTaskResult(s, p.id, task.id, { summary: "完成", acceptance: [{ status: "pass" }] });
  sm.acceptTaskResult(s, p.id, task.id);
  assert.equal(section.status, "closed");
  assert.equal(section.lastReview, "approved");
});

test("reusable section survives acceptance and close/archive are explicit", () => {
  const s = state(); const p = s.projects[0];
  const section = sm.createSection(s, p.id, { name: "持续迭代", kind: "reusable" });
  sm.closeSection(s, p.id, section.id, "阶段完成");
  assert.equal(section.status, "closed");
  sm.archiveSection(s, p.id, section.id);
  assert.equal(section.status, "archived");
});

test("reassignment removes task from the old section", () => {
  const s = state(); const p = s.projects[0];
  const a = sm.createSection(s, p.id, { name: "A", kind: "reusable" });
  const b = sm.createSection(s, p.id, { name: "B", kind: "reusable" });
  const task = sm.createTask(s, p.id, { title: "改派" });
  sm.assignTaskToSection(s, p.id, task.id, a.id);
  sm.assignTaskToSection(s, p.id, task.id, b.id);
  assert.equal(task.sectionId, b.id);
  assert.deepEqual(a.taskIds, []);
  assert.deepEqual(b.taskIds, [task.id]);
  assert.equal(p.events[0].type, "task.section.assigned");
});

test("active tasks cannot be reassigned or changed under an archived project", () => {
  const s = state(); const p = s.projects[0];
  p.tasks = [];
  const a = sm.createSection(s, p.id, { name: "运行区", kind: "reusable" });
  const b = sm.createSection(s, p.id, { name: "备用区", kind: "reusable" });
  const task = sm.createTask(s, p.id, { title: "锁定归属" });
  sm.assignTaskToSection(s, p.id, task.id, a.id);
  sm.dispatchTask(s, p.id, task.id);
  assert.throws(() => sm.assignTaskToSection(s, p.id, task.id, b.id), /运行中或待审核/);
  sm.stopTask(s, p.id, task.id);
  sm.archiveProject(s, p.id, "测试归档");
  assert.throws(() => sm.assignTaskToSection(s, p.id, task.id, b.id), /已归档项目/);
});

test("archived section name can be recreated without returning the stale section", () => {
  const s = state(); const p = s.projects[0];
  const first = sm.createSection(s, p.id, { name: "可重建", kind: "reusable" });
  sm.closeSection(s, p.id, first.id);
  sm.archiveSection(s, p.id, first.id);
  const recreated = sm.createSection(s, p.id, { name: "可重建", kind: "reusable" });
  assert.notEqual(recreated.id, first.id);
  assert.equal(recreated.status, "idle");
});

test("dispatch never silently reopens a closed Section", () => {
  const s = state(); const p = s.projects[0];
  p.tasks = [];
  const section = sm.createSection(s, p.id, { name: "已收束", kind: "one-shot" });
  const task = sm.createTask(s, p.id, { title: "再次运行" });
  sm.assignTaskToSection(s, p.id, task.id, section.id);
  sm.closeSection(s, p.id, section.id);
  assert.throws(() => sm.dispatchTask(s, p.id, task.id), /Section 已关闭/);
  assert.equal(section.status, "closed");
});

test("active section tasks prevent close and archive", () => {
  const s = state(); const p = s.projects[0];
  const section = sm.createSection(s, p.id, { name: "忙碌区", kind: "reusable" });
  const task = sm.createTask(s, p.id, { title: "进行中" });
  sm.assignTaskToSection(s, p.id, task.id, section.id);
  sm.dispatchTask(s, p.id, task.id);
  assert.throws(() => sm.closeSection(s, p.id, section.id), /进行中的任务/);
  assert.throws(() => sm.archiveSection(s, p.id, section.id), /进行中的任务/);
});
