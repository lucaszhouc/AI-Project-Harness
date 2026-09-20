const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter, once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PassThrough } = require("node:stream");
const { CodexAppServerClient, createCodexControlThread, ensureCodexProject, inspectCodexThread, launchHarnessTask, listAllCodexThreads, listCodexProjects, onboardingPrompt, taskPrompt, openCodexDesktop, registerCodexDesktopProject, projectIdempotencyKey, selectLatestCodexThread, terminateCodexProcessTree } = require("../electron/codex-adapter.cjs");
const { normalizeProjectName, resolveProjectByName } = require("../electron/project-discovery.cjs");

test("ordinary task prompt is not mislabeled as onboarding", () => {
  const text = taskPrompt({ id: "p", name: "Demo", path: "C:\\demo" }, { id: "t" }, "TASK: fix");
  assert.match(text, /MODE: TASK/);
  assert.doesNotMatch(text, /MODE: ONBOARDING/);
  assert.match(text, /harness-result/);
});

test("Codex project listing is read-only and returns official roots", async () => {
  class ProjectClient extends FakeClient {
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === "project/list") return { data: [{ id: "official-1", name: "Demo", roots: [{ path: "C:\\demo" }] }] };
      return {};
    }
  }
  const result = await listCodexProjects({ executable: "codex.exe", cwd: "C:\\demo", Client: ProjectClient });
  assert.equal(result[0].id, "official-1");
});

test("Codex project listing reports an actionable compatibility error", async () => {
  class LegacyProjectClient extends FakeClient {
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === "project/list") throw new Error("Invalid request: unknown variant `project/list`");
      return {};
    }
  }
  await assert.rejects(
    () => listCodexProjects({ executable: "codex.cmd", cwd: "C:\\demo", Client: LegacyProjectClient }),
    (error) => error.code === "CODEX_PROJECT_API_UNAVAILABLE" && /不能退回文件夹猜测/.test(error.message),
  );
});

test("Codex import thread discovery follows pagination and deduplicates ids", async () => {
  class PagedThreadClient extends FakeClient {
    async request(method, params) {
      this.requests.push({ method, params });
      if (method !== "thread/list") return {};
      if (!params.cursor) return { data: [{ id: "new" }, { id: "shared" }], nextCursor: "page-2" };
      return { data: [{ id: "shared" }, { id: "old" }], nextCursor: null };
    }
  }
  const rows = await listAllCodexThreads({ executable: "codex.exe", cwd: "C:\\demo", maxThreads: 10, pageSize: 2, Client: PagedThreadClient });
  assert.deepEqual(rows.map((row) => row.id), ["new", "shared", "old"]);
});

class FakeClient {
  constructor(options) {
    this.options = options;
    this.requests = [];
    this.started = false;
  }
  async start() { this.started = true; }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-harness-test" } };
    if (method === "turn/start") return { turn: { id: "turn-harness-test" } };
    return {};
  }
  close() {}
}

test("project name resolves from Codex recent working directories without a folder picker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-discovery-"));
  const projectPath = path.join(root, "named-project");
  fs.mkdirSync(projectPath);
  const result = resolveProjectByName({ name: "named-project", recentCwds: [projectPath] });
  assert.equal(result.path, projectPath);
  assert.equal(result.source, "codex");
  fs.rmSync(root, { recursive: true, force: true });
});

test("latest project thread selection ignores ephemeral and other-project conversations", () => {
  const result = selectLatestCodexThread([
    { id: "ephemeral", cwd: "C:\\work\\demo", ephemeral: true, recencyAt: 999 },
    { id: "other", cwd: "C:\\work\\other", ephemeral: false, recencyAt: 1000 },
    { id: "older", cwd: "C:\\work\\demo", ephemeral: false, recencyAt: 10 },
    { id: "newer", cwd: "\\\\?\\C:\\work\\demo\\", ephemeral: false, recencyAt: 20 },
  ], "C:\\work\\demo");
  assert.equal(result.id, "newer");
});

