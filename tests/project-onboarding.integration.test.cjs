const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { HarnessStore } = require("../electron/store.cjs");
const { launchHarnessTask } = require("../electron/codex-adapter.cjs");
const { createProjectOnboarding } = require("../electron/project-onboarding.cjs");
const { resolveAppServerCwd, resolveBundledSkillPath } = require("../electron/runtime-paths.cjs");

class FakeCodexClient {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.requests = [];
    FakeCodexClient.instances.push(this);
  }

  async start() {}

  async request(method, params) {
    this.requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-local-chat" } };
    if (method === "turn/start") return { turn: { id: "turn-local-chat" } };
    return {};
  }

  close() {}
}

function makeFixture({ withLocalChat = true, withSkill = true, ensureProjectFolder, launchTaskOverride } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-onboarding-"));
  const selfProject = path.join(root, "harness-source");
  const recentProject = path.join(root, "my-workflow");
  const localChat = path.join(recentProject, "iva-local-chat");
  const resourcesPath = path.join(root, "packaged", "resources");
  const appPath = path.join(resourcesPath, "app.asar");
  const appServerCwd = resolveAppServerCwd({ isPackaged: true, resourcesPath, appPath });
  const skillPath = resolveBundledSkillPath({ isPackaged: true, resourcesPath, appPath });

  fs.mkdirSync(selfProject, { recursive: true });
  fs.mkdirSync(recentProject, { recursive: true });
  fs.mkdirSync(resourcesPath, { recursive: true });
  fs.writeFileSync(appPath, "asar fixture");
  if (withLocalChat) {
    fs.mkdirSync(localChat, { recursive: true });
    execFileSync("git", ["init", "-b", "main", localChat], { stdio: "ignore" });
  }
  if (withSkill) {
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# AI Project Harness fixture skill\n");
  }

  const statePath = path.join(root, "user-data", "harness-state.json");
  const store = new HarnessStore(statePath, selfProject);
  const observed = { recentCwd: null, launched: null };
  const service = createProjectOnboarding({
    store,
    getCodex: async () => ({ installed: true, path: "C:\\Codex\\codex.exe" }),
    appServerCwd,
    skillPath,
    listRecentCwds: async ({ cwd }) => {
      observed.recentCwd = cwd;
      return [recentProject];
    },
    resolveProjectOptions: { envValue: root, scanEnvValue: "", defaultScanRoots: [] },
    ...(ensureProjectFolder ? { ensureProjectFolder } : {}),
    launchTask: launchTaskOverride || ((input) => launchHarnessTask({
      ...input,
      Client: FakeCodexClient,
      run: async () => ({ stdout: "" }),
    })),
    buildSnapshot: async () => ({ state: store.state }),
    onLaunched: (launched) => { observed.launched = launched; },
  });

  return {
    root,
    store,
    statePath,
    service,
    observed,
    localChat,
    resourcesPath,
    appServerCwd,
    skillPath,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
      FakeCodexClient.instances = [];
    },
  };
}

test("project onboarding prefers the exact Codex thread deep link", async () => {
  let launchInput;
  const fixture = makeFixture({
    ensureProjectFolder: async () => ({ projectId: "codex-project-1" }),
    launchTaskOverride: async (input) => {
      launchInput = input;
      return {
        client: { on() {}, close() {} },
        threadId: "thread-deep-link",
        turnId: "turn-deep-link",
        projectId: "codex-project-1",
        desktop: { opened: true },
      };
    },
  });
  try {
    await fixture.service("Local Chat");
    assert.equal(launchInput.preferProjectPath, false);
  } finally {
    fixture.cleanup();
  }
});

