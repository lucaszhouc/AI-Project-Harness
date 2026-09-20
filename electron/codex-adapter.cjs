const { EventEmitter } = require("node:events");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { resolveCommandInvocation } = require("./command-runtime.cjs");
const { version: harnessVersion } = require("../package.json");

const execFileAsync = promisify(execFile);

async function terminateCodexProcessTree(processId, { platform = process.platform, run = execFileAsync } = {}) {
  const pid = Number(processId);
  if (!Number.isFinite(pid) || pid <= 0) return { terminated: false };
  if (platform === "win32") {
    try {
      await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      return { terminated: true };
    } catch (error) {
      return { terminated: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  try {
    process.kill(pid);
    return { terminated: true };
  } catch (error) {
    return { terminated: false, error: error instanceof Error ? error.message : String(error) };
  }
}

class CodexAppServerClient extends EventEmitter {
  constructor({ executable, cwd, spawnProcess = spawn, requestTimeoutMs = 15000 }) {
    super();
    this.executable = executable;
    this.cwd = cwd;
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.buffer = "";
    this.process = null;
    this.commandWrapper = false;
    this.notifications = [];
  }

  async start() {
    if (this.process) return;
    const invocation = resolveCommandInvocation(this.executable, ["app-server", "--stdio"]);
    this.commandWrapper = invocation.wrapped;
    this.process = this.spawnProcess(invocation.executable, invocation.args, {
      cwd: this.cwd,
      env: invocation.env,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const activeProcess = this.process;
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdin.on("error", (error) => this.close(error));
    this.process.stdout.on("error", (error) => this.close(error));
    this.process.stderr.on("error", (error) => this.close(error));
    this.process.stdout.on("data", (chunk) => this.handleChunk(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-6000);
    });
    this.process.on("error", (error) => this.close(error));
    this.process.on("exit", (code, signal) => {
      if (this.process === activeProcess) this.process = null;
      const suffix = this.stderr.trim() ? ` · ${this.stderr.trim()}` : "";
      this.failAll(new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})${suffix}`));
      this.emit("exit", { code, signal });
    });
    try {
      await this.request("initialize", {
        clientInfo: { name: "ai-project-harness", title: "AI Project Harness", version: harnessVersion },
        capabilities: { experimentalApi: true },
      });
      this.notify("initialized");
    } catch (error) {
      this.close(error);
      throw error;
    }
  }

  handleChunk(chunk) {
    this.buffer += chunk;
    let lineEnd = this.buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd).trim();
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (line) this.handleMessage(line);
      lineEnd = this.buffer.indexOf("\n");
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("protocol-warning", `Invalid app-server JSON: ${line.slice(0, 300)}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      this.notifications.push(message);
      if (this.notifications.length > 200) this.notifications.shift();
      this.emit("notification", message);
    }
  }

  request(method, params = {}) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error("Codex app-server is not writable"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method, params) {
    if (!this.process?.stdin?.writable) return;
    const message = params === undefined ? { method } : { method, params };
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close(reason = new Error("Codex app-server closed")) {
    this.failAll(reason);
    const activeProcess = this.process;
    this.process = null;
    if (!activeProcess) return;
    if (this.commandWrapper) {
      activeProcess.stdin?.end();
      if (process.platform === "win32" && Number.isFinite(Number(activeProcess.pid))) {
        // cmd.exe is only a shim for npm's codex.cmd. Killing the wrapper
        // alone leaves its node app-server child alive and keeps the thread
        // locked, so close the entire process tree we started.
        execFile("taskkill", ["/PID", String(activeProcess.pid), "/T", "/F"], { windowsHide: true }, () => {});
        return;
      }
      const killTimer = setTimeout(() => activeProcess.kill(), 1000);
      killTimer.unref?.();
      activeProcess.once("exit", () => clearTimeout(killTimer));
      return;
    }
    activeProcess.kill();
  }
}

async function openCodexDesktop(executable, projectPath, runOrOptions = execFileAsync, maybeOptions = {}) {
  const options = typeof runOrOptions === "function"
    ? { run: runOrOptions, ...maybeOptions }
    : (runOrOptions || {});
  const run = options.run || execFileAsync;
  const threadId = typeof options.threadId === "string" && options.threadId.trim() ? options.threadId.trim() : undefined;
  const openExternal = typeof options.openExternal === "function" ? options.openExternal : undefined;
  const preferProjectPath = Boolean(options.preferProjectPath);
  let threadError;

  if (threadId && openExternal && !preferProjectPath) {
    const uri = `codex://threads/${encodeURIComponent(threadId)}`;
    try {
      await openExternal(uri);
      return { opened: true, capability: "thread-deep-link", uri };
    } catch (error) {
      // Keep a project-path fallback for older/unregistered Desktop builds.
      threadError = error instanceof Error ? error.message : String(error);
    }
  }

  if (typeof executable !== "string" || !executable.trim()) {
    return {
      opened: false,
      capability: threadId ? "thread-deep-link-unavailable" : "project-path-fallback",
      error: threadError || "Codex CLI executable unavailable",
    };
  }

  try {
    const invocation = resolveCommandInvocation(executable, ["app", projectPath]);
    await run(invocation.executable, invocation.args, {
      timeout: 12000,
      env: invocation.env,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      encoding: "utf8",
    });
    return {
      opened: true,
      capability: "project-path-fallback",
      ...(threadError ? { threadError } : {}),
    };
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : String(error);
    return {
      opened: false,
      capability: threadId ? "thread-deep-link-and-project-path-unavailable" : "project-path-fallback",
      error: threadError ? `thread deep link: ${threadError}; project path: ${fallbackError}` : fallbackError,
    };
  }
}

/** Open Codex's native new-project flow. This is intentionally a protocol
 * deep link: it never edits the Desktop-owned global JSON index. */
async function registerCodexDesktopProject({ projectPath, openExternal }) {
  const resolvedPath = String(projectPath || "").trim();
  if (!resolvedPath) throw new Error("Project path is required");
  if (typeof openExternal !== "function") throw new Error("Codex Desktop deep-link opener is unavailable");
  const params = new URLSearchParams({ path: resolvedPath });
  const uri = `codex://new?${params.toString()}`;
  await openExternal(uri);
  return { opened: true, capability: "new-project-deep-link", uri };
}

function onboardingPrompt(project, task, missionPacket) {
  return [
    missionPacket,
    "MODE: ONBOARDING",
    `PROJECT_PATH: ${project.path}`,
    `HARNESS_PROJECT_ID: ${project.id}`,
    `HARNESS_TASK_ID: ${task.id}`,
    project.ledger?.path ? `PROJECT_LEDGER: ${project.ledger.path}` : "PROJECT_LEDGER: use npm run harness -- context",
    "",
    "这是 Harness 为该项目创建的独立 Codex 任务。请使用已注入的 $ai-project-harness skill。",
    "先只读检查仓库并建立可信项目画像，不要修改代码；完成后按 skill 的 harness-result 契约提交候选结果。",
  ].join("\n");
}

function taskPrompt(project, task, missionPacket) {
  return [
    missionPacket,
    "MODE: TASK",
    `PROJECT_PATH: ${project.path}`,
    `HARNESS_PROJECT_ID: ${project.id}`,
    `HARNESS_TASK_ID: ${task.id}`,
    project.ledger?.path ? `PROJECT_LEDGER: ${project.ledger.path}` : "PROJECT_LEDGER: use npm run harness -- context",
    "",
    "这是 Harness 为该项目创建的独立任务。请使用已注入的 $ai-project-harness skill。",
    "只在任务合同允许的范围内工作；以 Git、测试和可复核文件为事实来源。",
    "完成、暂停或阻塞时必须返回一个 fenced harness-result JSON；不要直接修改 Harness 状态文件。",
  ].join("\n");
}

/** Build a read-only prompt for pulling an existing Codex Project into Harness. */
function importPrompt(project, options = {}) {
  // Kept in the adapter as the injection boundary so callers do not need to
  // know the on-disk protocol module. The import service owns normalization.
  return require("./codex-import.cjs").importPrompt(project, options);
}

/**
 * Start a bounded Codex import turn. This deliberately returns a candidate
 * thread/turn only; parsing and state mutation happen after the caller has
 * received the Agent's fenced harness-import result.
 */
async function launchHarnessImport({ executable, project, sourceProjectId = project?.codexProjectId, skillPath, schemaPath, Client = CodexAppServerClient, run, openExternal, preferProjectPath = false, context }) {
  if (!project?.path) throw new Error("Project path is required");
  const client = new Client({ executable, cwd: project.path });
  try {
    await client.start();
    const started = await client.request("thread/start", {
      cwd: project.path,
      threadSource: "appServer",
      ephemeral: false,
      ...(sourceProjectId ? { projectId: sourceProjectId } : {}),
    });
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("Codex app-server did not return an import thread id");
    await client.request("thread/name/set", { threadId, name: `${project.name} · Harness 导入` });
    const turn = await client.request("turn/start", {
      threadId,
      cwd: project.path,
      // Import is a bounded, read-only extraction task. Medium keeps the
      // structured snapshot responsive even when the selected Project has
      // many long historical rollouts; the raw bytes are archived separately.
      effort: "medium",
      input: [
        ...(skillPath ? [{ type: "skill", name: "ai-project-harness", path: skillPath }] : []),
        { type: "text", text: importPrompt(project, { sourceProjectId, schemaPath, context }), text_elements: [] },
      ],
    });
    let desktop;
    if (typeof openExternal === "function" || typeof run === "function") {
      desktop = await openCodexDesktop(executable, project.path, { run, threadId, openExternal, preferProjectPath });
    }
    return { client, threadId, turnId: turn?.turn?.id || null, processId: client.process?.pid, projectId: sourceProjectId, desktop };
  } catch (error) {
    client.close();
    throw error;
  }
}

async function launchHarnessTask({ executable, project, task, missionPacket, skillPath, projectId = project?.codexProjectId, Client = CodexAppServerClient, run, openExternal, preferProjectPath = false }) {
  const client = new Client({ executable, cwd: project.path });
  try {
    await client.start();
    const started = await client.request("thread/start", {
      cwd: project.path,
      threadSource: "appServer",
      ephemeral: false,
      ...(projectId ? { projectId } : {}),
    });
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("Codex app-server did not return a thread id");
    await client.request("thread/name/set", { threadId, name: `${project.name} · ${task.title || "Harness 任务"}` });
    const turn = await client.request("turn/start", {
      threadId,
      cwd: project.path,
      input: [
        { type: "skill", name: "ai-project-harness", path: skillPath },
        { type: "text", text: !task.workstream || task.workstream === "project-onboarding" ? onboardingPrompt(project, task, missionPacket) : taskPrompt(project, task, missionPacket), text_elements: [] },
      ],
    });
    const desktop = await openCodexDesktop(executable, project.path, {
      run,
      threadId,
      openExternal,
      preferProjectPath,
    });
    return { client, threadId, turnId: turn?.turn?.id || null, processId: client.process?.pid, projectId, desktop };
  } catch (error) {
    client.close();
    throw error;
  }
}

const CONTROL_THREAD_CONFIG = Object.freeze({
  // A control thread is only an anchor and health probe. Optional channel and
  // local utility servers must not be allowed to block its first turn. Task
  // and import threads intentionally do not use this override.
  plugins: Object.freeze({
    "telegram@claude-plugins-official": Object.freeze({ enabled: false }),
  }),
  mcp_servers: Object.freeze({
    "image-tools": Object.freeze({ enabled: false }),
    node_repl: Object.freeze({ enabled: false }),
  }),
});
// `minimal` is not accepted by the currently installed gpt-5.6-sol runtime;
// low is the smallest supported effort across the Codex models we target.
const CONTROL_THREAD_EFFORT = "low";

function turnTerminalStatus(turn) {
  const status = String(turn?.status || "").toLowerCase();
  if (["completed", "complete", "succeeded", "success"].includes(status)) return "completed";
  if (["failed", "error", "cancelled", "canceled", "interrupted"].includes(status)) return "failed";
  return undefined;
}

function turnFromNotification(message, threadId, turnId) {
  const params = message?.params || {};
  const eventThreadId = params.threadId || params.thread?.id;
  const turn = params.turn || {};
  const eventTurnId = params.turnId || turn.id;
  if (eventThreadId && String(eventThreadId) !== String(threadId)) return undefined;
  if (turnId && eventTurnId && String(eventTurnId) !== String(turnId)) return undefined;
  if (message?.method !== "turn/completed" && message?.method !== "turn/failed") return undefined;
  const status = turnTerminalStatus({ ...turn, status: turn.status || params.status });
  return {
    status: status || (message.method === "turn/completed" ? "completed" : "failed"),
    turn: { ...turn, id: eventTurnId || turnId, status: turn.status || params.status },
    error: turn.error || params.error,
  };
}

async function waitForTurnCompletion(client, { threadId, turnId, initialTurn, timeoutMs = 90_000 }) {
  const initialStatus = turnTerminalStatus(initialTurn);
  if (initialStatus === "failed") throw new Error(`Codex control turn failed: ${initialTurn?.error?.message || initialTurn?.error || "unknown error"}`);
  if (initialStatus === "completed") return { status: "completed", turn: initialTurn };
  const existing = (client.notifications || []).map((message) => turnFromNotification(message, threadId, turnId)).find(Boolean);
  if (existing?.status === "failed") throw new Error(`Codex control turn failed: ${existing.error?.message || existing.error || "unknown error"}`);
  if (existing?.status === "completed") return existing;
  if (typeof client.once !== "function") throw new Error("Codex control turn completion event is unavailable");
  const boundedTimeout = Math.max(1, Math.min(120_000, Number(timeoutMs) || 90_000));
  return new Promise((resolve, reject) => {
    let timer;
    const onNotification = (message) => {
      const result = turnFromNotification(message, threadId, turnId);
      if (!result) return;
      clearTimeout(timer);
      client.removeListener?.("notification", onNotification);
      if (result.status === "failed") reject(new Error(`Codex control turn failed: ${result.error?.message || result.error || "unknown error"}`));
      else resolve(result);
    };
    timer = setTimeout(() => {
      client.removeListener?.("notification", onNotification);
      reject(new Error(`Codex control turn timed out after ${boundedTimeout}ms`));
    }, boundedTimeout);
    client.on("notification", onNotification);
  });
}

async function createCodexControlThread({ executable, projectPath, name, projectId, bootstrapText, Client = CodexAppServerClient, turnTimeoutMs = 90_000 }) {
  const client = new Client({ executable, cwd: projectPath });
  try {
    await client.start();
    const started = await client.request("thread/start", {
      cwd: projectPath,
      threadSource: "appServer",
      ephemeral: false,
      config: CONTROL_THREAD_CONFIG,
      reasoningEffort: CONTROL_THREAD_EFFORT,
      ...(projectId ? { projectId } : {}),
    });
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("Codex app-server did not return a control thread id");
    await client.request("thread/name/set", { threadId, name });
    // A bare `thread/start` creates only a database row. One bounded real turn
    // is required for Codex Desktop to index the thread's first user message,
    // preview, and sidebar membership. Keep it deliberately tiny and isolated
    // from optional MCP servers; normal task/import turns retain full config.
    const seedText = String(bootstrapText || `${name || "Harness 控制线程"} 已创建，等待后续任务。`).trim();
    if (!seedText) throw new Error("Codex control thread bootstrap text is empty");
    const startedTurn = await client.request("turn/start", {
      threadId,
      cwd: projectPath,
      effort: CONTROL_THREAD_EFFORT,
      input: [{ type: "text", text: seedText.slice(0, 8000), text_elements: [] }],
    });
    const turn = startedTurn?.turn || startedTurn;
    const turnId = turn?.id || startedTurn?.turnId;
    if (!turnId) throw new Error("Codex control turn did not return a turn id");
    await waitForTurnCompletion(client, { threadId, turnId, initialTurn: turn, timeoutMs: turnTimeoutMs });
    let turns;
    try {
      turns = await client.request("thread/turns/list", { threadId, limit: 1, itemsView: "summary" });
    } catch (error) {
      throw new Error(`Codex control thread rollout verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!turns || !Array.isArray(turns.data)) throw new Error("Codex control thread rollout verification failed: invalid thread/turns/list response");
    return { threadId, turnId, seeded: true, seedMethod: "turn/start", rolloutVerified: true };
  } finally {
    client.close();
  }
}

async function listRecentCodexCwds({ executable, cwd, Client = CodexAppServerClient }) {
  const threads = await listRecentCodexThreads({ executable, cwd, Client });
  return [...new Set(threads.map((thread) => thread.cwd).filter(Boolean))];
}

/**
 * Read the Desktop's durable thread index without opening or mutating a
 * conversation. This is deliberately separate from the launch client so old
 * Harness tasks can recover a useful conversation entry after a migration.
 */
async function listRecentCodexThreads({ executable, cwd, limit = 200, Client = CodexAppServerClient }) {
  const client = new Client({ executable, cwd });
  try {
    await client.start();
    const response = await client.request("thread/list", {
      limit,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
    return Array.isArray(response?.data) ? response.data : [];
  } finally {
    client.close();
  }
}

/** Read the complete bounded thread index through app-server pagination.
 * Import uses this to avoid treating the newest page as the whole project. */
async function listAllCodexThreads({ executable, cwd, maxThreads = 5000, pageSize = 200, Client = CodexAppServerClient }) {
  const client = new Client({ executable, cwd });
  const output = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  const boundedMax = Math.max(1, Math.min(20000, Number(maxThreads) || 5000));
  const boundedPage = Math.max(1, Math.min(500, Number(pageSize) || 200));
  try {
    await client.start();
    let cursor;
    while (output.length < boundedMax) {
      const remaining = Math.min(boundedPage, boundedMax - output.length);
      const response = await client.request("thread/list", {
        limit: remaining,
        sortKey: "recency_at",
        sortDirection: "desc",
        ...(cursor ? { cursor } : {}),
      });
      const rows = Array.isArray(response?.data) ? response.data : [];
      for (const row of rows) {
        const id = String(row?.id || "");
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        output.push(row);
        if (output.length >= boundedMax) break;
      }
      const next = String(response?.nextCursor || "").trim();
      if (!next || !rows.length || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    }
    return output;
  } finally {
    client.close();
  }
}

async function listCodexProjects({ executable, cwd, Client = CodexAppServerClient }) {
  const client = new Client({ executable, cwd });
  try {
    await client.start();
    try {
      return await readAllCodexProjects(client);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unknown variant [`']project\/list/i.test(message)) {
        const unsupported = new Error("当前 Codex CLI 不支持官方 Project API；请从 Codex Desktop 内置 CLI 启动 Harness 对接，不能退回文件夹猜测");
        unsupported.code = "CODEX_PROJECT_API_UNAVAILABLE";
        throw unsupported;
      }
      throw error;
    }
  } finally {
    client.close();
  }
}

/**
 * Verify that a persisted Codex thread has a materialized history source.
 * `thread/read` can still return metadata for a shell-only thread, while the
 * Desktop paginated reader fails later with "missing source rollout". Probe
 * the same turns endpoint the Desktop uses so repair decisions are based on
 * the actual failure boundary.
 */
async function inspectCodexThread({ executable, cwd, threadId, Client = CodexAppServerClient }) {
  if (!executable || !cwd || !threadId) throw new Error("Codex executable, cwd and thread id are required");
  const client = new Client({ executable, cwd });
  try {
    await client.start();
    const response = await client.request("thread/turns/list", {
      threadId: String(threadId),
      limit: 1,
      itemsView: "summary",
    });
    return { readable: true, turns: Array.isArray(response?.data) ? response.data : [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/missing source rollout|invalid paginated history lineage/i.test(message)) {
      return { readable: false, error: message };
    }
    throw error;
  } finally {
    client.close();
  }
}

function normalizeThreadPath(value) {
  return String(value || "")
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function projectIdempotencyKey(projectPath) {
  const digest = createHash("sha256").update(normalizeThreadPath(projectPath)).digest("hex");
  const variant = (0x8 + (Number.parseInt(digest.slice(16, 18), 16) % 4)).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 21)}-${digest.slice(21, 33)}`;
}

function projectHasRoot(project, projectPath) {
  const target = normalizeThreadPath(projectPath);
  return Boolean(target && (project?.roots || []).some((root) => normalizeThreadPath(root?.path) === target));
}

async function readAllCodexProjects(client, { maxProjects = 5000, pageSize = 100 } = {}) {
  const output = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  const max = Math.max(1, Math.min(20_000, Number(maxProjects) || 5000));
  const limit = Math.max(1, Math.min(500, Number(pageSize) || 100));
  let cursor;
  while (output.length < max) {
    const response = await client.request("project/list", { limit, ...(cursor ? { cursor } : {}) });
    if (!response || !Array.isArray(response.data)) throw new Error("Codex project/list returned an invalid response; refusing to create a Project");
    for (const project of response.data) {
      const id = String(project?.id || "");
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      output.push(project);
      if (output.length >= max) break;
    }
    const next = String(response.nextCursor || "").trim();
    if (!next || !response.data.length || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return output;
}

function projectTimestamp(value) {
  if (value === undefined || value === null || value === "") return Number.NEGATIVE_INFINITY;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareCodexProjectCandidates(left, right) {
  const leftPosition = Number(left?.position);
  const rightPosition = Number(right?.position);
  const leftRank = Number.isFinite(leftPosition) ? leftPosition : Number.POSITIVE_INFINITY;
  const rightRank = Number.isFinite(rightPosition) ? rightPosition : Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const updated = projectTimestamp(right?.updatedAt) - projectTimestamp(left?.updatedAt);
  if (updated) return updated;
  const created = projectTimestamp(right?.createdAt) - projectTimestamp(left?.createdAt);
  if (created) return created;
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

/**
 * Ensure a real Codex Desktop Project exists through the public app-server
 * project API. The old global JSON folder index is not sufficient: Desktop's
 * project picker reads `projects`/`project_roots` from its own store, and new
 * threads only become members when `projectId` is supplied at thread/start.
 */
async function ensureCodexProject({ executable, cwd, projectPath, projectName, Client = CodexAppServerClient, waitForExistingMs = 0, pollMs = 150 }) {
  if (!executable || !projectPath) throw new Error("Codex executable and project path are required");
  const resolvedPath = String(projectPath);
  const name = String(projectName || path.basename(resolvedPath)).trim() || path.basename(resolvedPath);
  const client = new Client({ executable, cwd: cwd || resolvedPath });
  try {
    await client.start();
    const readProjects = async () => readAllCodexProjects(client);
    let projects = await readProjects();
    let existing = projects.filter((project) => projectHasRoot(project, resolvedPath)).sort(compareCodexProjectCandidates)[0];
    // `codex://new?path=...` is handled by the already-running Desktop
    // process. Its app-server write is asynchronous, so do not race it with
    // our own project/create and manufacture a duplicate root. This bounded
    // condition wait is also safe when no Desktop is running: after the wait,
    // the deterministic app-server create path is used.
    const deadline = Date.now() + Math.max(0, Math.min(10_000, Number(waitForExistingMs) || 0));
    while (!existing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(25, Math.min(1000, Number(pollMs) || 150))));
      projects = await readProjects();
      existing = projects.filter((project) => projectHasRoot(project, resolvedPath)).sort(compareCodexProjectCandidates)[0];
    }
    if (existing?.id) return { projectId: String(existing.id), name: existing.name || name, path: resolvedPath, created: false, project: existing };
    let created;
    try {
      created = await client.request("project/create", {
        name,
        roots: [{ path: resolvedPath }],
        idempotencyKey: projectIdempotencyKey(resolvedPath),
      });
    } catch (error) {
      // A Desktop write may land between the final list and our create. A
      // single re-list closes that race without retrying arbitrary failures.
      projects = await readProjects();
      existing = projects.filter((project) => projectHasRoot(project, resolvedPath)).sort(compareCodexProjectCandidates)[0];
      if (existing?.id) return { projectId: String(existing.id), name: existing.name || name, path: resolvedPath, created: false, project: existing };
      throw error;
    }
    const project = created?.project;
    if (!project?.id || !Array.isArray(project.roots) || !projectHasRoot(project, resolvedPath)) {
      throw new Error("Codex project/create returned an invalid Project or root; refusing to persist it");
    }
    return { projectId: String(project.id), name: project.name || name, path: resolvedPath, created: true, project };
  } finally {
    client.close();
  }
}

/** Return the newest persistent thread that was created in this project. */
function selectLatestCodexThread(threads, projectPath) {
  const target = normalizeThreadPath(projectPath);
  if (!target || !Array.isArray(threads)) return undefined;
  return threads
    .filter((thread) => !thread?.ephemeral && thread?.id && normalizeThreadPath(thread.cwd) === target)
    .sort((left, right) => Number(right.recencyAt || right.updatedAt || right.createdAt || 0)
      - Number(left.recencyAt || left.updatedAt || left.createdAt || 0))[0];
}

module.exports = {
  CodexAppServerClient,
  launchHarnessTask,
  createCodexControlThread,
  listRecentCodexCwds,
  listRecentCodexThreads,
  listAllCodexThreads,
  listCodexProjects,
  inspectCodexThread,
  normalizeThreadPath,
  projectIdempotencyKey,
  projectHasRoot,
  ensureCodexProject,
  selectLatestCodexThread,
  CONTROL_THREAD_CONFIG,
  CONTROL_THREAD_EFFORT,
  onboardingPrompt,
  taskPrompt,
  importPrompt,
  launchHarnessImport,
  openCodexDesktop,
  registerCodexDesktopProject,
  terminateCodexProcessTree,
};