test("official Codex Project provisioning is idempotent by exact root", async () => {
  class ProjectClient {
    static calls = [];
    constructor() {}
    async start() {}
    async request(method, params) {
      ProjectClient.calls.push({ method, params });
      if (method === "project/list") return { data: [{ id: "existing-project", name: "Existing", roots: [{ path: "C:\\work\\demo" }] }] };
      throw new Error("project/create should not run for an existing root");
    }
    close() {}
  }
  const result = await ensureCodexProject({
    executable: "codex.exe",
    cwd: "C:\\work\\demo",
    projectPath: "C:\\work\\demo",
    projectName: "Demo",
    Client: ProjectClient,
  });
  assert.equal(result.projectId, "existing-project");
  assert.equal(result.created, false);
  assert.match(projectIdempotencyKey("C:\\work\\demo"), /^[0-9a-f-]{36}$/);
  assert.deepEqual(ProjectClient.calls.map((call) => call.method), ["project/list"]);
});

test("registerCodexDesktopProject opens only the URLSearchParams encoded new-project deep link", async () => {
  const opened = [];
  const result = await registerCodexDesktopProject({ projectPath: "C:\\work\\demo alpha", openExternal: async (uri) => opened.push(uri) });
  assert.equal(result.opened, true);
  assert.equal(result.uri, "codex://new?path=C%3A%5Cwork%5Cdemo+alpha");
  assert.deepEqual(opened, [result.uri]);
});

test("official Project provisioning chooses duplicate roots by position then newest timestamp", async () => {
  class DuplicateProjectClient {
    async start() {}
    async request(method) {
      if (method === "project/list") return { data: [
        { id: "position-2", position: 2, updatedAt: "2026-09-05T10:00:00Z", roots: [{ path: "C:\\work\\demo" }] },
        { id: "position-1-old", position: 1, updatedAt: "2026-09-01T10:00:00Z", roots: [{ path: "C:\\work\\demo" }] },
        { id: "position-1-new", position: 1, updatedAt: "2026-09-05T10:00:00Z", roots: [{ path: "C:\\work\\demo" }] },
      ] };
    }
    close() {}
  }
  const result = await ensureCodexProject({ executable: "codex.exe", cwd: "C:\\work\\demo", projectPath: "C:\\work\\demo", projectName: "Demo", Client: DuplicateProjectClient });
  assert.equal(result.projectId, "position-1-new");
});

test("official Project listing follows bounded pagination and deduplicates ids", async () => {
  class PagedProjectClient {
    static requests = [];
    async start() {}
    async request(method, params) {
      PagedProjectClient.requests.push({ method, params });
      if (!params.cursor) return { data: [{ id: "p1", roots: [] }], nextCursor: "next" };
      return { data: [{ id: "p1", roots: [] }, { id: "p2", roots: [] }], nextCursor: null };
    }
    close() {}
  }
  const projects = await listCodexProjects({ executable: "codex.exe", cwd: "C:\\work", Client: PagedProjectClient });
  assert.deepEqual(projects.map((project) => project.id), ["p1", "p2"]);
  assert.deepEqual(PagedProjectClient.requests.map((request) => request.params.cursor || null), [null, "next"]);
});

test("Project provisioning waits for a Desktop deep-link write before creating", async () => {
  class EventuallyVisibleProjectClient {
    static calls = [];
    constructor() { this.listCount = 0; }
    async start() {}
    async request(method, params) {
      EventuallyVisibleProjectClient.calls.push({ method, params });
      if (method === "project/list") {
        this.listCount += 1;
        return this.listCount === 1
          ? { data: [], nextCursor: null }
          : { data: [{ id: "desktop-project", position: 0, roots: [{ path: "C:\\work\\demo" }] }], nextCursor: null };
      }
      if (method === "project/create") throw new Error("project/create must not race Desktop");
      return {};
    }
    close() {}
  }
  const result = await ensureCodexProject({
    executable: "codex.exe",
    cwd: "C:\\work\\demo",
    projectPath: "C:\\work\\demo",
    projectName: "Demo",
    waitForExistingMs: 200,
    pollMs: 20,
    Client: EventuallyVisibleProjectClient,
  });
  assert.equal(result.projectId, "desktop-project");
  assert.equal(EventuallyVisibleProjectClient.calls.some((call) => call.method === "project/create"), false);
});