test("packaged Local Chat onboarding resolves Git, injects the external skill, creates a thread, and persists it", async () => {
  const fixture = makeFixture();
  try {
    const progress = [];
    const result = await fixture.service("Local Chat", { onProgress: (event) => progress.push(event) });
    const client = FakeCodexClient.instances.at(-1);
    const turn = client.requests.find((request) => request.method === "turn/start");
    const persisted = JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
    const project = persisted.projects.find((item) => item.path === fixture.localChat);
    assert.ok(project.profile, "onboarding should persist a bounded project profile");
    const task = project.tasks.find((item) => item.run?.externalThreadId === "thread-local-chat");

    assert.equal(result.matchedProjectName, "iva-local-chat");
    assert.equal(result.threadId, "thread-local-chat");
    assert.equal(fixture.observed.recentCwd, fixture.resourcesPath);
    assert.equal(client.options.cwd, fixture.localChat);
    assert.deepEqual(turn.params.input[0], {
      type: "skill",
      name: "ai-project-harness",
      path: fixture.skillPath,
    });
    assert.equal(task.run.externalTurnId, "turn-local-chat");
    assert.equal(task.run.externalProjectId, undefined);
    assert.equal(task.run.desktopOpened, true);
    assert.equal(result.desktopProjectRestartRequired, false);
    assert.equal(fixture.observed.launched.threadId, "thread-local-chat");
    assert.deepEqual(progress.map((event) => event.stage), [
      "detecting_codex",
      "discovering_project",
      "checking_git",
      "checking_skill",
      "creating_thread",
      "saving_state",
      "completed",
    ]);
    assert.equal(progress.at(-1).progress, 100);
    assert.equal(progress.at(-1).label, "准备好了");
  } finally {
    fixture.cleanup();
  }
});

test("project onboarding passes the official Codex Project id into its task thread", async () => {
  const fixture = makeFixture({ ensureProjectFolder: async () => ({ projectId: "codex-project-1" }) });
  try {
    const result = await fixture.service("Local Chat");
    const client = FakeCodexClient.instances.at(-1);
    assert.equal(client.requests.find((request) => request.method === "thread/start").params.projectId, "codex-project-1");
    const project = fixture.store.state.projects.find((item) => item.path === fixture.localChat);
    const task = project.tasks.find((item) => item.run?.externalThreadId === "thread-local-chat");
    assert.equal(task.run.externalProjectId, "codex-project-1");
    assert.equal(result.desktopProjectRestartRequired, true);
    assert.match(result.desktopProjectWarning, /彻底退出 Codex Desktop/);
  } finally {
    fixture.cleanup();
  }
});

test("Codex unavailable fails before changing project state", async () => {
  const fixture = makeFixture();
  try {
    const before = fs.readFileSync(fixture.statePath, "utf8");
    const service = createProjectOnboarding({
      store: fixture.store,
      getCodex: async () => ({ installed: false, path: "" }),
      appServerCwd: fixture.appServerCwd,
      skillPath: fixture.skillPath,
      buildSnapshot: async () => ({ state: fixture.store.state }),
    });

    await assert.rejects(service("Local Chat"), /未检测到 Codex/);
    assert.equal(fs.readFileSync(fixture.statePath, "utf8"), before);
  } finally {
    fixture.cleanup();
  }
});

test("unknown project fails without creating a phantom project", async () => {
  const fixture = makeFixture({ withLocalChat: false });
  try {
    const beforeCount = fixture.store.state.projects.length;
    await assert.rejects(fixture.service("Missing Galaxy"), /未能可靠定位|未找到项目/);
    assert.equal(fixture.store.state.projects.length, beforeCount);
  } finally {
    fixture.cleanup();
  }
});

test("missing packaged skill fails before creating onboarding state", async () => {
  const fixture = makeFixture({ withSkill: false });
  try {
    const beforeCount = fixture.store.state.projects.length;
    await assert.rejects(fixture.service("Local Chat"), /Harness 内置 Codex Skill 缺失/);
    assert.equal(fixture.store.state.projects.length, beforeCount);
  } finally {
    fixture.cleanup();
  }
});

