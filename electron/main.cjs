const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { HarnessStore } = require("./store.cjs");
const machine = require("./state-machine.cjs");
const { readGitStatus, setGitRemote } = require("./git.cjs");
const { readGitHubStatus } = require("./github.cjs");
const { persistProjectLedger } = require("./project-ledger.cjs");
const { importTranscript, listArchiveManifests, verifyArchiveObject } = require("./archive.cjs");
const { exportProjectBundle, importProjectBundle } = require("./project-bundle.cjs");
const { listTemplates, applyProjectTemplate } = require("./project-templates.cjs");
const { applyDecisionProposal, buildProjectContext } = require("./harness-protocol.cjs");
const { inspectProjectProfile } = require("./project-profile.cjs");
const { resolveHarnessTrustedRoot, createHarnessProtocolPathProvider, resolveBundledProtocolPath, resolveDataRoot, resolveJournalPath } = require("./runtime-paths.cjs");
const { createProjectOnboarding } = require("./project-onboarding.cjs");
const { applyHarnessImport } = require("./codex-import.cjs");
const { createErrorLog } = require("./error-log.cjs");
const { createOnboardingIpcHandler } = require("./onboarding-ipc.cjs");
const { createDiagnostics, installProcessErrorLogging } = require("./diagnostics.cjs");
const { detectCommand } = require("./command-runtime.cjs");
const { openCodexDesktop, registerCodexDesktopProject, desktopNativeBlocked, onboardingPrompt, taskPrompt, harnessProtocolReference } = require("./codex-adapter.cjs");
const { detectAgentCapabilities } = require("./agent-capabilities.cjs");
const { platformCapabilities } = require("./platform.cjs");
const { projectHealth } = require("./health.cjs");
const { readSqliteSummary } = require("./sqlite-index.cjs");
const { createTaskOpenHandler, createProjectOpenHandler } = require("./task-open.cjs");
const { createManagedWorkspace } = require("./managed-workspace.cjs");
const { createOperationExecutor } = require("./operation-ledger.cjs");
const { createSnapshotCoordinator } = require("./snapshot-coordinator.cjs");
const { createMcpControlServer } = require("./mcp-control.cjs");
const { createStandardControlOpener, needsProjectInitialization, controlPrompt } = require("./control-conversations.cjs");

const RUNTIME_REFRESH_INTERVAL_MS = 5000;
const TASK_LEASE_MS = 24 * 60 * 60 * 1000;
let store;
let mainWindow;
let windowPinned = false;
let harnessTrustedRoot;
const getHarnessProtocolPaths = createHarnessProtocolPathProvider(() => ({
  isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(),
}));
let windowPrefsPath;
let errorLog;
let diagnostics;
const activeCodexClients = new Map();
const observingCodexThreads = new Map();
const codexRegistrationInflight = new Map();
let standardControlOpener;
let onboardProject;
let runtimeRefreshTimer;
let runtimeRefreshInFlight = false;
let folderReconcileInFlight = false;
const githubCache = new Map();
const gitCache = new Map();
const GIT_CACHE_MS = 2000;
let folderReconcileBackoff;
const GITHUB_CACHE_MS = 30000;
let agentCapabilitiesCache;
let agentCapabilitiesAt = 0;
const AGENT_CACHE_MS = 30000;
let snapshotSequence = 0;
const mcpIpcHandlers = new Map();
const mcpChannelMeta = new Map();
let mcpControlServer;

function mcpPermissionForChannel(channel) {
  if (/^(?:harness:snapshot|codex:list|project:list|project:activity|archive:list|archive:verify|git:refresh|github:refresh)$/.test(channel)) return "read";
  if (/^(?:task:accept|knowledge:accept|project:remove)$/.test(channel)) return "accept_requires_user_confirmation";
  if (/^(?:project:create|project:import|task:dispatch|task:stop|project:archive|project:restore|project:sync|project:open|archive:open|window:toggle)/.test(channel)) return "prepare";
  return "mutate_pending_review";
}

function mcpCapabilityForChannel(channel) {
  if (["project:import-codex", "codex:list-conversations", "project:import-codex-conversations"].includes(channel)) {
    return {
      status: "blocked",
      capability: "desktop-native-unavailable",
      detail: "Harness 尚未接通 Desktop 原生项目和对话读取接口；该通道当前不可用。",
    };
  }
  return { status: "available", capability: "desktop-native-or-local" };
}

function registerIpcHandle(channel, handler) {
  mcpIpcHandlers.set(channel, handler);
  mcpChannelMeta.set(channel, {
    permission: mcpPermissionForChannel(channel),
    description: `Harness IPC ${channel}`,
    ...mcpCapabilityForChannel(channel),
  });
  ipcMain.handle(channel, handler);
}
// A dispatched task is persisted before its Codex Desktop 原生控制面 child returns a
// thread/process id. Snapshots can run in that small hand-off window; keep
// the launch alive long enough for attachExternalThread to bind the runtime.
const LAUNCH_RECONCILE_GRACE_MS = 120_000;
const hideAutomatedTestWindow = process.env.APH_TEST_WINDOW_HIDDEN === "1";
const archiveTracePath = process.env.APH_ARCHIVE_TRACE_PATH;

function getHarnessTrustedRoot() {
  if (!harnessTrustedRoot) {
    harnessTrustedRoot = resolveHarnessTrustedRoot({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      executablePath: process.execPath,
    });
    fs.mkdirSync(path.join(harnessTrustedRoot, "harness-projects"), { recursive: true });
  }
  return harnessTrustedRoot;
}

function getCodexWritebackSkillPath() {
  return getHarnessProtocolPaths().writebackSkillPath;
}

function getProtocolPromptPaths() {
  const paths = getHarnessProtocolPaths();
  return { ...paths, skillPath: paths.taskSkillPath, dataRoot: path.dirname(store.filePath) };
}

function traceRunArchive(stage, detail = {}) {
  if (!archiveTracePath) return;
  try {
    fs.mkdirSync(path.dirname(archiveTracePath), { recursive: true });
    fs.appendFileSync(archiveTracePath, `${JSON.stringify({ at: new Date().toISOString(), stage, ...detail })}\n`, "utf8");
  } catch {
    // Diagnostics must never change runtime behavior.
  }
}

// Harness owns two kinds of Codex connections: active Desktop 原生控制面 clients that
// own a turn, and read-only observers attached to a user-owned Desktop
// thread.  Both are live runtime evidence.  Keeping the lookup here prevents
// recovery, task controls, and UI open handlers from silently disagreeing
// about whether a thread is still being monitored.
function runtimeForThread(threadId) {
  const key = String(threadId || "").trim();
  if (!key) return undefined;
  return activeCodexClients.get(key) || observingCodexThreads.get(key);
}

function hasRuntimeForThread(threadId) {
  return Boolean(runtimeForThread(threadId));
}

function removeRuntimeForThread(threadId, expectedRuntime) {
  const key = String(threadId || "").trim();
  if (!key) return;
  if (!expectedRuntime || activeCodexClients.get(key) === expectedRuntime) activeCodexClients.delete(key);
  if (!expectedRuntime || observingCodexThreads.get(key) === expectedRuntime) observingCodexThreads.delete(key);
}

if (process.env.APH_USER_DATA) app.setPath("userData", process.env.APH_USER_DATA);

// Portable upgrades may be launched while an older Harness build is still
// open; keep the lock opt-in so the new build can migrate/reload the same data
// disk instead of silently focusing the old binary.
const singleInstanceLock = process.env.APH_ENFORCE_SINGLE_INSTANCE === "1" ? app.requestSingleInstanceLock() : true;
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function ensureProjectDirectory(projectPath) {
  const resolved = path.resolve(String(projectPath || "").trim());
  if (!resolved || resolved === path.parse(resolved).root) throw new Error("项目目录不能是磁盘根目录");
  if (fs.existsSync(resolved)) {
    if (!fs.statSync(resolved).isDirectory()) throw new Error("项目目录不是文件夹");
    return resolved;
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function persistRemovedProject(project, reason = "用户从 Harness 移出") {
  const root = path.join(store.contextRoot || path.dirname(store.filePath), "_eliminated", "projects");
  fs.mkdirSync(root, { recursive: true });
  const removedAt = new Date().toISOString();
  const safeId = String(project.id || "project").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "project";
  const target = path.join(root, `${safeId}-${removedAt.replace(/[:.]/g, "-")}.json`);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    version: 1,
    type: "ai-project-harness-project",
    exportedAt: removedAt,
    project,
    archiveRefs: [],
    removal: { removedAt, reason: String(reason || "用户从 Harness 移出").slice(0, 500) },
  };
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, target);
    return target;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw new Error(`项目移出备份写入失败：${error?.message || error}`);
  }
}