test("official Codex Project provisioning creates a real project with a stable idempotency key", async () => {
  class ProjectClient {
    static calls = [];
    constructor() {}
    async start() {}
    async request(method, params) {
      ProjectClient.calls.push({ method, params });
      if (method === "project/list") return { data: [] };
      if (method === "project/create") return { project: { id: "created-project", name: params.name, roots: params.roots } };
      throw new Error(`Unexpected method: ${method}`);
    }
    close() {}
  }
  const first = await ensureCodexProject({
    executable: "codex.exe",
    cwd: "C:\\work\\demo",
    projectPath: "C:\\work\\demo",
    projectName: "Demo",
    Client: ProjectClient,
  });
  const second = await ensureCodexProject({
    executable: "codex.exe",
    cwd: "C:\\work\\demo",
    projectPath: "C:\\work\\demo",
    projectName: "Demo",
    Client: ProjectClient,
  });
  assert.equal(first.projectId, "created-project");
  assert.equal(second.projectId, "created-project");
  const creates = ProjectClient.calls.filter((call) => call.method === "project/create");
  assert.equal(creates.length, 2);
  assert.equal(creates[0].params.idempotencyKey, creates[1].params.idempotencyKey);
  assert.deepEqual(creates[0].params.roots, [{ path: "C:\\work\\demo" }]);
});

test("invalid project/list response refuses to create a Project", async () => {
  class InvalidListClient {
    static calls = [];
    async start() {}
    async request(method, params) {
      InvalidListClient.calls.push({ method, params });
      if (method === "project/list") return { projects: [] };
      throw new Error("project/create must not run after malformed list");
    }
    close() {}
  }
  await assert.rejects(() => ensureCodexProject({
    executable: "codex.exe", cwd: "C:\\work\\demo", projectPath: "C:\\work\\demo", projectName: "Demo", Client: InvalidListClient,
  }), /invalid response/);
  assert.deepEqual(InvalidListClient.calls.map((call) => call.method), ["project/list"]);
});

test("invalid project/create roots are not persisted", async () => {
  class InvalidCreateClient {
    static calls = [];
    async start() {}
    async request(method, params) {
      InvalidCreateClient.calls.push({ method, params });
      if (method === "project/list") return { data: [] };
      if (method === "project/create") return { project: { id: "created-without-root", name: params.name, roots: [{ path: "C:\\other" }] } };
      return {};
    }
    close() {}
  }
  await assert.rejects(() => ensureCodexProject({
    executable: "codex.exe", cwd: "C:\\work\\demo", projectPath: "C:\\work\\demo", projectName: "Demo", Client: InvalidCreateClient,
  }), /invalid Project or root/);
  assert.deepEqual(InvalidCreateClient.calls.map((call) => call.method), ["project/list", "project/create"]);
});

test("project-name input rejects paths and ambiguous matches", () => {
  assert.throws(() => normalizeProjectName("C:\\work\\repo"), /不需要输入路径/);
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "aph-a-"));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "aph-b-"));
  fs.mkdirSync(path.join(rootA, "same-name"));
  fs.mkdirSync(path.join(rootB, "same-name"));
  assert.throws(() => resolveProjectByName({ name: "same-name", envValue: `${rootA}${path.delimiter}${rootB}` }), /多个同名项目/);
  fs.rmSync(rootA, { recursive: true, force: true });
  fs.rmSync(rootB, { recursive: true, force: true });
});

test("approximate project names resolve across typos, omitted separators, substrings, and acronyms", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-fuzzy-"));
  const expected = path.join(root, "AI-Project-Harness");
  fs.mkdirSync(expected);
  fs.mkdirSync(path.join(root, "AI-Project-Workshop"));
  fs.mkdirSync(path.join(root, "Account-Operations"));

  for (const query of ["AI Projec Harnes", "project harness", "aiprojectharness", "APH"]) {
    const result = resolveProjectByName({ name: query, envValue: root });
    assert.equal(result.path, expected, query);
    assert.equal(result.name, "AI-Project-Harness", query);
    assert.ok(result.match.score >= 0.7, `${query}: ${result.match.score}`);
  }

  fs.rmSync(root, { recursive: true, force: true });
});

test("approximate project matching supports Chinese names without requiring exact wording", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-fuzzy-zh-"));
  const expected = path.join(root, "聊天项目管理面板");
  fs.mkdirSync(expected);
  fs.mkdirSync(path.join(root, "聊天记录归档"));

  const result = resolveProjectByName({ name: "聊天项目面板", envValue: root });
  assert.equal(result.path, expected);
  assert.ok(result.match.score >= 0.7);

  fs.rmSync(root, { recursive: true, force: true });
});