test("app-server failure is persisted as a retryable onboarding task instead of success", async () => {
  const fixture = makeFixture();
  try {
    const service = createProjectOnboarding({
      store: fixture.store,
      getCodex: async () => ({ installed: true, path: "C:\\Codex\\codex.exe" }),
      appServerCwd: fixture.appServerCwd,
      skillPath: fixture.skillPath,
      listRecentCwds: async () => [path.dirname(fixture.localChat)],
      resolveProjectOptions: { envValue: fixture.root, scanEnvValue: "", defaultScanRoots: [] },
      launchTask: async () => { throw new Error("initialize timed out"); },
      buildSnapshot: async () => ({ state: fixture.store.state }),
    });

    await assert.rejects(service("Local Chat"), /initialize timed out/);
    const project = fixture.store.state.projects.find((item) => item.path === fixture.localChat);
    const task = project.tasks.find((item) => item.workstream === "project-onboarding");
    assert.equal(task.status, "ready");
    assert.equal(task.run, undefined);
    assert.equal(task.launchError, "initialize timed out");
  } finally {
    fixture.cleanup();
  }
});

test("desktop-open failure keeps the created Codex thread and returns a persistent warning", async () => {
  const fixture = makeFixture();
  try {
    const service = createProjectOnboarding({
      store: fixture.store,
      getCodex: async () => ({ installed: true, path: "C:\\Codex\\codex.cmd" }),
      appServerCwd: fixture.appServerCwd,
      skillPath: fixture.skillPath,
      listRecentCwds: async () => [path.dirname(fixture.localChat)],
      resolveProjectOptions: { envValue: fixture.root, scanEnvValue: "", defaultScanRoots: [] },
      launchTask: async () => ({
        client: { on() {}, close() {} },
        threadId: "thread-desktop-warning",
        turnId: "turn-desktop-warning",
        desktop: { opened: false, error: "codex app exited (1)" },
      }),
      buildSnapshot: async () => ({ state: fixture.store.state }),
    });

    const result = await service("Local Chat");
    const project = fixture.store.state.projects.find((item) => item.path === fixture.localChat);
    const task = project.tasks.find((item) => item.run?.externalThreadId === "thread-desktop-warning");
    assert.equal(result.desktopOpened, false);
    assert.equal(result.desktopError, "codex app exited (1)");
    assert.equal(task.status, "in_progress");
    assert.equal(task.run.externalThreadId, "thread-desktop-warning");
  } finally {
    fixture.cleanup();
  }
});

test("retrying a desktop-open warning updates the persisted run after recovery", async () => {
  const fixture = makeFixture();
  let launchCount = 0;
  try {
    const service = createProjectOnboarding({
      store: fixture.store,
      getCodex: async () => ({ installed: true, path: "C:\\Codex\\codex.cmd" }),
      appServerCwd: fixture.appServerCwd,
      skillPath: fixture.skillPath,
      listRecentCwds: async () => [path.dirname(fixture.localChat)],
      resolveProjectOptions: { envValue: fixture.root, scanEnvValue: "", defaultScanRoots: [] },
      launchTask: async () => {
        launchCount += 1;
        return {
          client: { on() {}, close() {} },
          threadId: "thread-desktop-recovery",
          turnId: "turn-desktop-recovery",
          desktop: { opened: false, error: "codex app exited (1)" },
        };
      },
      openDesktop: async () => ({ opened: true }),
      buildSnapshot: async () => ({ state: fixture.store.state }),
    });

    const first = await service("Local Chat");
    assert.equal(first.desktopOpened, false);

    const recovered = await service("Local Chat");
    const project = fixture.store.state.projects.find((item) => item.path === fixture.localChat);
    const task = project.tasks.find((item) => item.run?.externalThreadId === "thread-desktop-recovery");
    assert.equal(recovered.reused, true);
    assert.equal(recovered.desktopOpened, true);
    assert.equal(task.run.desktopOpened, true);
    assert.equal(launchCount, 1);
  } finally {
    fixture.cleanup();
  }
});