function reconcileDetachedRuns() {
  if (!store) return;
  let changed = false;
  for (const project of store.state.projects) {
    for (const task of project.tasks) {
      const run = task.run;
      if (!run || !(run.status === "starting" || run.status === "running" || (!run.status && task.status === "in_progress"))) continue;
      // A visible Desktop-owned thread is monitored through
      // observingCodexThreads, while Harness-owned turns use
      // activeCodexClients.  Treat either runtime as attached.  Also keep a
      // short recovery grace for a just-persisted binding: attachExternalThread
      // and runtime registration are separate operations, so a snapshot may
      // legitimately arrive between them.
      if (run.externalThreadId && hasRuntimeForThread(run.externalThreadId)) continue;
      const detachedSince = Date.parse(String(run.lastEventAt || run.startedAt || ""));
      if (Number.isFinite(detachedSince) && Date.now() - detachedSince < LAUNCH_RECONCILE_GRACE_MS) continue;
      // The app was restarted or the child exited before its final notification.
      // Mark it finished-but-unreconciled so the UI never lies that it is still running.
      traceRunArchive("reconcile:detached", {
        projectId: project.id,
        taskId: task.id,
        runId: run.id,
        threadId: run.externalThreadId,
        activeRuntime: Boolean(run.externalThreadId && activeCodexClients.has(String(run.externalThreadId))),
        observingRuntime: Boolean(run.externalThreadId && observingCodexThreads.has(String(run.externalThreadId))),
      });
      run.status = "disconnected";
      run.phase = "connection_lost";
      run.progress = undefined;
      run.lastEvent = "没有持有该任务的执行连接，无法确认 Agent 是否结束；请在原生 Agent 检查。";
      task.status = "awaiting_result";
      changed = true;
    }
  }
  if (changed) store.write();
}

function collectExpiredTaskLeaseCandidates(at = Date.now()) {
  const candidates = [];
  for (const project of store?.state?.projects || []) {
    for (const task of project.tasks || []) {
      if (!task.run || !["in_progress", "awaiting_result"].includes(task.status)) continue;
      if (!["starting", "running"].includes(String(task.run.status || "").toLowerCase())) continue;
      const status = String(task.run.status || "").toLowerCase();
      const startedAt = Date.parse(String(task.run.leaseStartedAt || (status === "running" || (task.run.externalThreadId && (task.run.externalTurnId || task.run.processId)) ? task.run.startedAt : "")));
      if (!Number.isFinite(startedAt) || at - startedAt < TASK_LEASE_MS) continue;
      candidates.push({ projectId: project.id, taskId: task.id, threadId: task.run.externalThreadId });
    }
  }
  return candidates;
}

function reconcileTaskLeases(reason = "任务超过 24 小时 lease") {
  if (!store) return [];
  const candidates = collectExpiredTaskLeaseCandidates();
  if (!candidates.length) return [];
  for (const candidate of candidates) {
    const threadId = candidate.threadId;
    const runtime = threadId ? runtimeForThread(threadId) : undefined;
    if (!runtime) continue;
    runtime.intentionalStop = true;
    try { runtime.client.close(new Error(reason)); } catch {}
    removeRuntimeForThread(threadId, runtime);
  }
  let expired = [];
  store.update((state) => {
    expired = machine.expireTaskLeases(state, Date.now(), TASK_LEASE_MS, reason);
  });
  return expired;
}

async function buildSnapshotNow({ forceGithub = false, forceGit = false } = {}) {
  // Read-only Desktop observers also mutate durable Harness state through
  // their monitor callbacks. Do not reload the file over those in-memory
  // updates while an observer is live.
  const externalStateReloaded = activeCodexClients.size === 0
    && observingCodexThreads.size === 0
    && (store.reloadExternal?.() || false);
  if (externalStateReloaded) {
    // Another Harness Desktop process may have changed project metadata; its GitHub cache is
    // still safe, but stale project paths should be checked again.
    githubCache.clear();
    gitCache.clear();
  }
  reconcileDetachedRuns();
  const gitEntries = await Promise.all(
    store.state.projects.map(async (project) => {
      const key = project.path ? path.resolve(project.path).toLowerCase() : "";
      const cached = gitCache.get(project.id);
      if (!forceGit && cached?.key === key && Date.now() - cached.at < GIT_CACHE_MS) return [project.id, cached.value];
      const value = project.path ? await readGitStatus(project.path) : {
        available: false,
        error: "项目路径尚未设置",
        detail: "这是一个空白项目；绑定本地目录后才会读取 Git。",
        checkedAt: new Date().toISOString(),
      };
      gitCache.set(project.id, { key, at: Date.now(), value });
      return [project.id, value];
    }),
  );
  const changed = gitEntries.some(([projectId, git]) => {
    const project = store.state.projects.find((item) => item.id === projectId);
    const previous = project?.gitSnapshot;
    if (!previous) return true;
    const comparable = (value) => {
      if (!value) return value;
      const clone = { ...value };
      delete clone.checkedAt;
      return clone;
    };
    return JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(git));
  });
  if (changed) {
    store.update((state) => {
      for (const [projectId, git] of gitEntries) machine.recordGitSnapshot(state, projectId, git);
    });
  }
  const githubEntries = await Promise.all(store.state.projects.map(async (project) => {
    if (!project.path) return [project.id, {
      available: false,
      error: "项目路径尚未设置",
      detail: "这是一个空白项目；绑定本地目录后才会读取 GitHub。",
      checkedAt: new Date().toISOString(),
    }];
    const key = path.resolve(project.path).toLowerCase();
    const cached = githubCache.get(key);
    if (!forceGithub && cached && Date.now() - cached.at < GITHUB_CACHE_MS) return [project.id, cached.value];
    const value = await readGitHubStatus(project.path, { includeDetails: forceGithub }).catch((error) => ({
      available: false,
      error: "GitHub 状态读取失败",
      detail: String(error?.message || error),
      checkedAt: new Date().toISOString(),
    }));
    githubCache.set(key, { at: Date.now(), value });
    return [project.id, value];
  }));
  const github = Object.fromEntries(githubEntries);
  const comparableGithub = (value) => {
    if (!value) return value;
    const clone = JSON.parse(JSON.stringify(value));
    delete clone.checkedAt;
    return clone;
  };
  const githubChanged = githubEntries.some(([projectId, value]) => {
    const project = store.state.projects.find((item) => item.id === projectId);
    return JSON.stringify(comparableGithub(project?.githubSnapshot || null)) !== JSON.stringify(comparableGithub(value || null));
  });
  if (githubChanged) {
    store.update((state) => {
      for (const [projectId, value] of githubEntries) {
        const project = state.projects.find((item) => item.id === projectId);
        if (project) project.githubSnapshot = value;
      }
    });
  }
  // Keep the detached, bounded project whitepaper current without writing
  // into the user's code repository. The ledger lives on the Harness data
  // disk and is therefore safe to regenerate on every accepted state change.
  if (store.contextRoot && persistProjectLedger(store.state, store.contextRoot, { gitByProject: Object.fromEntries(gitEntries), githubByProject: github })) {
    store.write();
  }
  const health = Object.fromEntries(store.state.projects.map((project) => [project.id, projectHealth(project, { git: Object.fromEntries(gitEntries)[project.id], github: github[project.id], sqlite: store.sqliteStatus })]));
  const overview = Object.fromEntries(store.state.projects.map((project) => [project.id, machine.projectOverview(project)]));
  if (!agentCapabilitiesCache || Date.now() - agentCapabilitiesAt > AGENT_CACHE_MS) {
    agentCapabilitiesCache = await detectAgentCapabilities();
    agentCapabilitiesAt = Date.now();
  }
  const agents = agentCapabilitiesCache;
  return {
    sequence: ++snapshotSequence,
    state: store.state,
    git: Object.fromEntries(gitEntries),
    github,
    health,
    overview,
    window: { alwaysOnTop: windowPinned },
    archives: Object.fromEntries(store.state.projects.map((project) => [project.id, listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId: project.id })])),
    agents: { ...agents, codex: { ...agents.codex, bridge: agents.codex.native ? "desktop-native-protocol" : "unavailable" } },
    platform: process.platform,
    platformCapabilities: platformCapabilities(process.platform),
    storage: { root: path.dirname(store.filePath), statePath: store.filePath, journalPath: store.journalPath, archiveRoot: path.join(store.contextRoot || path.dirname(store.filePath), "archive"), projectWorkspaceRoot: path.join(getHarnessTrustedRoot(), "harness-projects"), sqlitePath: store.sqlitePath, sqlite: store.sqliteStatus || (store.sqlitePath ? readSqliteSummary(store.sqlitePath) : { available: false }) },
  };
}

// IPC actions, the runtime heartbeat and external Desktop reloads can all ask
// for a snapshot at once. Serialize the expensive projection so an older
// asynchronous response cannot arrive after a newer state mutation and make
// the renderer appear to roll back.
const buildSnapshot = createSnapshotCoordinator(buildSnapshotNow);

async function publishRuntimeSnapshot(event) {
  const snapshot = await buildSnapshot();
  if (!mainWindow?.isDestroyed?.()) mainWindow.webContents.send("agent:runtime-update", { snapshot, event });
  return snapshot;
}