test("fuzzy resolution is stable when candidate input order changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-fuzzy-order-"));
  const expected = path.join(root, "AI-Project-Harness");
  const nearby = path.join(root, "AI-Project-Harvester");
  const unrelated = path.join(root, "Account-Operations");
  for (const projectPath of [expected, nearby, unrelated]) fs.mkdirSync(projectPath);

  const forward = resolveProjectByName({ name: "ai projct harness", recentCwds: [expected, nearby, unrelated] });
  const reversed = resolveProjectByName({ name: "ai projct harness", recentCwds: [unrelated, nearby, expected] });
  assert.equal(forward.path, expected);
  assert.equal(reversed.path, expected);
  assert.equal(forward.match.score, reversed.match.score);

  fs.rmSync(root, { recursive: true, force: true });
});

test("a nested Codex working directory resolves through its nearest Git project root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-fuzzy-nested-"));
  const expected = path.join(root, "codex-hook-lightweight");
  const nested = path.join(expected, "autoclever", "scripts");
  fs.mkdirSync(path.join(expected, ".git"), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });

  const result = resolveProjectByName({ name: "codex hook light", recentCwds: [nested] });
  assert.equal(result.path, expected);
  assert.equal(result.source, "codex");

  fs.rmSync(root, { recursive: true, force: true });
});

test("a nested Git project under a recent Codex project is discoverable by approximate name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-nested-project-"));
  const parentProject = path.join(root, "my-workflow");
  const localChat = path.join(parentProject, "iva-local-chat");
  fs.mkdirSync(path.join(parentProject, ".git"), { recursive: true });
  fs.mkdirSync(path.join(localChat, ".git"), { recursive: true });

  const result = resolveProjectByName({ name: "Local Chat", recentCwds: [parentProject] });

  assert.equal(result.path, localChat);
  assert.equal(result.name, "iva-local-chat");
  assert.equal(result.match.kind, "substring");
  fs.rmSync(root, { recursive: true, force: true });
});

test("nested project discovery ignores non-Git folders and does not recurse without a bound", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-nested-boundary-"));
  const parentProject = path.join(root, "my-workflow");
  fs.mkdirSync(path.join(parentProject, ".git"), { recursive: true });
  fs.mkdirSync(path.join(parentProject, "local-chat"), { recursive: true });
  fs.mkdirSync(path.join(parentProject, "workspace", "iva-local-chat", ".git"), { recursive: true });

  assert.throws(
    () => resolveProjectByName({ name: "Local Chat", recentCwds: [parentProject] }),
    /未能可靠定位项目/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("fuzzy resolution refuses close competitors and reports low-confidence suggestions", () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "aph-fuzzy-a-"));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "aph-fuzzy-b-"));
  fs.mkdirSync(path.join(rootA, "AI-Project-Harness"));
  fs.mkdirSync(path.join(rootB, "AI_Project_Harness"));
  fs.mkdirSync(path.join(rootA, "Account-Operations"));

  assert.throws(
    () => resolveProjectByName({ name: "ai project harness", envValue: `${rootA}${path.delimiter}${rootB}` }),
    /多个近似项目/,
  );
  let lowConfidenceError;
  try {
    resolveProjectByName({ name: "weather station", envValue: rootA });
  } catch (error) {
    lowConfidenceError = error;
  }
  assert.match(lowConfidenceError.message, /你是不是想找/);
  assert.equal(lowConfidenceError.code, "PROJECT_NOT_FOUND");

  fs.rmSync(rootA, { recursive: true, force: true });
  fs.rmSync(rootB, { recursive: true, force: true });
});

test("Codex launch creates a named persistent thread and injects the Harness skill", async () => {
  const project = { id: "project-1", name: "Named Project", path: "C:\\work\\named-project" };
  const task = { id: "task-1", title: "接管项目" };
  const launched = await launchHarnessTask({
    executable: "codex.exe",
    project,
    task,
    projectId: "codex-project-1",
    missionPacket: "# AI Project Harness · BOOTSTRAP PACKET",
    skillPath: "C:\\app\\skills\\ai-project-harness\\SKILL.md",
    Client: FakeClient,
    run: async () => ({ stdout: "" }),
  });
  assert.equal(launched.threadId, "thread-harness-test");
  assert.equal(launched.turnId, "turn-harness-test");
  assert.equal(launched.projectId, "codex-project-1");
  assert.equal(launched.desktop.opened, true);
  const methods = launched.client.requests.map((item) => item.method);
  assert.deepEqual(methods, ["thread/start", "thread/name/set", "turn/start"]);
  const turn = launched.client.requests.find((item) => item.method === "turn/start").params;
  assert.deepEqual(turn.input[0], { type: "skill", name: "ai-project-harness", path: "C:\\app\\skills\\ai-project-harness\\SKILL.md" });
  assert.match(turn.input[1].text, /MODE: ONBOARDING/);
  assert.match(onboardingPrompt(project, task, "PACKET"), /不要修改代码/);
  assert.equal(launched.client.requests.find((item) => item.method === "thread/start").params.projectId, "codex-project-1");
});

