const test = require("node:test");
const assert = require("node:assert/strict");
const machine = require("../electron/state-machine.cjs");
const { parseHarnessResult, createAgentRunMonitor } = require("../electron/agent-run-monitor.cjs");

const resultText = (summary = "已完成") => [
  "检查完成。",
  "```harness-result",
  JSON.stringify({
    summary,
    completed: ["扫描仓库"],
    remaining: [],
    nextStep: "等待审核",
    acceptance: [{ criterion: "可验证", status: "pass" }],
    evidence: [{ type: "test", value: "npm test" }],
  }),
  "```",
].join("\n");

test("harness-result parser extracts and validates one fenced result", () => {
  const parsed = parseHarnessResult(resultText("自动回写"));
  assert.equal(parsed.summary, "自动回写");
  assert.deepEqual(parsed.completed, ["扫描仓库"]);
  assert.equal(parseHarnessResult("没有结构化结果"), null);
});

test("agent monitor moves a completed turn out of real execution and refreshes Git", async () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const task = machine.createTask(state, project.id, { title: "监控运行态" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, {
    threadId: "thread-monitor",
    turnId: "turn-monitor",
    desktopOpened: true,
    processId: 4312,
  });
  const snapshots = [];
  const monitor = createAgentRunMonitor({
    state,
    projectId: project.id,
    taskId: task.id,
    readGit: async () => ({ available: true, branch: "main", dirty: true, changeCount: 1, changes: [{ code: " M", file: "src/main.ts" }], commits: [], checkedAt: new Date().toISOString() }),
    onUpdate: (update) => snapshots.push(update),
  });

  await monitor.handleNotification({
    method: "item/completed",
    params: { threadId: "thread-monitor", turnId: "turn-monitor", item: { type: "agentMessage", text: resultText() } },
  });
  await monitor.handleNotification({
    method: "turn/completed",
    params: { threadId: "thread-monitor", turnId: "turn-monitor", turn: { status: "completed" } },
  });

  assert.equal(task.status, "review");
  assert.equal(task.run.status, "completed");
  assert.equal(task.run.progress, 100);
  assert.equal(task.run.externalThreadId, "thread-monitor");
  assert.equal(project.gitSnapshot.branch, "main");
  assert.ok(snapshots.length >= 2);
});

test("agent monitor forwards raw notifications to a lossless archive sink", async () => {
  const state = machine.createInitialState("C:\\work\\raw-archive");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "raw" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, { threadId: "raw-thread" });
  const raw = [];
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, onRawMessage: async (message) => raw.push(message) });
  await monitor.handleNotification({ method: "item/started", params: { threadId: "raw-thread", item: { type: "commandExecution", text: "large output on disk" } } });
  assert.equal(raw.length, 1);
  assert.equal(raw[0].method, "item/started");
});

test("agent monitor marks failed turns and never leaves a stale in-progress task", async () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const task = machine.createTask(state, project.id, { title: "失败运行态" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, { threadId: "thread-failed", turnId: "turn-failed", desktopOpened: true });
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, readGit: async () => ({ available: false, error: "not a repo", checkedAt: new Date().toISOString() }) });
  await monitor.handleNotification({ method: "turn/completed", params: { threadId: "thread-failed", turnId: "turn-failed", turn: { status: "failed", error: { message: "编译失败" } } } });
  assert.equal(task.status, "failed");
  assert.equal(task.run.status, "failed");
  assert.equal(task.run.error, "编译失败");
});

test("auto-review waits for bound terminal completion and advances only once", async () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const task = machine.createTask(state, project.id, { title: "自动审核后结束", criteria: "可验证" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, { threadId: "thread-late", turnId: "turn-late" });
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, autoReview: true });
  await monitor.handleNotification({
    method: "item/completed",
    params: { threadId: "thread-late", turnId: "turn-late", item: { type: "agentMessage", text: resultText("自动通过") } },
  });
  assert.equal(task.status, "in_progress");
  await monitor.handleNotification({ method: "turn/completed", params: { threadId: "thread-late", turnId: "turn-late", turn: { status: "completed" } } });
  assert.equal(task.status, "accepted");
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  assert.equal(task.run.status, "completed");
  assert.equal(session.status, "warm");
});

test("terminal completion does not wait for a slow Git evidence refresh", async () => {
  const state = machine.createInitialState("C:\\fixture\\slow-git");
  const project = state.projects[0];
  project.tasks = [];
  const task = machine.createTask(state, project.id, { title: "终态不等 Git" });
  machine.dispatchTask(state, project.id, task.id);
  machine.attachExternalThread(state, project.id, task.id, { threadId: "slow-git-thread", turnId: "slow-git-turn" });
  let releaseGit;
  const gitBlocked = new Promise((resolve) => { releaseGit = resolve; });
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: task.id, readGit: () => gitBlocked });
  const completion = monitor.handleNotification({
    method: "turn/completed",
    params: { threadId: "slow-git-thread", turnId: "slow-git-turn", turn: { status: "completed" } },
  });
  const outcome = await Promise.race([
    completion.then(() => "completed"),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
  ]);
  releaseGit({ available: false, checkedAt: new Date().toISOString() });
  await completion;
  assert.equal(outcome, "completed");
  assert.equal(task.run.status, "completed");
});

test("repeated output is not resubmitted through a stale task reference after state reload", async () => {
  const state = machine.createInitialState("C:\\fixture\\stale-monitor-task");
  const project = state.projects[0];
  project.tasks = [];
  const staleTask = machine.createTask(state, project.id, { title: "候选只提交一次", criteria: "可验证" });
  machine.dispatchTask(state, project.id, staleTask.id);
  machine.attachExternalThread(state, project.id, staleTask.id, { threadId: "stale-thread", turnId: "stale-turn" });
  const monitor = createAgentRunMonitor({ state, projectId: project.id, taskId: staleTask.id, autoReview: true });
  await monitor.handleNotification({
    method: "item/completed",
    params: { threadId: "stale-thread", turnId: "stale-turn", item: { type: "agentMessage", text: resultText("一次候选") } },
  });
  assert.equal(staleTask.status, "in_progress");
  const durableTask = structuredClone(staleTask);
  project.tasks[0] = durableTask;
  await assert.doesNotReject(() => monitor.handleNotification({
    method: "turn/completed",
    params: { threadId: "stale-thread", turnId: "stale-turn", turn: { status: "completed", output: resultText("一次候选") } },
  }));
  assert.equal(durableTask.status, "accepted");
  assert.equal(durableTask.run.status, "completed");
});