function startRuntimeRefresh() {
  if (runtimeRefreshTimer) return;
  runtimeRefreshTimer = setInterval(() => {
    if (runtimeRefreshInFlight || mainWindow?.isDestroyed?.()) return;
    runtimeRefreshInFlight = true;
    void (async () => {
      await reconcileCodexProjectFolders();
      const expired = reconcileTaskLeases();
      return publishRuntimeSnapshot({ type: expired.length ? "task.lease-expired" : "runtime.auto-refresh", detail: expired.length ? `${expired.length} 个任务已超时` : undefined });
    })()
      .catch((error) => {
        try {
          errorLog?.capture(error, { operation: "runtime-refresh", stage: "heartbeat" });
        } catch {
          // A refresh failure must never become a renderer or main-process failure.
        }
      })
      .finally(() => {
        runtimeRefreshInFlight = false;
      });
  }, RUNTIME_REFRESH_INTERVAL_MS);
  runtimeRefreshTimer.unref?.();
}

function stopRuntimeRefresh() {
  if (!runtimeRefreshTimer) return;
  clearInterval(runtimeRefreshTimer);
  runtimeRefreshTimer = undefined;
}

/** Register a project through the Codex Desktop protocol. */
async function ensureDesktopProjectRegistration(project, codex, { force = false, trustedRoot } = {}) {
  if (!project?.path || !codex?.installed) throw new Error("项目目录和 Codex Desktop 都是建立 Project 所必需的");
  // Desktop is the owner of its live Project registry. This call only emits
  // the public registration deep link and leaves sidebar verification pending.
  const currentId = String(project.codexProjectId || "").trim();
  // An Desktop 原生控制面 Project id (or a local JSON entry) is not proof that the
  // already-running Desktop renderer has loaded the Project into its sidebar.
  // Keep this result explicitly unverified until a real Desktop control plane
  // reports the live ProjectsManager entry.
  if (!force && currentId && !currentId.startsWith("local-")) {
    return {
      registered: false,
      desktopVerified: false,
      projectId: currentId,
      state: "desktop-restart-required",
      detail: "官方 Project 已存在，但当前 Codex Desktop 侧栏没有实时可见性证据；Harness 不把它标记为已显示，请在现有 Desktop 窗口刷新或手动核对。",
    };
  }
  const key = project.id;
  if (codexRegistrationInflight.has(key)) return codexRegistrationInflight.get(key);
  const promise = (async () => {
    if (typeof registerCodexDesktopProject !== "function") throw new Error("当前 Codex 适配器缺少 Desktop Project 注册能力");
    const desktopBootstrap = await registerCodexDesktopProject({
      projectPath: project.path,
      openExternal: (uri) => shell.openExternal(uri),
      route: "legacy",
    });
    return {
      registered: false,
      desktopVerified: false,
      state: "desktop-restart-required",
       detail: "已通过 Codex Desktop 原生 Project 深链发起注册；侧栏可见性由 Desktop 自己确认。",
      opened: Boolean(desktopBootstrap?.opened),
      ...(desktopBootstrap?.error ? { openError: desktopBootstrap.error } : {}),
      capability: "desktop-native-project-deep-link-only",
      route: desktopBootstrap?.route,
      uri: desktopBootstrap?.uri,
    };
  })().finally(() => codexRegistrationInflight.delete(key));
  codexRegistrationInflight.set(key, promise);
  return promise;
}

function markCodexDesktopRegistered(projectId, officialProjectId, { desktopVerified = false, verificationMethod } = {}) {
  if (!store || !officialProjectId) return;
  const project = machine.getProject(store.state, projectId);
  // A local state-file lookup is deliberately not used as registration
  // evidence. Only an injected/live Desktop ProjectsManager bridge may set
  // desktopVerified; normal Desktop 原生控制面/deep-link flows remain pending.
  const registered = desktopVerified === true;
  store.update((state) => {
    machine.setCodexProjectSync(state, projectId, {
      officialProjectId,
      ...(registered ? { state: "desktop-registered", detail: "Desktop 原生项目已完成实时核验。" }
        : { state: "desktop-restart-required", detail: `官方 Project 与控制对话已写入，但当前运行中的 Codex Desktop 尚未提供侧栏可见性证据；请在现有窗口刷新或手动核对。${verificationMethod ? `（核验方式：${String(verificationMethod).slice(0, 80)}）` : ""}` }),
    });
  });
}

async function ensureProjectControlPlane(project, codex, { verifyProject = true, openThreads = false, openRoles = ["review", "cto"], registerDesktop = true, forceRegistration = false, forceOpenThreads = false } = {}) {
  if (!project?.path) throw new Error("项目目录未绑定，无法建立 Codex 控制面");
  if (!codex?.installed) throw new Error("未检测到 Codex Desktop，无法建立原生控制面");
  const registration = registerDesktop
    ? await ensureDesktopProjectRegistration(project, codex, { force: forceRegistration, trustedRoot: getHarnessTrustedRoot() })
    : undefined;
  const opened = registration?.opened ? [{ role: "project", opened: true, capability: registration.capability, uri: registration.uri }] : [];
  if (registration?.opened) await publishRuntimeSnapshot({ type: "codex.project.deep-link-opened", detail: registration.uri });
  if (openThreads) {
    if (needsProjectInitialization(machine.getProject(store.state, project.id))) {
      await onboardProject(project.name, { projectId: project.id });
    }
    const controls = await openStandardControlConversations(project.id, { roles: openRoles, force: forceOpenThreads });
    opened.push(...controls.opened);
  }
  return {
    codexProjectId: String(registration?.projectId || project.codexProjectId || "").trim() || undefined,
    controls: [],
    opened,
    desktopNativePending: true,
    registration,
    ctoThreadId: machine.getProject(store.state, project.id).sessions?.find(session => session.role === "cto")?.externalThreadId,
    reviewThreadId: machine.getProject(store.state, project.id).sessions?.find(session => session.role === "review")?.externalThreadId,
  };
}

async function openStandardControlConversations(projectId, options = {}) {
  standardControlOpener ||= createStandardControlOpener({ store,
    openExternal: uri => shell.openExternal(uri), copyPrompt: text => clipboard.writeText(text) });
  return standardControlOpener(projectId, options);
}

async function ensureProjectFolder(project, codex) {
  if (!project?.path || !codex?.installed) return undefined;
  const registration = await ensureDesktopProjectRegistration(project, codex, { force: false, trustedRoot: getHarnessTrustedRoot() });
  return registration?.projectId;
}

async function reconcileCodexProjectFolders() {
  // Desktop owns its live project registry. Harness has no background project
  // repair path and never writes a compatibility cache from the heartbeat.
  return undefined;
}

async function provisionMissingControlThreads() {
  // Control conversations are created only by an explicit Desktop handoff.
  return undefined;
}

function registerVisibleThreadRuntime({ threadId } = {}) {
  // Desktop owns the conversation and does not expose a public observer. Keep
  // this compatibility boundary inert so a native handoff never starts a
  // hidden reader or invents completion evidence.
  return { threadId: String(threadId || ""), native: true, awaitingUser: true };
}

function emitImportProgress(event, stage, progress, label, detail) {
  if (event?.sender?.isDestroyed?.()) return;
  try {
    event?.sender?.send?.("project:onboarding-progress", {
      stage,
      label,
      ...(detail ? { detail: String(detail).slice(0, 500) } : {}),
    });
  } catch {
    // A renderer can close the dialog while the Agent is being started. The
    // durable import task remains valid even when progress delivery fails.
  }
}