test("control threads are created inside the official Codex Project", async () => {
  class ControlClient {
    static requests = [];
    constructor() {}
    async start() {}
    async request(method, params) {
      ControlClient.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "control-thread" } };
      if (method === "turn/start") return { turn: { id: "control-turn", status: "completed" } };
      if (method === "thread/turns/list") return { data: [] };
      return {};
    }
    close() {}
  }
  const result = await createCodexControlThread({
    executable: "codex.exe",
    projectPath: "C:\\work\\demo",
    projectId: "codex-project-1",
    name: "Demo · CTO",
    Client: ControlClient,
  });
  assert.equal(result.threadId, "control-thread");
  assert.equal(ControlClient.requests.find((item) => item.method === "thread/start").params.projectId, "codex-project-1");
  assert.equal(result.seedMethod, "turn/start");
  assert.equal(ControlClient.requests.find((item) => item.method === "thread/start").params.reasoningEffort, "low");
  const controlConfig = ControlClient.requests.find((item) => item.method === "thread/start").params.config;
  assert.equal(controlConfig.plugins["telegram@claude-plugins-official"].enabled, false);
  assert.equal(controlConfig.mcp_servers["image-tools"].enabled, false);
  assert.equal(controlConfig.mcp_servers.node_repl.enabled, false);
});

test("control thread creation seeds a readable rollout with one bounded low-effort model turn", async () => {
  class SeedClient {
    static requests = [];
    constructor() {}
    async start() {}
    async request(method, params) {
      SeedClient.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "seeded-control-thread" } };
      if (method === "turn/start") return { turn: { id: "seeded-control-turn", status: "completed" } };
      if (method === "thread/turns/list") return { data: [] };
      return {};
    }
    close() {}
  }
  const result = await createCodexControlThread({
    executable: "codex.exe",
    projectPath: "C:\\work\\demo",
    projectId: "codex-project-1",
    name: "Demo · CTO",
    bootstrapText: "Harness 控制线程已就绪。",
    Client: SeedClient,
  });
  assert.equal(result.threadId, "seeded-control-thread");
  assert.equal(result.seeded, true);
  assert.equal(result.rolloutVerified, true);
  assert.deepEqual(SeedClient.requests.map((item) => item.method), ["thread/start", "thread/name/set", "turn/start", "thread/turns/list"]);
  assert.deepEqual(SeedClient.requests.find((item) => item.method === "turn/start").params.input[0].text_elements, []);
});

test("control thread bootstrap surfaces turn failures instead of silently creating a shell row", async () => {
  class FailedSeedClient {
    async start() {}
    async request(method) {
      if (method === "thread/start") return { thread: { id: "failed-seed-thread" } };
      if (method === "turn/start") throw new Error("MCP client for `telegram` failed to start");
      return {};
    }
    close() {}
  }
  await assert.rejects(
    () => createCodexControlThread({ executable: "codex.exe", projectPath: "C:\\work\\demo", name: "Demo · CTO", Client: FailedSeedClient }),
    /MCP client for `telegram` failed to start/,
  );
});

test("control thread bootstrap rejects an invalid paginated history response", async () => {
  class InvalidHistoryClient {
    async start() {}
    async request(method) {
      if (method === "thread/start") return { thread: { id: "invalid-history-thread" } };
      if (method === "turn/start") return { turn: { id: "invalid-history-turn", status: "completed" } };
      if (method === "thread/turns/list") return { invalid: true };
      return {};
    }
    close() {}
  }
  await assert.rejects(
    () => createCodexControlThread({ executable: "codex.exe", projectPath: "C:\\work\\demo", name: "Demo · Review", Client: InvalidHistoryClient }),
    /rollout verification failed: invalid thread\/turns\/list response/,
  );
});

