const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("preload exposes project-name onboarding through the dedicated IPC channel", async () => {
  const preloadPath = path.join(__dirname, "..", "electron", "preload.cjs");
  const source = fs.readFileSync(preloadPath, "utf8");
  const invocations = [];
  let exposed;
  const context = {
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, "harness");
            exposed = api;
          },
        },
        ipcRenderer: {
          invoke(...args) {
            invocations.push(args);
            return Promise.resolve({ ok: true });
          },
        },
      };
    },
  };

  vm.runInNewContext(source, context, { filename: preloadPath });
  assert.equal(typeof exposed.addProjectByName, "function");
  assert.equal(exposed.addProject, undefined);
  await exposed.addProjectByName("AI-Project-Harness");
  assert.deepEqual(invocations.at(-1), ["project:add-by-name", "AI-Project-Harness"]);
  await exposed.createBlankProject({ name: "空白" });
  assert.deepEqual(invocations.at(-1), ["project:create-blank", { name: "空白" }]);
  await exposed.createConnectedProject({ name: "连接项目" });
  assert.deepEqual(invocations.at(-1), ["project:create-connected", { name: "连接项目" }]);
  await exposed.importCodexProject({ codexProjectId: "codex-42", name: "远端" });
  assert.deepEqual(invocations.at(-1), ["project:import-codex", { codexProjectId: "codex-42", name: "远端" }]);
  await exposed.guideProbe("codex-cli");
  assert.deepEqual(invocations.at(-1), ["guide:probe", "codex-cli"]);
  await exposed.guideCancelProbe("codex-cli");
  assert.deepEqual(invocations.at(-1), ["guide:cancel-probe", "codex-cli"]);
  await exposed.guideUpdate({ dismissed: true });
  assert.deepEqual(invocations.at(-1), ["guide:update", { dismissed: true }]);
  await exposed.connectCodexProject("project-1", { operationId: "op-1" });
  assert.deepEqual(invocations.at(-1), ["project:connect-codex", "project-1", { operationId: "op-1" }]);
  await exposed.showErrorLog();
  assert.deepEqual(invocations.at(-1), ["diagnostics:show-error-log"]);
  await exposed.reportRendererError({ message: "render failed", stack: "stack", stage: "boot" });
  assert.deepEqual(invocations.at(-1), [
    "diagnostics:report-renderer-error",
    { message: "render failed", stack: "stack", stage: "boot" },
  ]);
});

test("preload exposes a removable onboarding-progress subscription", () => {
  const preloadPath = path.join(__dirname, "..", "electron", "preload.cjs");
  const source = fs.readFileSync(preloadPath, "utf8");
  const listeners = new Map();
  let exposed;
  const ipcRenderer = {
    invoke() { return Promise.resolve(); },
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  const context = {
    require() {
      return {
        contextBridge: { exposeInMainWorld(_name, api) { exposed = api; } },
        ipcRenderer,
      };
    },
  };

  vm.runInNewContext(source, context, { filename: preloadPath });
  const received = [];
  const unsubscribe = exposed.onProjectOnboardingProgress((progress) => received.push(progress));
  listeners.get("project:onboarding-progress")({}, { stage: "checking_git", progress: 46 });

  assert.deepEqual(received, [{ stage: "checking_git", progress: 46 }]);
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
  assert.equal(listeners.has("project:onboarding-progress"), false);
});

test("preload exposes removable Agent runtime updates and conversation opening", async () => {
  const preloadPath = path.join(__dirname, "..", "electron", "preload.cjs");
  const listeners = new Map();
  const invocations = [];
  let exposed;
  const ipcRenderer = {
    invoke(...args) { invocations.push(args); return Promise.resolve({}); },
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) { if (listeners.get(channel) === listener) listeners.delete(channel); },
  };
  vm.runInNewContext(fs.readFileSync(preloadPath, "utf8"), {
    require() { return { contextBridge: { exposeInMainWorld(_name, api) { exposed = api; } }, ipcRenderer }; },
  }, { filename: preloadPath });
  const updates = [];
  const unsubscribe = exposed.onAgentRuntimeUpdate((update) => updates.push(update));
  listeners.get("agent:runtime-update")({}, { snapshot: { state: {} }, event: { type: "item/completed" } });
  assert.equal(updates.length, 1);
  unsubscribe();
  assert.equal(listeners.has("agent:runtime-update"), false);
  await exposed.openAgentTask("project-1", "task-1");
  assert.deepEqual(invocations.at(-1), ["task:open-agent", "project-1", "task-1"]);
  await exposed.openCodexProject("project-1");
  assert.deepEqual(invocations.at(-1), ["project:open-codex", "project-1"]);
  await exposed.openCto("project-1");
  assert.deepEqual(invocations.at(-1), ["project:open-cto", "project-1"]);
  await exposed.refreshGitHub("project-1");
  assert.deepEqual(invocations.at(-1), ["github:refresh", "project-1"]);
  await exposed.createSection("project-1", { name: "前端" });
  assert.deepEqual(invocations.at(-1), ["section:create", "project-1", { name: "前端" }]);
  await exposed.assignTaskToSection("project-1", "task-1", "section-1");
  assert.deepEqual(invocations.at(-1), ["section:assign-task", "project-1", "task-1", "section-1"]);
  await exposed.createTask("project-1", { title: "依赖任务", dependsOn: ["task-0"] });
  assert.deepEqual(invocations.at(-1), ["task:create", "project-1", { title: "依赖任务", dependsOn: ["task-0"] }]);
  await exposed.openLedger("project-1");
  assert.deepEqual(invocations.at(-1), ["project:open-ledger", "project-1"]);
});

test("preload exposes removable archive progress subscription", () => {
  const preloadPath = path.join(__dirname, "..", "electron", "preload.cjs");
  const listeners = new Map();
  let exposed;
  const ipcRenderer = {
    invoke() { return Promise.resolve(); },
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) { if (listeners.get(channel) === listener) listeners.delete(channel); },
  };
  vm.runInNewContext(fs.readFileSync(preloadPath, "utf8"), { require() { return { contextBridge: { exposeInMainWorld(_name, api) { exposed = api; } }, ipcRenderer }; } }, { filename: preloadPath });
  const received = [];
  const unsubscribe = exposed.onArchiveProgress((value) => received.push(value));
  listeners.get("archive:progress")({}, { bytes: 10 });
  assert.deepEqual(received, [{ bytes: 10 }]);
  unsubscribe();
  assert.equal(listeners.has("archive:progress"), false);
});