async function archiveCodexSourceThreads(projectId, taskId, threads, { resume = false } = {}) {
  const indexedThreads = (Array.isArray(threads) ? threads : []).filter((thread) => thread?.path);
  if (!indexedThreads.length) return { archived: 0, failed: 0 };
  const dataRoot = store.contextRoot || path.dirname(store.filePath);
  const priorSourceIds = new Set(resume
    ? listArchiveManifests(dataRoot, { projectId }).filter((item) => item.sourceType === "codex-thread" && item.sourceId).map((item) => String(item.sourceId))
    : []);
  const availableThreads = indexedThreads.filter((thread) => fs.existsSync(thread.path));
  const sourceThreads = availableThreads.filter((thread) => !priorSourceIds.has(String(thread.id)));
  const missingThreads = indexedThreads.filter((thread) => !fs.existsSync(thread.path));
  const failedThreadIds = missingThreads.map((thread) => String(thread.id));
  const alreadyArchivedCount = indexedThreads.filter((thread) => priorSourceIds.has(String(thread.id))).length;
  const missingCount = missingThreads.length;
  try {
    store.update((state) => {
      const project = machine.getProject(state, projectId);
      project.codexImport = { ...(project.codexImport || {}), archiveStatus: "running", sourceThreadCount: indexedThreads.length, archiveMissingCount: missingCount };
    });
  } catch {}
  let archivedCount = alreadyArchivedCount;
  let failedCount = missingCount;
  for (const thread of sourceThreads) {
    try {
      const archived = await importTranscript(thread.path, dataRoot, {
        projectId,
        label: `Codex · ${thread.name || thread.id}`,
        sourceId: thread.id,
        sourceType: "codex-thread",
      });
      archivedCount += 1;
      store.update((state) => {
        const project = machine.getProject(state, projectId);
        project.archiveManifests ||= [];
        if (!project.archiveManifests.some((item) => item.sha256 === archived.manifest.sha256)) {
          project.archiveManifests.unshift({ ...archived.manifest, manifestPath: archived.manifestPath });
        }
        project.codexImport = { ...(project.codexImport || {}), archivedThreadCount: archivedCount, archiveStatus: "running" };
      });
    } catch (error) {
      failedCount += 1;
      failedThreadIds.push(String(thread.id));
      try { errorLog?.capture(error, { operation: "codex-import-source-archive", stage: "streaming", context: { projectId, taskId, threadId: thread.id } }); } catch {}
    }
  }
  store.update((state) => {
    const project = machine.getProject(state, projectId);
    const timestamp = new Date().toISOString();
    project.codexImport = {
      ...(project.codexImport || {}),
      archiveStatus: failedCount ? "partial" : "completed",
      archivedThreadCount: archivedCount,
      archiveFailureCount: failedCount,
      archiveCompletedAt: timestamp,
      archiveQueue: failedCount ? indexedThreads.filter((thread) => failedThreadIds.includes(String(thread.id))).map(({ id, name, path: sourcePath }) => ({ id, name, path: sourcePath })) : [],
    };
    project.events ||= [];
    project.events.unshift({ id: require("node:crypto").randomUUID(), type: "codex.project.threads.archived", at: timestamp, detail: `${archivedCount}/${indexedThreads.length} 个关联对话已无损归档${missingCount ? `；${missingCount} 个源 rollout 缺失` : ""}` });
    project.updatedAt = timestamp;
  });
  await publishRuntimeSnapshot({ type: "codex.project.threads.archived", detail: `${archivedCount}/${indexedThreads.length}` });
  return { archived: archivedCount, failed: failedCount };
}

async function resumePendingCodexArchives() {
  if (!store) return;
  const pending = store.state.projects
    .filter((project) => project.codexImport?.archiveStatus === "running" && Array.isArray(project.codexImport.archiveQueue) && project.codexImport.archiveQueue.length)
    .map((project) => ({ projectId: project.id, taskId: project.codexImport.taskId, threads: project.codexImport.archiveQueue }));
  for (const item of pending) {
    try {
      await archiveCodexSourceThreads(item.projectId, item.taskId, item.threads, { resume: true });
    } catch (error) {
      try { errorLog?.capture(error, { operation: "codex-import-source-archive", stage: "resume", context: { projectId: item.projectId, taskId: item.taskId } }); } catch {}
    }
  }
}

async function handoffVisibleCodexImport({ codex, project, projectId, taskId, title, prompt, selectedThreadCount }) {
  clipboard.writeText(prompt);
  store.update((state) => machine.prepareUserAgentTask(state, projectId, taskId));
  const navigation = await openCodexDesktop("", project.path, { openExternal: (uri) => shell.openExternal(uri) });
  store.update((state) => {
    const target = machine.getProject(state, projectId);
    target.codexImport = {
      ...(target.codexImport || {}),
      status: "awaiting_user",
      detail: "实际整理提示词已保存并复制到剪贴板；请在这条原生 Codex 对话中粘贴并发送，Harness 不会另起隐藏执行器。",
    };
  });
  return {
    projectId,
    taskId,
    threadId: undefined,
    status: "awaiting_user",
    userActionRequired: true,
    executionOwner: "codex-desktop",
    conversationPrompt: prompt,
    selectedThreadCount,
    desktopOpened: Boolean(navigation.opened),
    desktopError: navigation.error,
    navigation,
  };
}

/**
 * Resolve an official Codex Project by approximate name and launch a bounded
 * read-only hydration turn. This path is intentionally separate from the
 * legacy local-folder onboarding flow: it never scans recent CWDs and never
 * infers progress from filesystem mtimes.
 */
async function importCodexProjectFromName() { throw desktopNativeBlocked("导入既有 Codex Project", "Harness 尚未接通 Desktop 原生接口的 Project/thread 列表；当前只能连接本地目录"); }

async function listCodexConversationPickerIndex() { throw desktopNativeBlocked("读取 Codex 对话索引", "Harness 尚未接通 Desktop 原生接口的对话列表"); }

async function importCodexConversations() { throw desktopNativeBlocked("导入已选 Codex 对话", "Harness 尚未接通 Desktop 原生接口的对话选择和读取"); }

async function connectHarnessProject(projectId, payload = {}) {
  let project = machine.getProject(store.state, projectId);
  let projectPath = String(payload.path || payload.projectPath || project.path || "").trim();
  if (!projectPath) {
    projectPath = createManagedWorkspace({ trustedRoot: getHarnessTrustedRoot(), name: project.name }).path;
    store.update((state) => machine.updateProjectContract(state, projectId, { path: projectPath }));
    project = machine.getProject(store.state, projectId);
  } else {
    projectPath = ensureProjectDirectory(projectPath);
    if (!project.path || path.resolve(project.path).toLowerCase() !== projectPath.toLowerCase()) {
      store.update((state) => machine.updateProjectContract(state, projectId, { path: projectPath }));
      project = machine.getProject(store.state, projectId);
    }
  }
  let stage = "codex-detect";
  try {
    const codex = await detectCommand("codex");
    if (!codex.installed) throw Object.assign(new Error("未检测到 Codex，项目已保留为可重试的本地项目"), { code: "CODEX_MISSING" });
    stage = "control-plane";
    if (needsProjectInitialization(project)) {
      const result = await onboardProject(project.name, { projectId });
      return { ...result, initializationRequired: true, standardControls: { opened: [], skipped: 'initialization-required' } };
    }
    const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true, openRoles: payload.openRoles || ["review", "cto"] });
    markCodexDesktopRegistered(project.id, plane.codexProjectId);
    store.update((state) => {
      const target = machine.getProject(state, project.id);
      target.source = { kind: "connected", label: "已连接 Codex Desktop" };
      target.codexProjectId = plane.codexProjectId;
      target.codexConnectedAt = new Date().toISOString();
      target.codexSyncError = undefined;
    });
    return { projectId: project.id, codexProjectId: plane.codexProjectId, ctoThreadId: plane.ctoThreadId, reviewThreadId: plane.reviewThreadId, desktopOpened: plane.opened.length > 0 && plane.opened.every((item) => item.opened), standardControls: { opened: plane.opened.filter(item => item.role !== "project") } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.update((state) => machine.recordCodexProjectSyncError(state, project.id, message, stage));
    const wrapped = new Error(`项目仍保留，但 Codex 连接未完成：${message}`);
    wrapped.code = error?.code || "CODEX_CONNECTION_INCOMPLETE";
    wrapped.projectId = project.id;
    throw wrapped;
  }
}