test("control thread history probe identifies a missing source rollout for repair", async () => {
  class BrokenClient {
    constructor() {}
    async start() {}
    async request(method) {
      assert.equal(method, "thread/turns/list");
      throw new Error("thread/turns/list: invalid paginated history lineage: missing source rollout");
    }
    close() {}
  }
  const result = await inspectCodexThread({
    executable: "codex.exe",
    cwd: "C:\\work\\demo",
    threadId: "broken-control-thread",
    Client: BrokenClient,
  });
  assert.equal(result.readable, false);
  assert.match(result.error, /missing source rollout/);
});

test("control thread history probe accepts an empty but materialized rollout", async () => {
  class HealthyClient {
    constructor() {}
    async start() {}
    async request(method) {
      assert.equal(method, "thread/turns/list");
      return { data: [], nextCursor: null };
    }
    close() {}
  }
  const result = await inspectCodexThread({
    executable: "codex.exe",
    cwd: "C:\\work\\demo",
    threadId: "healthy-control-thread",
    Client: HealthyClient,
  });
  assert.deepEqual(result, { readable: true, turns: [] });
});

test("Codex launch passes its persistent thread id to the Desktop opener", async () => {
  const openedUris = [];
  const launched = await launchHarnessTask({
    executable: "codex.exe",
    project: { id: "project-1", name: "Named Project", path: "C:\\work\\named-project" },
    task: { id: "task-1", title: "接管项目" },
    missionPacket: "PACKET",
    skillPath: "C:\\skills\\SKILL.md",
    Client: FakeClient,
    openExternal: async (uri) => { openedUris.push(uri); },
    run: async () => { throw new Error("project fallback must not run"); },
  });
  assert.equal(launched.desktop.capability, "thread-deep-link");
  assert.deepEqual(openedUris, ["codex://threads/thread-harness-test"]);
});

test("Codex client retains early notifications for the Harness monitor to replay", () => {
  const client = new CodexAppServerClient({ executable: "codex.exe", cwd: process.cwd() });
  client.handleMessage(JSON.stringify({ method: "turn/completed", params: { threadId: "t-early", turn: { status: "completed" } } }));
  assert.equal(client.notifications.length, 1);
  assert.equal(client.notifications[0].method, "turn/completed");
});

