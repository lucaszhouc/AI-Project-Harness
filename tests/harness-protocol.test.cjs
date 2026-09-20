const test = require("node:test");
const assert = require("node:assert/strict");
const machine = require("../electron/state-machine.cjs");
const protocol = require("../electron/harness-protocol.cjs");

test("protocol context is bounded and includes sections without raw transcript", () => {
  const state = machine.createInitialState("C:\\work\\protocol");
  const project = state.projects[0];
  project.tasks = [];
  machine.createSection(state, project.id, { name: "后端", kind: "reusable" });
  const context = protocol.buildProjectContext(project);
  assert.equal(context.project.id, project.id);
  assert.equal(context.sections.length, 2); // main + worker
  assert.equal("transcript" in context, false);
});

test("protocol context redacts credential-shaped strings while raw archive remains separate", () => {
  const state = machine.createInitialState("C:\\work\\redact");
  const project = state.projects[0];
  project.goal = `token ${"sk-or-"}v1-12345678901234567890`;
  const context = protocol.buildProjectContext(project);
  assert.doesNotMatch(context.project.goal, /sk-or-v1/);
  assert.match(context.project.goal, /已脱敏/);
});

test("protocol context bounds GitHub, Git and event payloads", () => {
  const state = machine.createInitialState("C:\\work\\protocol-bounds");
  const project = state.projects[0];
  project.tasks = [];
  project.gitSnapshot = {
    available: true,
    branch: "main",
    changes: Array.from({ length: 80 }, (_, index) => ({ code: "M", file: `x-${index}-` + "a".repeat(1200) })),
    commits: Array.from({ length: 40 }, (_, index) => ({ hash: String(index), shortHash: String(index), subject: "s".repeat(1200), author: "a", date: "2026-01-01" })),
    branches: Array.from({ length: 80 }, (_, index) => ({ name: `branch-${index}`, current: index === 0 })),
    tags: Array.from({ length: 80 }, (_, index) => `tag-${index}`),
    checkedAt: new Date().toISOString(),
  };
  project.githubSnapshot = {
    available: true,
    remote: { owner: "owner", name: "repo", nameWithOwner: "owner/repo", url: "https://github.com/owner/repo" },
    pullRequests: Array.from({ length: 40 }, (_, index) => ({ number: index, title: "p".repeat(1200), state: "OPEN", url: "https://github.com/owner/repo/pull/1" })),
    issues: Array.from({ length: 40 }, (_, index) => ({ number: index, title: "i".repeat(1200), state: "OPEN", url: "https://github.com/owner/repo/issues/1" })),
    gh: { available: true, authenticated: true },
  };
  project.events = Array.from({ length: 120 }, (_, index) => ({ id: String(index), type: "event", at: new Date().toISOString(), detail: "d".repeat(4000) }));
  const context = protocol.buildProjectContext(project, { maxEvents: 100 });
  assert.equal(context.git.changes.length, 20);
  assert.equal(context.git.commits.length, 10);
  assert.equal(context.git.branches.length, 50);
  assert.equal(context.github.pullRequests.length, 10);
  assert.equal(context.github.issues.length, 10);
  assert.equal(context.events.length, 100);
  assert.ok(context.events.every((item) => item.detail.length <= 1000));
  assert.ok(context.git.changes.every((item) => item.file.length <= 500));
});

test("protocol result enforces current Project HEAD and records decision proposals", () => {
  const state = machine.createInitialState("C:\\work\\protocol-result");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "协议任务" });
  machine.dispatchTask(state, project.id, task.id);
  assert.throws(() => protocol.applyHarnessResult(state, project.id, task.id, { baseRevision: 99, summary: "过期" }), /STALE_RESULT/);
  const result = protocol.applyHarnessResult(state, project.id, task.id, { baseRevision: project.revision, runId: task.run.id, summary: "已完成", acceptance: [] });
  assert.equal(result.status, "review");
  assert.equal(result.run.resultSource, "manual");
  const decision = protocol.applyDecisionProposal(state, project.id, { title: "保留本地优先" });
  assert.equal(project.decisions[0].id, decision.id);
});
