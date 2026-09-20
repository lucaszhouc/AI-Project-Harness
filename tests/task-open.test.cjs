const test = require("node:test");
const assert = require("node:assert/strict");
const { createTaskOpenHandler, createProjectOpenHandler } = require("../electron/task-open.cjs");

function fixture({ status = "completed", processId, threadId = "thread-1", agent = "codex" } = {}) {
  return {
    state: {
      projects: [{
        id: "project-1",
        name: "Demo",
        path: "C:\\work\\demo",
        tasks: [{
          id: "task-1",
          title: "Demo task",
          agent,
          status: status === "completed" ? "accepted" : "in_progress",
          run: threadId ? { status, externalThreadId: threadId, processId } : undefined,
        }],
      }],
    },
  };
}

test("task opener cleans a terminal app-server before opening the exact thread", async () => {
  const store = fixture({ processId: 4312 });
  const calls = [];
  const opened = [];
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) {
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) throw new Error("Project not found");
        return project;
      },
      setExternalDesktopOpened(state, projectId, taskId, value) {
        const task = this.getProject(state, projectId).tasks.find((item) => item.id === taskId);
        task.run.desktopOpened = value;
      },
    },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    isProcessAlive: (pid) => pid === 4312,
    terminateProcessTree: async (pid) => { calls.push(pid); return { terminated: true }; },
    openDesktop: async (_executable, projectPath, options) => {
      opened.push({ projectPath, options });
      return { opened: true, capability: "thread-deep-link", uri: "codex://threads/thread-1" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
    openExternal: async () => {},
  });

  const result = await handler("project-1", "task-1");
  assert.deepEqual(calls, [4312]);
  assert.equal(store.state.projects[0].tasks[0].run.processId, undefined);
  assert.equal(opened[0].options.threadId, "thread-1");
  assert.equal(opened[0].options.preferProjectPath, false);
  assert.equal(result.opened, true);
  assert.deepEqual(result.snapshot, { marker: "snapshot" });
});

test("task opener keeps a running thread on the project entry instead of claiming exact navigation", async () => {
  const store = fixture({ status: "running", processId: 4312 });
  const opened = [];
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    isProcessAlive: () => true,
    terminateProcessTree: async () => ({ terminated: false }),
    openDesktop: async (_executable, _projectPath, options) => { opened.push(options); return { opened: true, capability: "project-path-fallback" }; },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });

  const result = await handler("project-1", "task-1");
  assert.equal(opened[0].preferProjectPath, true);
  assert.match(result.message, /仍在执行/);
});

test("project opener gives legacy tasks a usable Codex project entry", async () => {
  const store = fixture({ threadId: "" });
  const opened = [];
  const handler = createProjectOpenHandler({
    store,
    machine: { getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); } },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    openDesktop: async (_executable, projectPath, options) => {
      opened.push({ projectPath, options });
      return { opened: true, capability: "project-path-fallback" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });
  const result = await handler("project-1");
  assert.equal(opened[0].projectPath, "C:\\work\\demo");
  assert.equal(opened[0].options.preferProjectPath, true);
  assert.match(result.message, /项目/);
});

test("task opener can use the Desktop deep link even when the Codex CLI is not on PATH", async () => {
  const store = fixture({ processId: undefined });
  let options;
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: false, path: "" }),
    isProcessAlive: () => false,
    openDesktop: async (executable, _projectPath, input) => {
      options = { executable, ...input };
      return { opened: true, capability: "thread-deep-link", uri: "codex://threads/thread-1" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });
  const result = await handler("project-1", "task-1");
  assert.equal(options.executable, "");
  assert.equal(options.threadId, "thread-1");
  assert.equal(result.opened, true);
});

test("task opener does not claim exact navigation when a terminal process cannot be released", async () => {
  const store = fixture({ processId: 4312 });
  let options;
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    isProcessAlive: () => true,
    terminateProcessTree: async () => ({ terminated: false, error: "access denied" }),
    openDesktop: async (_executable, _projectPath, input) => {
      options = input;
      return { opened: true, capability: "project-path-fallback" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });
  const result = await handler("project-1", "task-1");
  assert.equal(options.preferProjectPath, true);
  assert.match(result.message, /未能精确跳转/);
});

test("task opener recovers the newest persistent Codex thread for a legacy task", async () => {
  const store = fixture({ threadId: "" });
  const opened = [];
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    listThreads: async () => [
      { id: "old-thread", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 1 },
      { id: "latest-thread", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 2 },
      { id: "other-project", cwd: "C:\\work\\other", ephemeral: false, recencyAt: 99 },
    ],
    openDesktop: async (_executable, _projectPath, options) => {
      opened.push(options);
      return { opened: true, capability: "thread-deep-link", uri: "codex://threads/latest-thread" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });

  const result = await handler("project-1", "task-1");
  assert.equal(opened[0].threadId, "latest-thread");
  assert.equal(result.threadId, "latest-thread");
  assert.match(result.message, /最近的 Codex 对话/);
});