test("Windows npm cmd shim can run Codex app-server without spawn EINVAL", {
  skip: process.platform !== "win32",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-cmd-"));
  const serverPath = path.join(root, "fake-codex-server.cjs");
  const shimPath = path.join(root, "codex.cmd");
  fs.writeFileSync(serverPath, [
    'let buffer = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => {',
    '  buffer += chunk;',
    '  let end = buffer.indexOf("\\n");',
    '  while (end >= 0) {',
    '    const line = buffer.slice(0, end).trim();',
    '    buffer = buffer.slice(end + 1);',
    '    if (line) {',
    '      const message = JSON.parse(line);',
    '      const result = message.method === "thread/list" ? { data: [{ cwd: process.cwd() }] } : {};',
    '      process.stdout.write(`${JSON.stringify({ id: message.id, result })}\\n`);',
    '    }',
    '    end = buffer.indexOf("\\n");',
    '  }',
    '});',
  ].join("\n"));
  fs.writeFileSync(shimPath, `@echo off\r\n"${process.execPath}" "%~dp0fake-codex-server.cjs" %*\r\n`);

  const client = new CodexAppServerClient({ executable: shimPath, cwd: root, requestTimeoutMs: 3000 });
  try {
    await client.start();
    const response = await client.request("thread/list", { limit: 1 });
    assert.deepEqual(response, { data: [{ cwd: root }] });
  } finally {
    const appServerProcess = client.process;
    client.close();
    if (appServerProcess?.exitCode === null) await once(appServerProcess, "exit");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Windows npm cmd shim forwards a project path as one Codex app argument", {
  skip: process.platform !== "win32",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-cmd-app-"));
  const projectPath = path.join(root, "project %&! (alpha)");
  const capturePath = path.join(root, "captured-args.json");
  const captureScript = path.join(root, "capture.cjs");
  const shimPath = path.join(root, "codex.cmd");
  fs.mkdirSync(projectPath);
  fs.writeFileSync(captureScript, 'require("node:fs").writeFileSync(process.env.APH_CAPTURE_PATH, JSON.stringify(process.argv.slice(2)));\n');
  fs.writeFileSync(shimPath, `@echo off\r\n"${process.execPath}" "%~dp0capture.cjs" %*\r\n`);

  const previousCapturePath = process.env.APH_CAPTURE_PATH;
  process.env.APH_CAPTURE_PATH = capturePath;
  try {
    const result = await openCodexDesktop(shimPath, projectPath);
    assert.equal(result.opened, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(capturePath, "utf8")), ["app", projectPath]);
  } finally {
    if (previousCapturePath === undefined) delete process.env.APH_CAPTURE_PATH;
    else process.env.APH_CAPTURE_PATH = previousCapturePath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("closing a Windows npm cmd shim terminates its app-server descendant", {
  skip: process.platform !== "win32",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-cmd-descendant-"));
  const serverPath = path.join(root, "persistent-server.cjs");
  const pidPath = path.join(root, "server.pid");
  const shimPath = path.join(root, "codex.cmd");
  fs.writeFileSync(serverPath, [
    `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => {",
    "  for (const line of chunk.split(/\\r?\\n/).filter(Boolean)) {",
    "    const request = JSON.parse(line);",
    "    process.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\\n`);",
    "  }",
    "});",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  fs.writeFileSync(shimPath, `@echo off\r\n"${process.execPath}" "%~dp0persistent-server.cjs" %*\r\n`);

  const isAlive = (pid) => {
    try {
      process.kill(Number(pid), 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitForPid = async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (fs.existsSync(pidPath)) return Number(fs.readFileSync(pidPath, "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("app-server descendant did not publish its PID");
  };

  const client = new CodexAppServerClient({ executable: shimPath, cwd: root, requestTimeoutMs: 3000 });
  let shimProcess;
  let descendantPid;
  try {
    await client.start();
    shimProcess = client.process;
    descendantPid = await waitForPid();
    assert.ok(isAlive(descendantPid), "fixture descendant should be alive before close");
    client.close();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && isAlive(descendantPid)) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(isAlive(descendantPid), false, "closing the shim must terminate the app-server descendant");
  } finally {
    client.close();
    if (descendantPid && isAlive(descendantPid)) {
      try { execFileSync("taskkill", ["/PID", String(descendantPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
    }
    if (shimProcess?.exitCode === null) await once(shimProcess, "exit").catch(() => {});
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {
      // Windows can briefly retain a just-exited shim handle (for example
      // while Defender scans the fixture). The process-tree assertion above
      // is the contract; a best-effort cleanup failure must not make release
      // verification flaky or touch user files.
    }
  }
});

test("terminal Codex runs can clean up a persisted process tree before deep-link open", {
  skip: process.platform !== "win32",
}, async () => {
  const calls = [];
  const result = await terminateCodexProcessTree(4312, {
    platform: "win32",
    run: async (...args) => {
      calls.push(args);
      return { stdout: "SUCCESS" };
    },
  });
  assert.equal(result.terminated, true);
  assert.deepEqual(calls, [["taskkill", ["/PID", "4312", "/T", "/F"], { windowsHide: true }]]);
});

test("Codex Desktop opens the exact task thread through its registered deep link", async () => {
  const openedUris = [];
  const result = await openCodexDesktop("codex.exe", "C:\\work\\named-project", {
    threadId: "thread-harness-test/alpha",
    openExternal: async (uri) => { openedUris.push(uri); },
    run: async () => { throw new Error("project fallback must not run"); },
  });
  assert.equal(result.opened, true);
  assert.equal(result.capability, "thread-deep-link");
  assert.equal(result.uri, "codex://threads/thread-harness-test%2Falpha");
  assert.deepEqual(openedUris, ["codex://threads/thread-harness-test%2Falpha"]);
});

test("Codex Desktop falls back to the project path when the task deep link is unavailable", async () => {
  const captured = [];
  const result = await openCodexDesktop("codex.exe", "C:\\work\\named-project", {
    threadId: "thread-harness-test",
    openExternal: async () => { throw new Error("protocol handler unavailable"); },
    run: async (_executable, args) => { captured.push(args); return { stdout: "" }; },
  });
  assert.equal(result.opened, true);
  assert.equal(result.capability, "project-path-fallback");
  assert.equal(result.threadError, "protocol handler unavailable");
  assert.deepEqual(captured, [["app", "C:\\work\\named-project"]]);
});

test("Codex Desktop reports a missing CLI only after the exact deep link is unavailable", async () => {
  const openedUris = [];
  const result = await openCodexDesktop("", "C:\\work\\named-project", {
    threadId: "thread-harness-test",
    openExternal: async (uri) => { openedUris.push(uri); },
  });
  assert.equal(result.opened, true);
  assert.equal(result.capability, "thread-deep-link");
  assert.deepEqual(openedUris, ["codex://threads/thread-harness-test"]);
});

test("app-server process is closed when initialization times out", {
  skip: process.platform !== "win32",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-codex-timeout-"));
  const serverPath = path.join(root, "silent-server.cjs");
  const shimPath = path.join(root, "codex.cmd");
  fs.writeFileSync(serverPath, [
    "const keepAlive = setInterval(() => {}, 1000);",
    "process.stdin.resume();",
    "process.stdin.on('end', () => clearInterval(keepAlive));",
  ].join("\n"));
  fs.writeFileSync(shimPath, `@echo off\r\n"${process.execPath}" "%~dp0silent-server.cjs" %*\r\n`);

  const client = new CodexAppServerClient({ executable: shimPath, cwd: root, requestTimeoutMs: 80 });
  let appServerProcess;
  try {
    const starting = client.start();
    appServerProcess = client.process;
    await assert.rejects(starting, /initialize timed out/);
    assert.equal(client.process, null);
    if (appServerProcess?.exitCode === null) await once(appServerProcess, "exit");
  } finally {
    client.close();
    if (appServerProcess?.exitCode === null) await once(appServerProcess, "exit");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex client is closed when thread setup fails after initialization", async () => {
  class FailingTurnClient extends FakeClient {
    static instance;
    constructor(options) {
      super(options);
      this.closed = false;
      FailingTurnClient.instance = this;
    }
    async request(method, params) {
      if (method === "turn/start") throw new Error("turn rejected");
      return super.request(method, params);
    }
    close() { this.closed = true; }
  }

  await assert.rejects(launchHarnessTask({
    executable: "codex.exe",
    project: { id: "project-1", name: "Named Project", path: "C:\\work\\named-project" },
    task: { id: "task-1", title: "接管项目" },
    missionPacket: "PACKET",
    skillPath: "C:\\skills\\SKILL.md",
    Client: FailingTurnClient,
  }), /turn rejected/);

  assert.equal(FailingTurnClient.instance.closed, true);
});

test("app-server stdin failures reject initialization instead of becoming uncaught errors", async () => {
  const processFixture = new EventEmitter();
  processFixture.stdin = new PassThrough();
  processFixture.stdout = new PassThrough();
  processFixture.stderr = new PassThrough();
  processFixture.kill = () => processFixture.emit("exit", 0, null);
  const client = new CodexAppServerClient({
    executable: "codex.exe",
    cwd: process.cwd(),
    requestTimeoutMs: 3000,
    spawnProcess: () => processFixture,
  });
  const starting = client.start();
  try {
    assert.ok(processFixture.stdin.listenerCount("error") > 0);
    processFixture.stdin.emit("error", new Error("broken stdin pipe"));
    await assert.rejects(starting, /broken stdin pipe/);
  } finally {
    client.close();
    await starting.catch(() => {});
  }
});

test("app-server stream failures close an already initialized client", async () => {
  const processFixture = new EventEmitter();
  processFixture.stdin = new PassThrough();
  processFixture.stdout = new PassThrough();
  processFixture.stderr = new PassThrough();
  let killed = false;
  processFixture.kill = () => {
    killed = true;
    processFixture.emit("exit", 0, null);
  };
  processFixture.stdin.on("data", (chunk) => {
    const request = JSON.parse(String(chunk).trim());
    if (request.method === "initialize") {
      process.nextTick(() => processFixture.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`));
    }
  });
  const client = new CodexAppServerClient({
    executable: "codex.exe",
    cwd: process.cwd(),
    requestTimeoutMs: 3000,
    spawnProcess: () => processFixture,
  });

  await client.start();
  const pending = client.request("thread/list");
  processFixture.stdout.emit("error", new Error("broken stdout pipe"));

  await assert.rejects(pending, /broken stdout pipe/);
  assert.equal(client.process, null);
  assert.equal(killed, true);
});