function registerIpc() {
  registerIpcHandle("harness:snapshot", buildSnapshot);

  const operationActions = createOperationExecutor({
    state: store.state,
    persist: () => store.write(),
    handlers: {
      "project.create-blank": async (payload) => {
        const project = store.update((state) => machine.createBlankProject(state, payload));
        return { projectId: project.id };
      },
      "project.connect": async (payload) => connectHarnessProject(payload.projectId, payload),
    },
  });

  const openTask = createTaskOpenHandler({
    store,
    machine,
    detectCodex: () => detectCommand("codex"),
    openDesktop: openCodexDesktop,
    buildSnapshot,
    openExternal: (uri) => shell.openExternal(uri),
    openWorkspace: (projectPath) => shell.openPath(projectPath),
    isThreadActive: (threadId) => hasRuntimeForThread(threadId),
  });
  const openProject = createProjectOpenHandler({
    store,
    machine,
    detectCodex: () => detectCommand("codex"),
    openDesktop: openCodexDesktop,
    buildSnapshot,
    openExternal: (uri) => shell.openExternal(uri),
    isThreadActive: (threadId) => hasRuntimeForThread(threadId),
  });

  onboardProject = createProjectOnboarding({
    store,
    getCodex: () => detectCommand("codex"),
    copyPrompt: text => clipboard.writeText(text),
    skillPath: getHarnessProtocolPaths().taskSkillPath,
    writebackSkillPath: getHarnessProtocolPaths().writebackSkillPath,
    taskStatusSchemaPath: getHarnessProtocolPaths().taskStatusSchemaPath,
    protocolPaths: getProtocolPromptPaths(),
    openExternal: (uri) => shell.openExternal(uri),
    ensureProjectFolder: async (input) => {
      return ensureDesktopProjectRegistration(
        { id: `onboarding:${input.projectPath}`, path: input.projectPath, name: input.projectName },
        { installed: true, native: true },
        { force: true, trustedRoot: getHarnessTrustedRoot() },
      );
    },
    buildSnapshot,
  });
  const handleOnboarding = createOnboardingIpcHandler({ onboardProject, errorLog });
  registerIpcHandle("project:add-by-name", handleOnboarding);
  // Blank creation creates the durable local Project and then hands the user
  // to the Codex Desktop project deep link.
  registerIpcHandle("project:create-blank", async (event, input) => {
    const payload = typeof input === "string" ? { name: input } : (input || {});
    let projectId;
    emitImportProgress(event, "creating_project", 10, "正在建立 Harness 项目", String(payload.name || ""));
    if (payload.operationId) {
      const operation = await operationActions.execute({
        operationId: String(payload.operationId),
        actionId: "project.create-blank",
        targetFingerprint: String(payload.targetFingerprint || `blank:${String(payload.name || "").normalize("NFKC").trim().toLowerCase()}`),
        confirmedAt: payload.confirmedAt,
        payload,
      });
      projectId = operation.result.projectId;
    } else {
      projectId = store.update((state) => machine.createBlankProject(state, payload)).id;
    }
    emitImportProgress(event, "creating_codex_project", 34, "正在通过 Desktop 原生深链注册 Project", String(payload.name || ""));
    const connected = await connectHarnessProject(projectId, { ...payload, openRoles: ["review", "cto"] });
    emitImportProgress(event, connected.initializationRequired ? "initializing" : "opening_cto", 82,
      connected.initializationRequired ? "已准备初始化，等待 Desktop 执行和回写" : "已请求 Desktop 标准对话草稿");
    const snapshot = await buildSnapshot();
    emitImportProgress(event, "completed", 100, "项目已创建，请在 Desktop 中继续");
    return { ...connected, blankOnly: true, snapshot };
  });
  registerIpcHandle("project:connect-codex", async (_event, projectId, input = {}) => {
    const payload = { ...input, projectId };
    const operationId = String(input.operationId || "").trim();
    const result = operationId
      ? await operationActions.execute({ operationId, actionId: "project.connect", targetFingerprint: String(input.targetFingerprint || `project:${projectId}`), confirmedAt: input.confirmedAt, payload })
      : { result: await connectHarnessProject(projectId, payload) };
    return { ...result.result, snapshot: await buildSnapshot() };
  });
  registerIpcHandle("project:create-connected", async (_event, input) => {
    const payload = input && typeof input === "object" ? input : { name: input };
    const name = String(payload.name || payload.title || "").trim();
    if (!name) throw new Error("Project name is required");
    let projectPath = String(payload.path || payload.projectPath || "").trim();
    if (!projectPath) {
      projectPath = createManagedWorkspace({ trustedRoot: getHarnessTrustedRoot(), name }).path;
    } else projectPath = ensureProjectDirectory(projectPath);
    const project = store.update((state) => {
      const duplicate = state.projects.find((item) => item.path && path.resolve(item.path).toLowerCase() === projectPath.toLowerCase());
      if (duplicate) throw new Error(`项目目录已存在于 Harness：${duplicate.name}`);
      return machine.createBlankProject(state, {
        ...payload,
        name,
        path: projectPath,
      });
    });
    try {
      const connected = await connectHarnessProject(project.id, { ...payload, path: projectPath, openRoles: ["review", "cto"] });
      return {
        ...connected,
        snapshot: await buildSnapshot(),
      };
    } catch (error) {
      throw error;
    }
  });
  // Codex import is a separate path from local-folder onboarding. It resolves
  // an official Project by approximate name, launches one read-only hydration
  // turn, and leaves the structured result behind a user review gate.
  registerIpcHandle("project:import-codex", (event, input) => importCodexProjectFromName(event, input || {}));
  registerIpcHandle("codex:list-conversations", () => listCodexConversationPickerIndex());
  registerIpcHandle("project:import-codex-conversations", (event, input) => importCodexConversations(event, input || {}));
  registerIpcHandle("diagnostics:show-error-log", () => diagnostics.showErrorLog());
  registerIpcHandle("diagnostics:report-renderer-error", (_event, details) => diagnostics.reportRendererError(details));

  registerIpcHandle("project:select", async (_event, projectId) => {
    store.update((state) => {
      machine.getProject(state, projectId);
      state.selectedProjectId = projectId;
    });
    return buildSnapshot();
  });

  registerIpcHandle("task:create", async (_event, projectId, input) => {
    store.update((state) => machine.createTask(state, projectId, input || {}));
    return buildSnapshot();
  });

  // Bind an already materialized, Desktop-owned Codex thread to a freshly
  // dispatched Harness task. This is used for reconnects and fixed real-smoke
  // fixtures; it never creates a provider thread or starts a hidden turn.
  registerIpcHandle("task:attach-visible-thread", async (_event, projectId, taskId, input = {}) => {
    const project = machine.getProject(store.state, projectId);
    const threadId = String(input.threadId || "").trim();
    if (!threadId) throw new Error("可见 Codex threadId 不能为空");
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法绑定可见对话");
    let attached;
    try {
      attached = store.update((state) => {
        const dispatched = machine.dispatchTask(state, projectId, taskId);
        return machine.attachUserInvokedThread(state, projectId, taskId, {
          threadId,
          projectId: project.codexProjectId,
          userPrompt: taskPrompt(machine.getProject(state, projectId), dispatched.task, input.userPrompt || dispatched.missionPacket, getProtocolPromptPaths()),
          desktopOpened: true,
        });
      });
    } catch (error) {
      // Binding is another hand-off boundary.  If dispatch succeeded but the
      // supplied visible thread could not be attached, clean the durable run
      // immediately instead of leaving an in-progress task with no usable
      // external identity.  The caller still receives the original error.
      try {
        store.update((state) => {
          const current = machine.getProject(state, projectId).tasks.find((item) => item.id === taskId);
          if (current?.run && !current.run.externalThreadId) {
            machine.markExternalLaunchFailed(state, projectId, taskId, error?.message || error);
          }
        });
      } catch {
        // Preserve the attach error for the IPC boundary below.
      }
      throw error;
    }
    registerVisibleThreadRuntime({
      cwd: project.path,
      threadId,
      ignoreTurnId: input.ignoreTurnId,
      projectId,
      taskId,
    });
    return { snapshot: await buildSnapshot(), task: attached, threadId, reused: true };
  });

  registerIpcHandle("task:dispatch", async (_event, projectId, taskId) => {
    try {
      const project = machine.getProject(store.state, projectId);
      const task = project.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Task not found");
      if (task.workstream === "codex-project-import") {
        throw desktopNativeBlocked("导入 Codex 对话", "Desktop 原生接口未公开历史对话读取面；请在 Desktop 中直接发起整理对话");
      }
      if (task.agent === "claude" || task.agent === "hermes") {
        const prepared = store.update((state) => machine.prepareUserAgentTask(state, projectId, taskId));
        clipboard.writeText(prepared.missionPacket);
        return { snapshot: await buildSnapshot(), missionPacket: prepared.missionPacket, userActionRequired: true, agent: task.agent };
      }
      if (task.agent !== "codex") throw new Error("Unsupported agent");
      const codex = await detectCommand("codex");
      if (!codex.installed) throw new Error("未检测到 Codex，无法创建原生可见任务");
      await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: false });
      const latestProject = machine.getProject(store.state, projectId);
      const prepared = store.update((state) => machine.prepareUserAgentTask(state, projectId, taskId));
      const userPrompt = taskPrompt(latestProject, prepared.task, prepared.missionPacket, getProtocolPromptPaths());
      store.update(state => {
        machine.getProject(state, projectId).tasks.find(item => item.id === taskId).run.userPrompt = userPrompt;
      });
      clipboard.writeText(userPrompt);
      const navigation = await openCodexDesktop("", latestProject.path, { prompt: userPrompt, openExternal: (uri) => shell.openExternal(uri) });
      return {
        snapshot: await buildSnapshot(),
        missionPacket: userPrompt,
        userActionRequired: true,
        agent: "codex",
        executionOwner: "codex-desktop",
        navigation,
        message: navigation.opened ? "已通过 Desktop 原生深链打开新对话；任务包已复制，请在 Desktop 中发送。" : "任务包已复制，但 Desktop 原生新对话未打开。",
      };
    } catch (error) {
      let errorId;
      try { errorId = errorLog?.capture(error, { operation: "task:dispatch", stage: "preflight", context: { projectId, taskId } })?.id; } catch {}
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(errorId ? message + "\n错误编号：" + errorId : message);
    }
  });
  registerIpcHandle("task:submit-result", async (_event, projectId, taskId, input) => {
    store.update((state) => {
      machine.submitTaskResult(state, projectId, taskId, input || {});
      // Manual submission is a recovery path. It follows the same automatic
      // Review Agent policy as a real harness-result, so the user is never
      // left with a misleading “请确认” gate for ordinary operation.
      const submittedTask = machine.getProject(state, projectId).tasks.find((item) => item.id === taskId);
      if (process.env.APH_AUTO_REVIEW === "1" || submittedTask?.reviewMode === "auto") machine.autoReviewTaskResult(state, projectId, taskId);
    });
    return buildSnapshot();
  });

  registerIpcHandle("task:stop", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    const threadId = task?.run?.externalThreadId;
  const runtime = threadId ? runtimeForThread(threadId) : undefined;
    if (runtime) {
      runtime.intentionalStop = true;
      try { runtime.client.close(new Error("任务由用户停止")); } catch {}
    removeRuntimeForThread(threadId, runtime);
    }
    store.update((state) => machine.stopTask(state, projectId, taskId));
    return buildSnapshot();
  });

  registerIpcHandle("task:accept", async (_event, projectId, taskId) => {
    let openStandardControls = false;
    store.update((state) => {
      const project = machine.getProject(state, projectId);
      const task = project.tasks.find((item) => item.id === taskId);
      if (task?.workstream === "codex-project-import") {
        // Apply the bounded candidate only after the user explicitly accepts
        // it. Work on a detached draft so any validation/runtime failure
        // leaves the live state byte-for-byte unchanged.
        if (!task.importCandidate) throw new Error("没有可接受的 Codex 导入候选");
        const draft = JSON.parse(JSON.stringify(state));
        const draftTask = machine.getProject(draft, projectId).tasks.find((item) => item.id === taskId);
        applyHarnessImport(draft, projectId, draftTask.importCandidate);
        machine.acceptCodexImportCandidate(draft, projectId, taskId);
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, draft);
        return;
      }
      machine.acceptTaskResult(state, projectId, taskId);
      openStandardControls = task?.workstream === "project-onboarding";
    });
    const standardControls = openStandardControls
      ? await openStandardControlConversations(projectId)
      : undefined;
    return { ...(await buildSnapshot()), ...(standardControls ? { standardControls } : {}) };
  });

  registerIpcHandle("task:request-changes", async (_event, projectId, taskId) => {
    const currentTask = machine.getProject(store.state, projectId).tasks.find((item) => item.id === taskId);
    if (currentTask?.workstream === "codex-project-import" && currentTask.run?.externalThreadId) {
      const runtime = runtimeForThread(currentTask.run.externalThreadId);
      if (runtime) {
        runtime.intentionalStop = true;
        try { runtime.client.close(new Error("用户要求重新盘点 Codex Project")); } catch {}
        removeRuntimeForThread(currentTask.run.externalThreadId, runtime);
      }
    }
    store.update((state) => {
      const project = machine.getProject(state, projectId);
      const task = project.tasks.find((item) => item.id === taskId);
      if (task?.workstream === "codex-project-import") machine.requestCodexImportChanges(state, projectId, taskId);
      else machine.requestChanges(state, projectId, taskId);
    });
    return buildSnapshot();
  });

  registerIpcHandle("task:reject", async (_event, projectId, taskId, reason) => {
    const currentTask = machine.getProject(store.state, projectId).tasks.find((item) => item.id === taskId);
    if (currentTask?.workstream === "codex-project-import" && currentTask.run?.externalThreadId) {
      const runtime = runtimeForThread(currentTask.run.externalThreadId);
      if (runtime) {
        runtime.intentionalStop = true;
        try { runtime.client.close(new Error("用户拒绝 Codex 项目导入")); } catch {}
        removeRuntimeForThread(currentTask.run.externalThreadId, runtime);
      }
    }
    store.update((state) => {
      const project = machine.getProject(state, projectId);
      const task = project.tasks.find((item) => item.id === taskId);
      if (task?.workstream === "codex-project-import") machine.rejectCodexImportCandidate(state, projectId, taskId, reason);
      else machine.rejectTaskResult(state, projectId, taskId, reason);
    });
    return buildSnapshot();
  });

  // The registered channel is equivalent to ipcMain.handle("knowledge:accept", acceptKnowledgeCandidate);
  registerIpcHandle("knowledge:accept", async (_event, projectId, candidateId) => {
    store.update((state) => machine.acceptKnowledgeCandidate(state, projectId, candidateId));
    return buildSnapshot();
  });

  // The registered channel is equivalent to ipcMain.handle("knowledge:reject", rejectKnowledgeCandidate);
  registerIpcHandle("knowledge:reject", async (_event, projectId, candidateId, reason) => {
    store.update((state) => machine.rejectKnowledgeCandidate(state, projectId, candidateId, reason));
    return buildSnapshot();
  });

  registerIpcHandle("mission:copy", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task || !task.run) throw new Error("Task has no active run");
    const session = project.sessions.find((item) => item.id === task.run.sessionId);
    if (!session) throw new Error("Session not found");
    const packet = task.run?.userPrompt || machine.buildMissionPacket(project, task, session);
    clipboard.writeText(packet);
    return { copied: true, packet };
  });

  registerIpcHandle("git:refresh", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    return buildSnapshot({ forceGithub: true });
  });

  registerIpcHandle("github:refresh", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    return buildSnapshot({ forceGithub: true });
  });

  registerIpcHandle("github:set-remote", async (_event, projectId, remoteUrl, name) => {
    const project = machine.getProject(store.state, projectId);
    const remote = await setGitRemote(project.path, remoteUrl, { name });
    return { remote, snapshot: await buildSnapshot({ forceGithub: true }) };
  });

  registerIpcHandle("project:set-status", async (_event, projectId, status) => {
    store.update((state) => machine.setProjectStatus(state, projectId, String(status || "active")));
    return buildSnapshot();
  });

  registerIpcHandle("project:archive", async (_event, projectId, reason) => {
    const project = machine.getProject(store.state, projectId);
    const threadIds = (project.tasks || [])
      .filter((task) => {
        const runStatus = String(task.run?.status || "").toLowerCase();
        return (["in_progress", "awaiting_result"].includes(task.status) || ["starting", "running"].includes(runStatus)) && task.run?.externalThreadId;
      })
      .map((task) => task.run.externalThreadId);
    for (const threadId of threadIds) {
      const harnessRuntime = activeCodexClients.get(String(threadId));
      const visibleRuntime = observingCodexThreads.get(String(threadId));
      const runtime = runtimeForThread(threadId);
      if (!runtime) continue;
      runtime.intentionalStop = true;
      // Closing a Harness-owned Desktop 原生控制面 client stops its turn. For a
      // visible Desktop-owned thread this only tears down our observer; the
      // user's Desktop turn is left untouched.
      try { runtime.client.close(new Error(harnessRuntime ? "项目归档时自动停止任务" : "项目归档时停止 Harness 监视")); } catch {}
      removeRuntimeForThread(threadId, runtime);
    }
    store.update((state) => machine.archiveProjectWithTaskStop(state, projectId, reason));
    return buildSnapshot();
  });

  registerIpcHandle("project:remove", async (_event, projectId, reason) => {
    const project = machine.getProject(store.state, projectId);
    const archivePath = persistRemovedProject(project, reason);
    try {
      store.update((state) => machine.removeProject(state, projectId, reason));
    } catch (error) {
      try { fs.rmSync(archivePath, { force: true }); } catch {}
      throw error;
    }
    return { removedProjectId: projectId, archivePath, snapshot: await buildSnapshot() };
  });

  registerIpcHandle("project:restore", async (_event, projectId) => {
    store.update((state) => machine.restoreProject(state, projectId));
    return buildSnapshot();
  });

  registerIpcHandle("project:update-contract", async (_event, projectId, input) => {
    store.update((state) => machine.updateProjectContract(state, projectId, input || {}));
    return buildSnapshot();
  });
  registerIpcHandle("project:refresh-profile", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    const profile = inspectProjectProfile(project.path);
    store.update((state) => {
      const target = machine.getProject(state, projectId);
      target.profile = profile;
      if (!target.techStack?.length && profile.stack?.length) target.techStack = profile.stack.slice(0, 20);
      target.updatedAt = new Date().toISOString();
    });
    return buildSnapshot();
  });
  registerIpcHandle("project:list-templates", async () => listTemplates());
  registerIpcHandle("project:apply-template", async (_event, projectId, templateId) => {
    store.update((state) => applyProjectTemplate(state, projectId, templateId));
    return buildSnapshot();
  });

  registerIpcHandle("objective:create", async (_event, projectId, input) => {
    store.update((state) => machine.createObjective(state, projectId, input || {}));
    return buildSnapshot();
  });

  registerIpcHandle("objective:set-status", async (_event, projectId, status) => {
    store.update((state) => machine.setObjectiveStatus(state, projectId, String(status || "active")));
    return buildSnapshot();
  });
  registerIpcHandle("project:add-decision", async (_event, projectId, input) => {
    store.update((state) => applyDecisionProposal(state, projectId, input || {}));
    return buildSnapshot();
  });

  registerIpcHandle("project:activity", async (_event, projectId, limit) => {
    const project = machine.getProject(store.state, projectId);
    return machine.getProjectActivity(project, { limit });
  });

  registerIpcHandle("section:create", async (_event, projectId, input) => {
    store.update((state) => machine.createSection(state, projectId, input || {}));
    return buildSnapshot();
  });

  registerIpcHandle("section:assign-task", async (_event, projectId, taskId, sectionId) => {
    store.update((state) => machine.assignTaskToSection(state, projectId, taskId, sectionId));
    return buildSnapshot();
  });

  registerIpcHandle("section:close", async (_event, projectId, sectionId, reason) => {
    store.update((state) => machine.closeSection(state, projectId, sectionId, reason));
    return buildSnapshot();
  });

  registerIpcHandle("section:archive", async (_event, projectId, sectionId, reason) => {
    store.update((state) => machine.archiveSection(state, projectId, sectionId, reason));
    return buildSnapshot();
  });

  registerIpcHandle("archive:import", async (event, projectId, requestedPath) => {
    const project = machine.getProject(store.state, projectId);
    let sourcePath = String(requestedPath || "").trim();
    if (!sourcePath) {
      const picked = await dialog.showOpenDialog({
        title: "导入 Agent 会话归档",
        properties: ["openFile"],
        filters: [{ name: "会话 / JSONL", extensions: ["jsonl", "ndjson", "json", "txt", "log"] }, { name: "全部文件", extensions: ["*"] }],
      });
      if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true, snapshot: await buildSnapshot() };
      sourcePath = picked.filePaths[0];
    }
    const result = await importTranscript(sourcePath, store.contextRoot || path.dirname(store.filePath), {
      projectId,
      label: `${project.name} · ${path.basename(sourcePath)}`,
      maxBytes: Number(process.env.APH_MAX_TRANSCRIPT_BYTES || 0),
      onProgress: (progress) => {
        if (!event.sender?.isDestroyed?.()) event.sender?.send?.("archive:progress", { projectId, ...progress });
      },
    });
    store.update((state) => {
      const target = machine.getProject(state, projectId);
      target.archiveManifests ||= [];
      if (!target.archiveManifests.some((item) => item.sha256 === result.manifest.sha256 && item.manifestPath === result.manifestPath)) target.archiveManifests.unshift({ ...result.manifest, manifestPath: result.manifestPath });
      target.events.unshift({ id: require("node:crypto").randomUUID(), type: "transcript.imported", at: result.manifest.importedAt, detail: `${result.manifest.sourceName} · ${result.manifest.bytes} bytes` });
      target.updatedAt = result.manifest.importedAt;
    });
    return { ...result, canceled: false, snapshot: await buildSnapshot() };
  });

  registerIpcHandle("archive:list", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    return listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId });
  });
  registerIpcHandle("archive:verify", async (_event, projectId, hash) => {
    machine.getProject(store.state, projectId);
    const manifest = listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId }).find((item) => item.sha256 === String(hash));
    if (!manifest) throw new Error("Archive manifest not found");
    return verifyArchiveObject(store.contextRoot || path.dirname(store.filePath), manifest);
  });

  registerIpcHandle("archive:open", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    const target = path.join(store.contextRoot || path.dirname(store.filePath), "archive");
    const error = await shell.openPath(target);
    return { opened: !error, path: target, ...(error ? { error } : {}) };
  });

  registerIpcHandle("archive:open-run", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    const target = task?.run?.transcriptPath;
    if (!target) throw new Error("该任务还没有运行归档");
    const error = await shell.openPath(target);
    return { opened: !error, path: target, ...(error ? { error } : {}) };
  });

  registerIpcHandle("project:open-ledger", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    const target = project.ledger?.path || path.join(store.contextRoot || path.dirname(store.filePath), "projects", project.id, "PROJECT-LEDGER.md");
    const error = await shell.openPath(target);
    return { opened: !error, path: target, ...(error ? { error } : {}) };
  });

  registerIpcHandle("project:open-path", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    if (!project.path) return { opened: false, path: "", error: "空白项目尚未绑定本地目录" };
    const error = await shell.openPath(project.path);
    return { opened: !error, path: project.path, ...(error ? { error } : {}) };
  });
  registerIpcHandle("window:toggle-pin", async () => {
    windowPinned = !windowPinned;
    mainWindow?.setAlwaysOnTop(windowPinned, "floating");
    if (windowPrefsPath) {
      try {
        const temporary = `${windowPrefsPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temporary, `${JSON.stringify({ alwaysOnTop: windowPinned })}\n`, "utf8");
        fs.renameSync(temporary, windowPrefsPath);
      } catch {}
    }
    return { alwaysOnTop: windowPinned, snapshot: await buildSnapshot() };
  });

  registerIpcHandle("project:export", async (_event, projectId, requestedPath) => {
    const project = machine.getProject(store.state, projectId);
    let target = String(requestedPath || "").trim();
    if (!target) {
      const picked = await dialog.showSaveDialog({
        title: "导出 Harness 项目包",
        defaultPath: `${project.name}.aph-project.json`,
        filters: [{ name: "Harness 项目包", extensions: ["aph-project.json", "json"] }],
      });
      if (picked.canceled || !picked.filePath) return { canceled: true, snapshot: await buildSnapshot() };
      target = picked.filePath;
    }
    const archives = listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId });
    const result = exportProjectBundle(project, target, { archives });
    return { canceled: false, path: result.path, sha256: result.sha256, snapshot: await buildSnapshot() };
  });

  registerIpcHandle("project:import", async (_event, requestedPath) => {
    let source = String(requestedPath || "").trim();
    if (!source) {
      const picked = await dialog.showOpenDialog({ title: "导入 Harness 项目包", properties: ["openFile"], filters: [{ name: "Harness 项目包", extensions: ["json"] }] });
      if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true, snapshot: await buildSnapshot() };
      source = picked.filePaths[0];
    }
    const bundle = JSON.parse(fs.readFileSync(path.resolve(source), "utf8"));
    store.update((state) => importProjectBundle(state, bundle));
    return { canceled: false, path: path.resolve(source), snapshot: await buildSnapshot() };
  });

  registerIpcHandle("project:open-cto", async (_event, projectId) => {
    let project = machine.getProject(store.state, projectId);
    if (!project.path) throw new Error("空白项目还没有项目目录；请先绑定本地工作区，再打开 CTO");
    const ensuredPath = ensureProjectDirectory(project.path);
    if (path.resolve(ensuredPath).toLowerCase() !== path.resolve(project.path).toLowerCase()) {
      store.update((state) => machine.updateProjectContract(state, projectId, { path: ensuredPath }));
      project = machine.getProject(store.state, projectId);
    }
    if (!project.sessions.some((item) => item.role === "cto")) {
      store.update((state) => machine.ensureProjectControlSessions(machine.getProject(state, projectId)));
    }
    if (!project.sessions.find(item => item.role === "cto")?.externalThreadId && needsProjectInitialization(project)) {
      throw new Error("项目初始化尚未完成；接受初始化结果并写入上下文后才能创建 CTO 对话");
    }
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法打开 CTO Session");
    await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: false });
    const latestProject = machine.getProject(store.state, projectId);
    const packetPath = latestProject.contextPackets?.cto?.path;
    if (!packetPath) throw new Error("CTO 项目上下文文件未生成");
    const draftReference = "@" + packetPath;
    clipboard.writeText(draftReference);
    const cto = latestProject.sessions.find((item) => item.role === "cto");
    const opened = await openCodexDesktop("", latestProject.path, {
      threadId: cto?.externalThreadId,
      prompt: controlPrompt(latestProject, "cto", packetPath),
      openExternal: (uri) => shell.openExternal(uri),
    });
    if (opened.opened) {
      store.update((state) => machine.markControlSessionRequested(state, projectId, "cto", packetPath));
    }
    return {
      ...opened,
      supported: true,
      capability: (opened.capability || "desktop-native-new-thread-deep-link") + "+draft-reference-clipboard",
      threadId: cto?.externalThreadId,
      packetPath,
      draftReference,
      message: opened.opened ? (cto?.externalThreadId ? "已请求打开已绑定 CTO 对话；上下文引用已复制。" : "已打开 CTO 草稿入口；自动创建标准对话尚未接通。") : "Desktop CTO 入口未能打开。",
      snapshot: await buildSnapshot(),
    };
  });
  registerIpcHandle("project:new-conversation", async (_event, projectId, input) => {
    const project = machine.getProject(store.state, projectId);
    if (project.status === "archived") throw new Error("已归档项目不能创建新对话，请先恢复项目");
    if (!project.path) throw new Error("空白项目还没有项目目录；请先绑定本地工作区，再创建 Codex 对话");
    const requestedAgent = ["claude", "hermes"].includes(input?.agent) ? input.agent : "codex";
    if (requestedAgent !== "codex") {
      const session = store.update((state) => machine.createConversationSession(state, projectId, { ...(input || {}), agent: requestedAgent }));
      const packet = machine.buildMissionPacket(project, { title: session.title, workstream: session.workstream, criteria: [], sectionId: undefined }, session);
      clipboard.writeText(packet);
      const opened = await shell.openPath(project.path);
      return { opened: !opened, supported: true, capability: "user-invoked-workspace", threadId: undefined, message: !opened ? `已准备 ${requestedAgent === "claude" ? "Claude Code" : "Hermes"} 项目对话；任务包已复制，请在打开的工作区中主动调用 Skill。` : `项目对话已准备，但工作区未能打开：${opened}`, snapshot: await buildSnapshot(), ...(opened ? { error: opened } : {}) };
    }
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法创建项目对话");
    await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: false });
    const session = store.update((state) => machine.createConversationSession(state, projectId, input || {}));
    const latestProject = machine.getProject(store.state, projectId);
    const packet = machine.buildMissionPacket(latestProject, { title: session.title, workstream: session.workstream, criteria: [], sectionId: undefined }, session);
    clipboard.writeText(packet);
    store.update((state) => {
      const target = machine.getProject(state, projectId).sessions.find((item) => item.id === session.id);
      if (target) {
        target.status = "awaiting_result";
        target.pendingDraftPath = latestProject.ledger?.path;
        target.lastOpenRequestedAt = new Date().toISOString();
      }
    });
    const opened = await openCodexDesktop("", latestProject.path, { prompt: packet, openExternal: (uri) => shell.openExternal(uri) });
    return { ...opened, supported: true, capability: opened.capability, threadId: undefined, message: opened.opened ? "已通过 Desktop 原生深链打开新项目对话；任务包已复制，请在 Desktop 中发送。" : "任务包已复制，但 Desktop 原生新对话未打开。", snapshot: await buildSnapshot() };
  });

  registerIpcHandle("project:open-session", async (_event, projectId, sessionId) => {
    let project = machine.getProject(store.state, projectId);
    let session = project.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("Session not found");
    if (session.agent === "codex") {
      if (["cto", "review"].includes(session.role) && !session.externalThreadId && needsProjectInitialization(project)) {
        throw new Error("项目初始化尚未完成；接受初始化结果并写入上下文后才能创建标准对话");
      }
      const codex = await detectCommand("codex");
      if (!codex.installed) throw new Error("未检测到 Codex Desktop");
      const prompt = ['cto', 'review'].includes(session.role)
        ? controlPrompt(project, session.role, project.contextPackets?.[session.role]?.path) : undefined;
      if (prompt && session.externalThreadId) clipboard.writeText(prompt);
      const opened = await openCodexDesktop("", project.path, { threadId: session.externalThreadId, prompt, openExternal: (uri) => shell.openExternal(uri) });
      if (opened.opened) {
        store.update((state) => {
          const target = machine.getProject(state, projectId).sessions.find((item) => item.id === sessionId);
          if (!target) return;
          if (["cto", "review"].includes(target.role)) {
            machine.markControlSessionRequested(state, projectId, target.role, target.pendingDraftPath);
          } else {
            target.lastOpenRequestedAt = new Date().toISOString();
          }
        });
      }
      return { ...opened, supported: true, threadId: session.externalThreadId, message: opened.opened ? "已打开项目对话。" : "项目对话已存在，但 Desktop 未能打开。", snapshot: await buildSnapshot() };
    }
    const error = await shell.openPath(project.path);
    return { opened: !error, supported: true, capability: "user-invoked-workspace", message: !error ? "已打开项目工作区，请在对应 Agent 中继续。" : `工作区未能打开：${error}`, snapshot: await buildSnapshot(), ...(error ? { error } : {}) };
  });

  registerIpcHandle("project:attach-control-thread", async (_event, projectId, role, input = {}) => {
    const normalizedRole = String(role || "").trim().toLowerCase();
    if (!["cto", "review"].includes(normalizedRole)) throw new Error("控制对话角色必须是 cto 或 review");
    const threadId = String(input.threadId || "").trim();
    if (!threadId) throw new Error("控制对话 threadId 不能为空");
    store.update((state) => machine.attachControlSessionThread(state, projectId, normalizedRole, {
      threadId,
      projectId: input.externalProjectId || input.codexProjectId,
      packetPath: input.packetPath,
      expectedThreadId: input.expectedThreadId,
    }));
    return { attached: true, verified: false, role: normalizedRole, threadId, snapshot: await buildSnapshot() };
  });

  registerIpcHandle("task:open-agent", (_event, projectId, taskId) => openTask(projectId, taskId));
  registerIpcHandle("task:open-workspace", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Task not found");
    const error = await shell.openPath(project.path);
    return { opened: !error, path: project.path, agent: task.agent, ...(error ? { error } : {}) };
  });
  registerIpcHandle("project:open-codex", async (_event, projectId) => {
    let project = machine.getProject(store.state, projectId);
    if (!project.path) throw new Error("这是空白项目；请先填写项目目录，再连接 Codex Project");
    const ensuredPath = ensureProjectDirectory(project.path);
    if (path.resolve(ensuredPath).toLowerCase() !== path.resolve(project.path).toLowerCase()) {
      store.update((state) => machine.updateProjectContract(state, projectId, { path: ensuredPath }));
      project = machine.getProject(store.state, projectId);
    }
    const codex = await detectCommand("codex");
    if (codex.installed && project.status !== "archived") {
      if (needsProjectInitialization(project)) {
        const initialization = await connectHarnessProject(projectId);
        return { opened: initialization.desktopOpened === true, supported: true, capability: "desktop-native-initialization-draft",
          message: "项目初始化待执行；标准对话等待初始化结果回写。", snapshot: await buildSnapshot() };
      }
      const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true });
      markCodexDesktopRegistered(projectId, plane.codexProjectId);
      // Existing projects may already have an official Project id and therefore
      // skip the registration deep link. Fill any missing standard handoffs
      // through the same idempotent Desktop-only path.
      await openStandardControlConversations(projectId);
    }
    return openProject(projectId);
  });
  registerIpcHandle("project:sync-codex", async (_event, projectId) => {
    let project = machine.getProject(store.state, projectId);
    if (!project.path) throw new Error("空白项目还没有项目目录；请先在项目契约中绑定本地工作区");
    const ensuredPath = ensureProjectDirectory(project.path);
    if (path.resolve(ensuredPath).toLowerCase() !== path.resolve(project.path).toLowerCase()) {
      store.update((state) => machine.updateProjectContract(state, projectId, { path: ensuredPath }));
      project = machine.getProject(store.state, projectId);
    }
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法同步 Project");
    try {
      const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true, forceRegistration: true, forceOpenThreads: true });
      markCodexDesktopRegistered(projectId, plane.codexProjectId);
      return buildSnapshot();
    } catch (error) {
      store.update((state) => machine.recordCodexProjectSyncError(state, projectId, error?.message || error, "sync"));
      throw error;
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: !hideAutomatedTestWindow,
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#f4f3ed",
    title: "AI Project Harness",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:github\.com|www\.github\.com)\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  mainWindow.setAlwaysOnTop(hideAutomatedTestWindow ? false : windowPinned, "floating");

  startRuntimeRefresh();
}

app.whenReady().then(() => {
  const projectPath = app.getAppPath();
  const dataRoot = resolveDataRoot({ userDataPath: app.getPath("userData") });
  // The program owns one stable, trusted parent for all generated project
  // folders. Codex only needs the user trust this parent once.
  getHarnessTrustedRoot();
  // Resolve and validate the bundled handoff protocol once per app process.
  // All later Codex turns reuse these absolute paths; a new process resolves
  // them again against its current dev or packaged runtime location.
  getHarnessProtocolPaths();
  const statePath = path.join(dataRoot, "harness-state.json");
  windowPrefsPath = path.join(dataRoot, "window-preferences.json");
  try { windowPinned = Boolean(JSON.parse(fs.readFileSync(windowPrefsPath, "utf8")).alwaysOnTop); } catch { windowPinned = false; }
  if (hideAutomatedTestWindow) windowPinned = false;
  const legacyStatePath = path.join(app.getPath("userData"), "harness-state.json");
  // One-way, lossless migration from the old C: profile. The E: store becomes
  // the source of truth after the first successful launch.
  if (path.resolve(statePath).toLowerCase() !== path.resolve(legacyStatePath).toLowerCase()
    && !fs.existsSync(statePath) && fs.existsSync(legacyStatePath)) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.copyFileSync(legacyStatePath, statePath);
  }
  errorLog = createErrorLog({
    filePath: path.join(dataRoot, "logs", "harness-errors.jsonl"),
    appVersion: app.getVersion(),
    platform: process.platform,
  });
  diagnostics = createDiagnostics({ errorLog, showItemInFolder: (target) => shell.showItemInFolder(target) });
  installProcessErrorLogging({ errorLog });
  store = new HarnessStore(statePath, projectPath, {
    journalPath: resolveJournalPath({ envValue: dataRoot }),
    contextRoot: dataRoot,
    sqlitePath: path.join(dataRoot, "state-index.sqlite"),
    initialStateMode: "empty",
  });
  registerIpc();
  reconcileTaskLeases("应用恢复时任务 lease 到期");
  mcpControlServer = createMcpControlServer({
    dataRoot,
    handlers: mcpIpcHandlers,
    channelMeta: mcpChannelMeta,
    snapshot: buildSnapshot,
  });
  void mcpControlServer.start().catch((error) => {
    try { errorLog?.capture(error, { operation: "mcp-control-server", stage: "start" }); } catch {}
  });
  createWindow();
  void resumePendingCodexArchives();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopRuntimeRefresh();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopRuntimeRefresh();
  try { mcpControlServer?.close(); } catch {}
  for (const runtime of activeCodexClients.values()) {
    try { runtime.client.close(new Error("Harness 正在退出")); } catch {}
  }
  for (const runtime of observingCodexThreads.values()) {
    try { runtime.client.close(new Error("Harness 正在退出")); } catch {}
  }
  activeCodexClients.clear();
  observingCodexThreads.clear();
});
