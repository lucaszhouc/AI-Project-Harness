const test = require("node:test");
const assert = require("node:assert/strict");
const { createTaskOpenHandler, createProjectOpenHandler } = require("../electron/task-open.cjs");

function fixture() {
  return {
    state: {
      projects: [{
        id: "project-1",
        name: "Demo",
        path: "C:\\work\\demo",
        tasks: [{ id: "task-1", title: "Demo task", agent: "codex", status: "in_progress", run: { externalThreadId: "thread-1" } }],
      }],
    },
  };
}

test("task opener forwards a native Desktop thread deep link", async () => {
  const store = fixture();
  const opened = [];
  const result = await createTaskOpenHandler({
    store,
    machine: {
      getProject(state, id) { return state.projects.find((item) => item.id === id); },
      setExternalDesktopOpened() {},
    },
    detectCodex: async () => ({ installed: true, native: true, path: "" }),
    openDesktop: async (executable, projectPath, options) => {
      opened.push({ executable, projectPath, options });
      return { opened: true, capability: "thread-deep-link", uri: "codex://threads/thread-1" };
    },
    buildSnapshot: async () => ({ marker: "snapshot" }),
    openExternal: async () => {},
  })("project-1", "task-1");
  assert.equal(opened[0].executable, "");
  assert.equal(opened[0].options.threadId, "thread-1");
  assert.equal(result.capability, "thread-deep-link");
});

test("project opener uses the Desktop native project deep link", async () => {
  const store = fixture();
  let called = false;
  const result = await createProjectOpenHandler({
    store,
    machine: { getProject(state, id) { return state.projects.find((item) => item.id === id); } },
    detectCodex: async () => ({ installed: true, native: true, path: "" }),
    openDesktop: async () => { called = true; return { opened: true, capability: "desktop-native-new-thread-deep-link" }; },
    buildSnapshot: async () => ({ marker: "snapshot" }),
  })("project-1");
  assert.equal(called, true);
  assert.equal(result.supported, true);
});