test("project opener prefers the newest project thread and falls back to the project path", async () => {
  const store = fixture({ threadId: "" });
  const opened = [];
  const handler = createProjectOpenHandler({
    store,
    machine: { getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); } },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    listThreads: async () => [{ id: "project-thread", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 10 }],
    openDesktop: async (_executable, _projectPath, options) => {
      opened.push(options);
      return { opened: true, capability: "thread-deep-link", uri: "codex://threads/project-thread" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });

  const result = await handler("project-1");
  assert.equal(opened[0].threadId, "project-thread");
  assert.equal(opened[0].preferProjectPath, false);
  assert.equal(result.threadId, "project-thread");
  assert.match(result.message, /最近的 Codex 对话/);
});

test("project opener uses a persisted thread when the Codex CLI is not on PATH", async () => {
  const store = fixture({ threadId: "persisted-thread" });
  const opened = [];
  const handler = createProjectOpenHandler({
    store,
    machine: { getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); } },
    detectCodex: async () => ({ installed: false, path: "" }),
    openDesktop: async (executable, projectPath, options) => {
      opened.push({ executable, projectPath, options });
      return { opened: true, capability: "thread-deep-link", uri: "codex://threads/persisted-thread" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
    openExternal: async () => {},
  });
  const result = await handler("project-1");
  assert.equal(opened[0].executable, "");
  assert.equal(opened[0].options.threadId, "persisted-thread");
  assert.equal(opened[0].options.preferProjectPath, false);
  assert.equal(result.opened, true);
});

test("project opener returns a structured unavailable result without a CLI or persisted thread", async () => {
  const store = fixture({ threadId: "" });
  let opened = false;
  const handler = createProjectOpenHandler({
    store,
    machine: { getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); } },
    detectCodex: async () => ({ installed: false, path: "" }),
    openDesktop: async () => { opened = true; return { opened: true }; },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });
  const result = await handler("project-1");
  assert.equal(opened, false);
  assert.equal(result.supported, false);
  assert.equal(result.capability, "codex-unavailable");
  assert.match(result.message, /没有可恢复/);
});

test("project opener keeps an active thread on the safe project entry", async () => {
  const store = fixture({ threadId: "" });
  const opened = [];
  const handler = createProjectOpenHandler({
    store,
    machine: { getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); } },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    listThreads: async () => [{ id: "active-thread", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 10 }],
    isThreadActive: (threadId) => threadId === "active-thread",
    openDesktop: async (_executable, _projectPath, options) => {
      opened.push(options);
      return { opened: true, capability: "project-path-fallback" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });

  const result = await handler("project-1");
  assert.equal(opened[0].threadId, "active-thread");
  assert.equal(opened[0].preferProjectPath, true);
  assert.match(result.message, /项目目录/);
});

test("legacy task reports a precise fallback reason when its recovered deep link fails", async () => {
  const store = fixture({ threadId: "" });
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    listThreads: async () => [{ id: "legacy-thread", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 1 }],
    openDesktop: async () => ({ opened: true, capability: "project-path-fallback", threadError: "protocol unavailable" }),
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });
  const result = await handler("project-1", "task-1");
  assert.match(result.message, /最近对话深链不可用/);
  assert.doesNotMatch(result.message, /仍在执行/);
});

test("legacy task keeps a recovered active thread on the safe project entry", async () => {
  const store = fixture({ threadId: "" });
  const opened = [];
  const handler = createTaskOpenHandler({
    store,
    machine: {
      getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: true, path: "codex.exe" }),
    listThreads: async () => [{ id: "active-thread", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 1 }],
    isThreadActive: (threadId) => threadId === "active-thread",
    openDesktop: async (_executable, _projectPath, options) => {
      opened.push(options);
      return { opened: true, capability: "project-path-fallback" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  });
  const result = await handler("project-1", "task-1");
  assert.equal(opened[0].threadId, "active-thread");
  assert.equal(opened[0].preferProjectPath, true);
  assert.match(result.message, /项目目录/);
});

test("Hermes task opener reports the user-invoked Skill path instead of probing Codex", async () => {
  const fixtureState = { projects: [{ id: "project-1", path: "C:\\work\\demo", tasks: [{ id: "task-1", agent: "hermes", status: "awaiting_result" }] }] };
  const result = await createTaskOpenHandler({
    store: { state: fixtureState },
    machine: { getProject(state, projectId) { return state.projects.find((item) => item.id === projectId); } },
    detectCodex: async () => { throw new Error("should not detect Codex"); },
    openDesktop: async () => { throw new Error("should not open Desktop"); },
    buildSnapshot: async () => ({ state: fixtureState }),
  })("project-1", "task-1");
  assert.equal(result.supported, false);
  assert.match(result.message, /Hermes/);
});
