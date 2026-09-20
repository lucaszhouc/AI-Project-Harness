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
const { resolveAppServerCwd, resolveBundledSkillPath, resolveBundledProtocolPath, resolveDataRoot, resolveJournalPath, resolveHarnessCliPath, resolveHarnessMcpPath } = require("./runtime-paths.cjs");
const { createProjectOnboarding } = require("./project-onboarding.cjs");
const { resolveCodexProjectByName, selectCodexProjectRoot } = require("./project-discovery.cjs");
const { applyHarnessImport, selectCodexProjectThreads } = require("./codex-import.cjs");
const { createErrorLog } = require("./error-log.cjs");
const { createOnboardingIpcHandler } = require("./onboarding-ipc.cjs");
const { createDiagnostics, installProcessErrorLogging } = require("./diagnostics.cjs");
const { detectCommand } = require("./command-runtime.cjs");
const { openCodexDesktop, launchHarnessTask, launchHarnessImport, createCodexControlThread, ensureCodexProject, inspectCodexThread, listRecentCodexThreads, listAllCodexThreads, listCodexProjects, terminateCodexProcessTree, registerCodexDesktopProject } = require("./codex-adapter.cjs");
const { createAgentRunMonitor } = require("./agent-run-monitor.cjs");
const { detectAgentCapabilities } = require("./agent-capabilities.cjs");
const { platformCapabilities } = require("./platform.cjs");
const { projectHealth } = require("./health.cjs");
const { readSqliteSummary } = require("./sqlite-index.cjs");
const { createTaskOpenHandler, createProjectOpenHandler } = require("./task-open.cjs");
const { ensureCodexProjectFolder, assignCodexThreadToProjectFolder, legacyStateSyncEnabled, defaultStatePath: defaultCodexGlobalStatePath } = require("./codex-projects.cjs");
const { createManagedWorkspace } = require("./managed-workspace.cjs");
const { GuideStateStore } = require("./guide-state.cjs");
const { createProbeRunner } = require("./guide-probes.cjs");
const { createGuideActionExecutor } = require("./guide-actions.cjs");
const { nextGuideRecommendation, reconcileGuideState } = require("./guide-orchestrator.cjs");

const RUNTIME_REFRESH_INTERVAL_MS = 5000;
let store;
let guideStore;
let guideProbeRunner;
let mainWindow;
let windowPinned = false;
let windowPrefsPath;
let errorLog;
let diagnostics;
const activeCodexClients = new Map();
const controlThreadInflight = new Map();
const codexRegistrationInflight = new Map();
let runtimeRefreshTimer;
let runtimeRefreshInFlight = false;
let folderReconcileInFlight = false;
const githubCache = new Map();
const GITHUB_CACHE_MS = 30000;
let agentCapabilitiesCache;
let agentCapabilitiesAt = 0;
const AGENT_CACHE_MS = 30000;
let snapshotQueue = Promise.resolve();
let snapshotSequence = 0;
// A dispatched task is persisted before its Codex app-server child returns a
// thread/process id. Snapshots can run in that small hand-off window; keep
// the launch alive long enough for attachExternalThread to bind the runtime.
const LAUNCH_RECONCILE_GRACE_MS = 120_000;
const hideAutomatedTestWindow = process.env.APH_TEST_WINDOW_HIDDEN === "1";
const archiveTracePath = process.env.APH_ARCHIVE_TRACE_PATH;

function traceRunArchive(stage, detail = {}) {
  if (!archiveTracePath) return;
  try {
    fs.mkdirSync(path.dirname(archiveTracePath), { recursive: true });
    fs.appendFileSync(archiveTracePath, `${JSON.stringify({ at: new Date().toISOString(), stage, ...detail })}\n`, "utf8");
  } catch {
    // Diagnostics must never change runtime behavior.
  }
}

const codexFolderStatePath = process.env.APH_CODEX_GLOBAL_STATE
  || (process.env.APH_USER_DATA ? path.join(process.env.APH_USER_DATA, ".codex-global-state.json") : defaultCodexGlobalStatePath());
const allowLegacyCodexStateSync = legacyStateSyncEnabled();

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

function isProcessAlive(processId) {
  if (!Number.isFinite(Number(processId)) || Number(processId) <= 0) return true;
  try {
    process.kill(Number(processId), 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not inspectable from this user.
    return error?.code === "EPERM";
  }
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

function reconcileDetachedRuns() {
  if (!store) return;
  let changed = false;
  for (const project of store.state.projects) {
    for (const task of project.tasks) {
      const run = task.run;
      if (!run || !(run.status === "starting" || run.status === "running" || (!run.status && task.status === "in_progress"))) continue;
      if (run.status === "starting" && !run.externalThreadId && !run.processId) {
        const startedAt = Date.parse(String(run.startedAt || ""));
        if (!Number.isFinite(startedAt) || Date.now() - startedAt < LAUNCH_RECONCILE_GRACE_MS) continue;
      }
      if (run.externalThreadId && activeCodexClients.has(run.externalThreadId)) continue;
      if (run.processId && isProcessAlive(run.processId)) continue;
      // The app was restarted or the child exited before its final notification.
      // Mark it finished-but-unreconciled so the UI never lies that it is still running.
      machine.markRunCompleted(store.state, project.id, task.id, "Agent 进程已退出，等待结构化结果回写");
      changed = true;
    }
  }
  if (changed) store.write();
}

async function buildSnapshotNow({ forceGithub = false } = {}) {
  const externalStateReloaded = activeCodexClients.size === 0 && (store.reloadExternal?.() || false);
  if (externalStateReloaded) {
    // A CLI/MCP writer may have changed project metadata; its GitHub cache is
    // still safe, but stale project paths should be checked again.
    githubCache.clear();
  }
  reconcileDetachedRuns();
  const gitEntries = await Promise.all(
    store.state.projects.map(async (project) => [project.id, project.path
      ? await readGitStatus(project.path)
      : {
        available: false,
        error: "项目路径尚未设置",
        detail: "这是一个空白项目；绑定本地目录后才会读取 Git。",
        checkedAt: new Date().toISOString(),
      }]),
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
  const guideFacts = {
    projects: store.state.projects,
    selectedProjectId: store.state.selectedProjectId,
    probes: guideStore?.state?.probes || {},
    sequence: snapshotSequence + 1,
  };
  if (guideStore) {
    const guideBefore = JSON.stringify(guideStore.state);
    reconcileGuideState(guideStore.state, guideFacts);
    if (guideBefore !== JSON.stringify(guideStore.state)) guideStore.write();
  }
  const guideRecommendation = nextGuideRecommendation(guideFacts);
  return {
    sequence: ++snapshotSequence,
    state: store.state,
    git: Object.fromEntries(gitEntries),
    github,
    health,
    overview,
    window: { alwaysOnTop: windowPinned },
    archives: Object.fromEntries(store.state.projects.map((project) => [project.id, listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId: project.id })])),
    agents: { ...agents, codex: { ...agents.codex, bridge: agents.codex.installed ? "app-server" : "unavailable" } },
    platform: process.platform,
    platformCapabilities: platformCapabilities(process.platform),
    guide: guideStore?.state,
    guideRecommendation,
    storage: { root: path.dirname(store.filePath), statePath: store.filePath, journalPath: store.journalPath, archiveRoot: path.join(store.contextRoot || path.dirname(store.filePath), "archive"), sqlitePath: store.sqlitePath, sqlite: store.sqliteStatus || (store.sqlitePath ? readSqliteSummary(store.sqlitePath) : { available: false }), harnessCliPath: resolveHarnessCliPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }), harnessMcpPath: resolveHarnessMcpPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }) },
  };
}

// IPC actions, the runtime heartbeat and external CLI reloads can all ask
// for a snapshot at once. Serialize the expensive projection so an older
// asynchronous response cannot arrive after a newer state mutation and make
// the renderer appear to roll back.
function buildSnapshot(options = {}) {
  const next = snapshotQueue.then(() => buildSnapshotNow(options));
  snapshotQueue = next.catch(() => {});
  return next;
}

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
      return publishRuntimeSnapshot({ type: "runtime.auto-refresh" });
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

async function ensureControlThread(project, session, codex, codexProjectId, { verifyExisting = false } = {}) {
  if (!project || !session || !codex?.path) return session?.externalThreadId;
  const key = `${project.id}:${session.role}`;
  if (controlThreadInflight.has(key)) return controlThreadInflight.get(key);
  const promise = (async () => {
    let latest = machine.getProject(store.state, project.id);
    let current = latest.sessions.find((item) => item.id === session.id || item.role === session.role);
    if (current?.externalThreadId && verifyExisting) {
      const health = await inspectCodexThread({
        executable: codex.path,
        cwd: latest.path,
        threadId: current.externalThreadId,
      });
      const belongsToRequestedProject = !codexProjectId || current.externalProjectId === codexProjectId;
      if (health.readable && belongsToRequestedProject) return current.externalThreadId;
      // A shell-only thread (or a thread left in a previous official Project)
      // cannot be repaired in place. Clear only the Harness pointer; the old
      // Codex history remains untouched and a fresh seeded thread is created.
      store.update((state) => {
        const target = machine.getProject(state, project.id).sessions.find((item) => item.id === session.id || item.role === session.role);
        if (target) {
          target.externalThreadId = undefined;
          target.externalProjectId = undefined;
        }
      });
      latest = machine.getProject(store.state, project.id);
      current = latest.sessions.find((item) => item.id === session.id || item.role === session.role);
    }
    if (current?.externalThreadId) return current.externalThreadId;
    const control = await createCodexControlThread({
      executable: codex.path,
      projectPath: latest.path,
      name: `${latest.name} · ${current?.title || session.role}`,
      projectId: codexProjectId,
      bootstrapText: [
        "# AI Project Harness · 控制线程已就绪",
        `PROJECT: ${latest.name}`,
        `PROJECT_PATH: ${latest.path}`,
        `ROLE: ${current?.role || session.role}`,
        latest.ledger?.path ? `PROJECT_LEDGER: ${latest.ledger.path}` : "PROJECT_LEDGER: use npm run harness -- context",
        "这是项目控制线程的有界入口。不要修改代码；等待 Harness 分派任务或用户明确指令。",
      ].join("\n"),
    });
    store.update((state) => {
      const targetProject = machine.getProject(state, project.id);
      const target = targetProject.sessions.find((item) => item.id === session.id || item.role === session.role);
      if (target) {
        target.externalThreadId = control.threadId;
        target.externalProjectId = codexProjectId;
      }
    });
    if (codexProjectId && allowLegacyCodexStateSync) {
      try {
        assignCodexThreadToProjectFolder({ threadId: control.threadId, projectId: codexProjectId, statePath: codexFolderStatePath, enabled: allowLegacyCodexStateSync });
      } catch {
        // Codex folder grouping is best effort; the control thread is durable.
      }
    }
    return control.threadId;
  })().finally(() => controlThreadInflight.delete(key));
  controlThreadInflight.set(key, promise);
  return promise;
}

/** Ensure the two durable control sessions are members of one official
 * Codex Project. This helper is shared by every user-triggered Codex entry.
 * Control creation starts one bounded low-effort bootstrap turn so the
 * resulting thread has a real readable rollout and a visible sidebar preview
 * (startup itself never launches a model turn).
 */
async function ensureDesktopProjectRegistration(project, codex, { force = false } = {}) {
  if (!project?.path || !codex?.path) throw new Error("项目目录和 Codex 都是建立 Project 所必需的");
  // Headless/release smoke explicitly disables external Desktop navigation.
  // In that mode let the official app-server project/create path establish
  // the Project instead of attempting a real codex:// protocol side effect.
  if (process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1") {
    return { registered: false, skipped: true, capability: "desktop-deeplink-disabled" };
  }
  const currentId = String(project.codexProjectId || "").trim();
  if (!force && currentId && !currentId.startsWith("local-")) return { registered: false, projectId: currentId };
  const key = project.id;
  if (codexRegistrationInflight.has(key)) return codexRegistrationInflight.get(key);
  const promise = (async () => {
    if (typeof registerCodexDesktopProject !== "function") throw new Error("当前 Codex 适配器缺少 Desktop Project 注册能力");
    const result = await registerCodexDesktopProject({
      projectPath: project.path,
      openExternal: (uri) => shell.openExternal(uri),
    });
    if (!result?.opened) throw new Error(result?.error || "Codex Desktop 未接受 Project 注册深链");
    return result;
  })().finally(() => codexRegistrationInflight.delete(key));
  codexRegistrationInflight.set(key, promise);
  return promise;
}

function markCodexDesktopRegistered(projectId, officialProjectId) {
  if (!store || !officialProjectId) return;
  store.update((state) => {
    machine.setCodexProjectSync(state, projectId, {
      officialProjectId,
      state: "desktop-registered",
      detail: "Codex Desktop 已接受 Project 深链；控制对话已按官方 Project 建立。",
    });
  });
}

async function ensureProjectControlPlane(project, codex, { verifyProject = true, openThreads = false, registerDesktop = true, forceRegistration = false } = {}) {
  if (!project?.path) throw new Error("项目目录未绑定，无法建立 Codex 控制面");
  if (!codex?.installed || !codex.path) throw new Error("未检测到 Codex，无法建立 Codex 控制面");
  let waitForProjectMs = 0;
  if (registerDesktop && (forceRegistration || !project.codexProjectId || String(project.codexProjectId).startsWith("local-"))) {
    const registration = await ensureDesktopProjectRegistration(project, codex, { force: forceRegistration });
    // The Desktop handler writes its app-server Project asynchronously after
    // accepting the deep link. Give that write a bounded condition wait before
    // falling back to our own project/create path.
    if (registration?.opened) waitForProjectMs = 2500;
  }
  const officialProjectId = await ensureProjectFolder(project, codex, { verify: verifyProject, waitForProjectMs });
  if (!officialProjectId) throw new Error("官方 Codex Project ID 缺失，无法建立控制面");
  const latest = machine.getProject(store.state, project.id);
  const controls = [];
  for (const role of ["review", "cto"]) {
    const session = latest.sessions.find((item) => item.role === role);
    if (!session) throw new Error(`${role === "cto" ? "CTO" : "Review"} 控制 Session 未建立`);
    const threadId = await ensureControlThread(
      machine.getProject(store.state, project.id),
      session,
      codex,
      officialProjectId,
      { verifyExisting: true },
    );
    if (!threadId) throw new Error(`${role} 控制 thread 未建立`);
    controls.push({ role, threadId });
  }
  const opened = [];
  if (openThreads) {
    // Open Review first and CTO last so the user is left at the principal
    // control conversation. Deep links are attempted by openCodexDesktop;
    // this is user-triggered and therefore may legitimately focus Desktop.
    for (const control of controls) {
      const result = await openCodexDesktop(codex.path, latest.path, {
        threadId: control.threadId,
        openExternal: (uri) => shell.openExternal(uri),
        preferProjectPath: false,
      });
      opened.push({ ...control, opened: Boolean(result.opened), error: result.error });
      if (!result.opened) throw new Error(`${control.role} 控制 thread 深链打开失败：${result.error || "未知错误"}`);
    }
  }
  return {
    codexProjectId: officialProjectId,
    controls,
    opened,
    ctoThreadId: controls.find((item) => item.role === "cto")?.threadId,
    reviewThreadId: controls.find((item) => item.role === "review")?.threadId,
  };
}

async function ensureProjectFolder(project, codex, { verify = false, syncLegacy = false, waitForProjectMs = 0 } = {}) {
  if (!project || !codex?.path) return project?.codexProjectId;
  if (process.env.APH_DISABLE_CODEX_PROJECT_PROVISION === "1") return undefined;
  const recordCodexProjectSync = (officialProjectId) => {
    if (!store || !officialProjectId) return;
    store.update((state) => {
      const target = machine.getProject(state, project.id);
      target.codexProjectId = String(officialProjectId);
      machine.setCodexProjectSync(state, project.id, {
        officialProjectId: String(officialProjectId),
      });
    });
  };
  const legacySync = (input) => {
    if (!allowLegacyCodexStateSync) return undefined;
    try {
      return ensureCodexProjectFolder({ ...input, statePath: codexFolderStatePath, enabled: allowLegacyCodexStateSync });
    } catch (error) {
      // The Desktop process owns this compatibility JSON and can hold it open
      // while flushing its own atom state. A legacy-index write must never
      // block the official app-server Project or a Harness task dispatch.
      try {
        errorLog?.capture(error, {
          operation: "codex-legacy-state-sync",
          stage: "global-state-write",
          context: { projectId: project.id, projectPath: project.path },
        });
      } catch {}
      return undefined;
    }
  };
  // Keep the legacy JSON index in sync for older Desktop builds, but use the
  // public app-server Project API as the source of truth for current Codex.
  if (syncLegacy && allowLegacyCodexStateSync) {
    legacySync({
      projectPath: project.path,
      projectName: project.name,
      officialProjectId: project.codexProjectId && !String(project.codexProjectId).startsWith("local-")
        ? project.codexProjectId
        : undefined,
      threadIds: [
        ...(project.sessions || []).map((session) => session.externalThreadId),
        ...(project.tasks || []).map((task) => task.run?.externalThreadId),
      ].filter(Boolean),
    });
  }
  // A valid official ID is stable; do not start a new app-server on every
  // five-second runtime heartbeat. User-triggered control-plane actions pass
  // `verify: true` when they need to repair a project deleted in Desktop.
  if (!verify && project.codexProjectId && !String(project.codexProjectId).startsWith("local-")) {
    if (!project.codexProjectSync) recordCodexProjectSync(project.codexProjectId);
    return project.codexProjectId;
  }
  const official = await ensureCodexProject({
    executable: codex.path,
    cwd: project.path,
    projectPath: project.path,
    projectName: project.name,
    waitForExistingMs: waitForProjectMs,
  });
  if (syncLegacy && allowLegacyCodexStateSync) {
    legacySync({
      projectPath: project.path,
      projectName: project.name,
      officialProjectId: official.projectId,
      threadIds: [
        ...(project.sessions || []).map((session) => session.externalThreadId),
        ...(project.tasks || []).map((task) => task.run?.externalThreadId),
      ].filter(Boolean),
    });
  }
  if (project.codexProjectId !== official.projectId || !project.codexProjectSync) recordCodexProjectSync(official.projectId);
  return official.projectId;
}

async function reconcileCodexProjectFolders() {
  if (!store || folderReconcileInFlight) return;
  folderReconcileInFlight = true;
  try {
    const codex = await detectCommand("codex");
    if (!codex.installed) return;
    // Do not rewrite Codex's global JSON on the five-second heartbeat. The
    // Desktop process owns that file and may hold it open; background writes
    // caused EPERM/last-writer-wins races in the live profile. Compatibility
    // writes are opt-in via APH_ENABLE_CODEX_LEGACY_STATE_SYNC=1.
    for (const project of store.state.projects) {
      if (!machine.shouldAutoProvisionCodexProject(project)) continue;
      await ensureProjectFolder(project, codex, { syncLegacy: false });
    }
  } catch (error) {
    try {
      errorLog?.capture(error, { operation: "codex-folder-reconcile" });
    } catch {
      // Folder repair is best effort and must never break runtime refresh.
    }
  } finally {
    folderReconcileInFlight = false;
  }
}

async function provisionMissingControlThreads() {
  if (!store) return;
  // Never start model turns as a side effect of opening the panel. Control
  // threads are repaired by an explicit user action (new project, Sync
  // Project, Enter CTO, or task dispatch). An opt-in flag remains for
  // controlled migration/smoke environments only.
  if (process.env.APH_AUTO_PROVISION_CONTROLS !== "1") return;
  const codex = await detectCommand("codex");
  if (!codex.installed) return;
  for (const project of store.state.projects) {
    if (!machine.shouldAutoProvisionCodexProject(project)) continue;
    let codexProjectId;
    try {
      // Startup repair must not rewrite Codex's compatibility JSON while the
      // Desktop process owns its atom state. Modern app-server Projects are
      // the source of truth; legacy index writes are explicit opt-in only.
      codexProjectId = await ensureProjectFolder(project, codex, { syncLegacy: false });
    } catch (error) {
      try { errorLog?.capture(error, { operation: "codex-project-provision", projectId: project.id }); } catch {}
      continue;
    }
    const latest = machine.getProject(store.state, project.id);
    if (!codexProjectId) continue;
    if (latest.source?.kind === "codex-import" && latest.codexImport?.status !== "completed") continue;
    for (const session of latest.sessions.filter((item) => ["cto", "review"].includes(item.role))) {
      try {
        if (session.externalThreadId && session.externalProjectId === codexProjectId) continue;
        if (session.externalThreadId) {
          // The session was created before the official Project existed (or
          // belongs to a project that was recreated). Keep the old Codex
          // history untouched, but replace the Harness pointer with a new
          // control chat that is an actual Project member.
          store.update((state) => {
            const target = machine.getProject(state, project.id).sessions.find((item) => item.id === session.id);
            if (target) {
              target.externalThreadId = undefined;
              target.externalProjectId = undefined;
            }
          });
        }
        await ensureControlThread(latest, session, codex, codexProjectId);
      } catch (error) {
        errorLog?.capture(error, { operation: "control-session-provision", projectId: project.id, role: session.role });
      }
    }
  }
}

function registerLaunchedRuntime(launched, context, { autoReview = false, importMode = false, onImportCandidate = undefined } = {}) {
  const configuredTask = store.state.projects.find((project) => project.id === context.projectId)?.tasks.find((task) => task.id === context.taskId);
  const runArchivePath = configuredTask?.run?.id
    ? path.join(store.contextRoot || path.dirname(store.filePath), "projects", context.projectId, "runs", `${configuredTask.run.id}.jsonl`)
    : undefined;
  let rawArchive;
  let lastArchiveStatAt = 0;
  let archiveFinalized = false;
  const finalizeRunArchive = async () => {
    if (archiveFinalized || !runArchivePath) return;
    archiveFinalized = true;
    traceRunArchive("finalize:start", { projectId: context.projectId, taskId: context.taskId, runArchivePath });
    if (rawArchive) await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      rawArchive.once("error", onError);
      rawArchive.end(() => {
        rawArchive.off("error", onError);
        traceRunArchive("finalize:closed");
        resolve();
      });
    });
    try {
      traceRunArchive("finalize:import-start");
      const archived = await importTranscript(runArchivePath, store.contextRoot || path.dirname(store.filePath), {
        projectId: context.projectId,
        label: `${configuredTask?.title || "Agent run"} · 原始运行`,
      });
      store.update((state) => {
        const project = machine.getProject(state, context.projectId);
        const task = project.tasks.find((item) => item.id === context.taskId);
        if (task?.run) {
          task.run.transcriptBytes = archived.manifest.bytes;
          task.run.archiveManifestId = archived.manifest.id;
          task.run.archiveSha256 = archived.manifest.sha256;
        }
        project.archiveManifests ||= [];
        if (!project.archiveManifests.some((item) => item.sha256 === archived.manifest.sha256)) project.archiveManifests.unshift({ ...archived.manifest, manifestPath: archived.manifestPath });
      });
      traceRunArchive("finalize:import-done", { bytes: archived.manifest.bytes, manifestId: archived.manifest.id });
    } catch (error) {
      traceRunArchive("finalize:error", { error: String(error?.stack || error) });
      try { errorLog?.capture(error, { operation: "run-archive-finalize", projectId: context.projectId, taskId: context.taskId }); } catch {}
    }
  };
  if (runArchivePath) {
    try {
      fs.mkdirSync(path.dirname(runArchivePath), { recursive: true });
      rawArchive = fs.createWriteStream(runArchivePath, { flags: "a", encoding: "utf8" });
      rawArchive.once("open", () => traceRunArchive("open:ready", { runArchivePath }));
      store.update((state) => {
        const task = machine.getProject(state, context.projectId).tasks.find((item) => item.id === context.taskId);
        if (task?.run) task.run.transcriptPath = runArchivePath;
      });
    } catch {
      rawArchive = undefined;
    }
  }
  const monitor = createAgentRunMonitor({
    state: store.state,
    projectId: context.projectId,
    taskId: context.taskId,
    readGit: readGitStatus,
    autoReview: autoReview || configuredTask?.reviewMode === "auto",
    importMode,
    onImportCandidate,
    onRawMessage: (message) => {
      if (!rawArchive?.writable) return;
      const line = `${JSON.stringify({ at: new Date().toISOString(), message })}\n`;
      traceRunArchive("append:start", { method: message?.method, bytes: Buffer.byteLength(line) });
      return new Promise((resolve, reject) => rawArchive.write(line, "utf8", (error) => {
        if (error) return reject(error);
        traceRunArchive("append:done", { method: message?.method });
        resolve();
      })).then(() => {
        if (Date.now() - lastArchiveStatAt < 1000) return;
        lastArchiveStatAt = Date.now();
        try {
          const stat = fs.statSync(runArchivePath);
          store.update((state) => {
            const task = machine.getProject(state, context.projectId).tasks.find((item) => item.id === context.taskId);
            if (task?.run) task.run.transcriptBytes = stat.size;
          });
        } catch {}
      });
    },
    onUpdate: (update) => {
      traceRunArchive("update:store-start", { type: update.event?.type, kind: update.event?.kind });
      store.write();
      traceRunArchive("update:store-done", { type: update.event?.type, kind: update.event?.kind });
      void publishRuntimeSnapshot(update.event)
        .then(() => traceRunArchive("snapshot:published", { type: update.event?.type }))
        .catch((error) => {
          traceRunArchive("snapshot:error", { type: update.event?.type, error: String(error?.stack || error) });
          try { errorLog?.capture(error, { operation: "agent-runtime-snapshot", projectId: context.projectId, taskId: context.taskId }); } catch {}
        });
    },
  });
  const runtime = { client: launched.client, monitor, queue: Promise.resolve() };
  activeCodexClients.set(launched.threadId, runtime);
  const consume = (message) => {
    runtime.queue = runtime.queue.then(() => runtime.intentionalStop ? null : monitor.handleNotification(message)).then(async () => {
      if (monitor.isTerminal()) {
        traceRunArchive("terminal:detected", { method: message?.method, threadId: launched.threadId });
        activeCodexClients.delete(launched.threadId);
        await finalizeRunArchive();
        launched.client.close();
      }
    }).catch((error) => {
      traceRunArchive("consume:error", { method: message?.method, error: String(error?.stack || error) });
      void publishRuntimeSnapshot({ type: "agent.monitor.error", detail: String(error?.message || error) });
    });
  };
  launched.client.on("notification", consume);
  for (const message of launched.client.notifications || []) consume(message);
  launched.client.on("exit", () => {
    void runtime.queue.catch(() => {}).then(() => finalizeRunArchive());
    if (monitor.isTerminal() || runtime.intentionalStop) return;
    void (async () => {
      try {
        machine.markRunFailed(store.state, context.projectId, context.taskId, "Codex app-server 在任务完成前退出");
        store.write();
        await publishRuntimeSnapshot({ type: "agent.process.exit", detail: "Codex app-server 在任务完成前退出" });
      } catch {
        // The run may already have been completed by a concurrent notification.
      }
    })();
  });
  return runtime;
}

function emitImportProgress(event, stage, progress, label, detail) {
  if (event?.sender?.isDestroyed?.()) return;
  try {
    event?.sender?.send?.("project:onboarding-progress", {
      stage,
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
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

/**
 * Resolve an official Codex Project by approximate name and launch a bounded
 * read-only hydration turn. This path is intentionally separate from the
 * legacy local-folder onboarding flow: it never scans recent CWDs and never
 * infers progress from filesystem mtimes.
 */
async function importCodexProjectFromName(event, input = {}) {
  let stage = "starting";
  let mutableProjectId;
  let mutableTaskId;
  const query = String(input.name || input.projectName || input.codexProjectId || "").trim();
  const progress = (nextStage, value, label, detail) => {
    stage = nextStage;
    emitImportProgress(event, nextStage, value, label, detail);
  };
  try {
    progress("detecting_codex", 8, "正在连接 Codex");
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法拉取既有 Project");
    if (!query) throw new Error("请输入 Codex 项目名称或简称");

    progress("discovering_project", 24, "正在读取官方 Codex Project 索引", query);
    const officialProjects = await listCodexProjects({ executable: codex.path, cwd: resolveAppServerCwd({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }) });
    const direct = input.codexProjectId
      ? officialProjects.find((item) => String(item?.id || "") === String(input.codexProjectId))
      : undefined;
    const resolved = direct
      ? { project: direct, root: (Array.isArray(direct.roots) ? direct.roots : []).map((entry) => typeof entry === "string" ? { path: entry } : entry).find((entry) => entry?.path) || null, match: { query, score: 1, kind: "id", matchedName: String(direct.id) } }
      : resolveCodexProjectByName({ name: query, projects: officialProjects });
    const sourceProjectId = String(resolved.project.id);
    const sourceProjectName = String(resolved.project.name || sourceProjectId);
    const targetProject = (input.targetProjectId || input.harnessProjectId)
      ? store.state.projects.find((item) => item.id === String(input.targetProjectId || input.harnessProjectId))
      : undefined;
    const rootPath = selectCodexProjectRoot({
      project: resolved.project,
      query,
      matchedName: resolved.match?.matchedName,
      requestedPath: input.path || input.root || targetProject?.path,
    });
    if (!rootPath) throw new Error(`Codex Project“${sourceProjectName}”没有可用根目录，暂不能启动回填 Agent；请先在 Codex Project 中绑定工作区`);
    let sourceThreads = [];
    try {
      const recentThreads = await listAllCodexThreads({ executable: codex.path, cwd: rootPath, maxThreads: 5000, pageSize: 200 });
      sourceThreads = selectCodexProjectThreads(recentThreads, {
        project: resolved.project,
        query,
        matchedName: resolved.match?.matchedName,
        limit: 5000,
      });
    } catch (error) {
      try { errorLog?.capture(error, { operation: "project:import-codex", stage: "thread-index", context: { queryLength: query.length } }); } catch {}
    }

    progress("saving_state", 42, "正在建立 Harness 导入记录", `${sourceProjectName} · ${rootPath}`);
    const requested = store.update((state) => machine.requestCodexProjectImport(state, {
      codexProjectId: sourceProjectId,
      targetProjectId: input.targetProjectId || input.harnessProjectId,
      name: sourceProjectName,
      path: rootPath,
    }));
    const projectId = requested.project.id;
    const taskId = requested.task.id;
    mutableProjectId = projectId;
    mutableTaskId = taskId;
    // An existing active import is never duplicated. If it already has a
    // thread, just reopen that exact conversation; if it is still queued,
    // continue below and dispatch the one durable task.
    if (requested.reused && ["in_progress", "awaiting_result", "review"].includes(requested.task.status)) {
      const existingThread = requested.task.run?.externalThreadId;
      if (!existingThread && requested.task.status !== "review") {
        store.update((state) => machine.markExternalLaunchFailed(state, projectId, taskId, "导入任务没有可恢复的 Codex thread，正在重新启动"));
      } else {
      let desktop;
      if (existingThread) desktop = await openCodexDesktop(codex.path, requested.project.path, { threadId: existingThread, openExternal: (uri) => shell.openExternal(uri), preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1" });
      return { projectId, taskId, threadId: existingThread, status: requested.task.status === "review" ? "awaiting_review" : "running", reused: true, matchedProjectName: sourceProjectName, match: resolved.match, desktopOpened: desktop ? Boolean(desktop.opened) : true, desktopError: desktop?.error, snapshot: await buildSnapshot() };
      }
    }

    const dispatched = store.update((state) => {
      const result = machine.dispatchTask(state, projectId, taskId);
      const target = machine.getProject(state, projectId);
      target.codexProjectId = sourceProjectId;
      machine.setCodexProjectSync(state, projectId, { officialProjectId: sourceProjectId, state: "app-server-confirmed", detail: "已从官方 project/list 找到该 Project；正在启动只读回填。" });
      target.codexImport = {
        ...(target.codexImport || {}),
        status: "running",
        codexProjectId: sourceProjectId,
        startedAt: new Date().toISOString(),
        sourceName: sourceProjectName,
        sourceRoots: (resolved.project.roots || []).map((entry) => typeof entry === "string" ? entry : entry?.path).filter(Boolean).slice(0, 20),
        sourceThreads: sourceThreads.map(({ id, name, updatedAt, recencyAt, match, score }) => ({ id, name, updatedAt, recencyAt, match, score })),
        sourceThreadCount: sourceThreads.length,
        archiveQueue: sourceThreads.filter((thread) => thread.path).map(({ id, name, path: sourcePath }) => ({ id, name, path: sourcePath })),
      };
      return result;
    });
    progress("creating_thread", 64, "正在创建 Codex Project 回填对话", sourceProjectName);
    const latestProject = machine.getProject(store.state, projectId);
    const importContext = {
      harness: buildProjectContext(latestProject, { maxTasks: 15, maxCheckpoints: 8, maxEvents: 12 }),
      codexProject: {
        id: sourceProjectId,
        name: sourceProjectName,
        roots: (resolved.project.roots || []).map((entry) => typeof entry === "string" ? { path: entry } : { path: entry?.path }).filter((entry) => entry.path),
      },
      sourceThreads: sourceThreads.slice(0, 20).map(({ id, name, cwd, path: rolloutPath, preview, createdAt, updatedAt, recencyAt, projectId: threadProjectId, gitInfo, match, score }) => ({ id, name, cwd, rolloutPath, preview: String(preview || "").slice(0, 400), createdAt, updatedAt, recencyAt, projectId: threadProjectId, gitInfo, match, score })),
    };
    const skillPath = resolveBundledSkillPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
    const schemaPath = resolveBundledProtocolPath({ fileName: "harness-import.schema.json", isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
    if (!fs.existsSync(skillPath)) throw new Error("Harness 内置 Codex Skill 缺失，已停止导入");
    if (!fs.existsSync(schemaPath)) throw new Error("Harness 内置导入协议缺失，已停止导入");
    const launched = await launchHarnessImport({
      executable: codex.path,
      project: latestProject,
      sourceProjectId,
      skillPath,
      schemaPath,
      openExternal: (uri) => shell.openExternal(uri),
      preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1",
      context: importContext,
    });
    store.update((state) => {
      machine.attachExternalThread(state, projectId, taskId, {
        threadId: launched.threadId,
        turnId: launched.turnId,
        processId: launched.processId,
        projectId: sourceProjectId,
        desktopOpened: Boolean(launched.desktop?.opened),
      });
      const target = machine.getProject(state, projectId);
      target.codexImport = { ...(target.codexImport || {}), status: "running", startedAt: target.codexImport?.startedAt || new Date().toISOString(), threadId: launched.threadId };
    });
    registerLaunchedRuntime(launched, { projectId, taskId }, {
      importMode: true,
      onImportCandidate: async (candidate, metadata = {}) => {
        if (candidate.source?.codexProjectId && String(candidate.source.codexProjectId) !== sourceProjectId) throw new Error("HARNESS_IMPORT_SOURCE_MISMATCH: 来源 Project 与请求不一致");
        store.update((state) => machine.recordCodexImportCandidate(state, projectId, taskId, candidate, metadata));
        await publishRuntimeSnapshot({ type: "codex.project.import.awaiting-review", detail: sourceProjectName });
      },
    });
    // Source rollouts are streamed into the content-addressed archive without
    // blocking the Agent or injecting their raw bytes into model context.
    void archiveCodexSourceThreads(projectId, taskId, sourceThreads).catch((error) => {
      try { errorLog?.capture(error, { operation: "codex-import-source-archive", stage: "background", context: { projectId, taskId } }); } catch {}
    });
    progress("waiting_agent", 86, "Codex 正在盘点项目并生成回填候选", "原始运行会单独归档；完成后需要你审核");
    const snapshot = await buildSnapshot();
    return {
      projectId,
      taskId,
      threadId: launched.threadId,
      status: "running",
      reused: false,
      matchedProjectName: sourceProjectName,
      match: resolved.match,
      desktopOpened: Boolean(launched.desktop?.opened),
      desktopError: launched.desktop?.error,
      snapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // If a task was already dispatched, make the failure retryable without
    // inventing an imported Project. Earlier stages have no mutable target.
    try {
      const current = mutableProjectId ? store?.state?.projects?.find((project) => project.id === mutableProjectId) : undefined;
      const importTask = current?.tasks?.find((task) => task.id === mutableTaskId && ["in_progress", "awaiting_result"].includes(task.status));
      if (current && importTask) store.update((state) => machine.markExternalLaunchFailed(state, current.id, importTask.id, message));
    } catch {}
    let errorId;
    try { errorId = errorLog?.capture(error, { operation: "project:import-codex", stage, context: { queryLength: query.length } })?.id; } catch {}
    throw new Error(errorId ? `${message}\n错误编号：${errorId}` : message);
  }
}

async function connectHarnessProject(projectId, payload = {}) {
  let project = machine.getProject(store.state, projectId);
  let projectPath = String(payload.path || payload.projectPath || project.path || "").trim();
  if (!projectPath) {
    const dataRoot = store.contextRoot || path.dirname(store.filePath);
    projectPath = createManagedWorkspace({ dataRoot, name: project.name }).path;
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
    const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true });
    markCodexDesktopRegistered(project.id, plane.codexProjectId);
    store.update((state) => {
      const target = machine.getProject(state, project.id);
      target.source = { kind: "connected", label: "已连接 Codex Desktop" };
      target.codexProjectId = plane.codexProjectId;
      target.codexConnectedAt = new Date().toISOString();
      target.codexSyncError = undefined;
    });
    return { projectId: project.id, codexProjectId: plane.codexProjectId, ctoThreadId: plane.ctoThreadId, reviewThreadId: plane.reviewThreadId, desktopOpened: plane.opened.every((item) => item.opened) };
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
  ipcMain.handle("harness:snapshot", buildSnapshot);

  const guideActions = createGuideActionExecutor({
    state: guideStore.state,
    persist: (state) => guideStore.write(state),
    handlers: {
      "project.create-blank": async (payload) => {
        const project = store.update((state) => machine.createBlankProject(state, payload));
        return { projectId: project.id };
      },
      "project.connect": async (payload) => connectHarnessProject(payload.projectId, payload),
    },
  });

  ipcMain.handle("guide:update", async (_event, input = {}) => {
    guideStore.update((state) => {
      if (input.locale === "en" || input.locale === "zh-CN") state.locale = input.locale;
      if (typeof input.dismissed === "boolean") state.dismissed = input.dismissed;
      if (input.activeProjectId === null || typeof input.activeProjectId === "string") state.activeProjectId = input.activeProjectId || undefined;
    });
    return buildSnapshot();
  });
  ipcMain.handle("guide:probe", async (_event, subject) => {
    const allowed = new Set(["codex-desktop", "codex-cli", "codex-login", "app-server", "deep-link", "git", "network", "release-integrity"]);
    if (!allowed.has(String(subject))) throw new Error("Guide probe is not allowlisted");
    const probe = await guideProbeRunner.run(String(subject));
    guideStore.update((state) => { state.probes[String(subject)] = probe; });
    return { probe, snapshot: await buildSnapshot() };
  });
  ipcMain.handle("guide:cancel-probe", (_event, subject) => guideProbeRunner.cancel(String(subject || "")));
  ipcMain.handle("guide:operation", (_event, operationId) => guideActions.lookup(String(operationId || "")));

  const openTask = createTaskOpenHandler({
    store,
    machine,
    detectCodex: () => detectCommand("codex"),
    openDesktop: openCodexDesktop,
    terminateProcessTree: terminateCodexProcessTree,
    isProcessAlive,
    buildSnapshot,
    openExternal: (uri) => shell.openExternal(uri),
    openWorkspace: (projectPath) => shell.openPath(projectPath),
    listThreads: ({ executable, cwd }) => listRecentCodexThreads({ executable, cwd }),
    isThreadActive: (threadId) => activeCodexClients.has(threadId),
  });
  const openProject = createProjectOpenHandler({
    store,
    machine,
    detectCodex: () => detectCommand("codex"),
    openDesktop: openCodexDesktop,
    buildSnapshot,
    openExternal: (uri) => shell.openExternal(uri),
    listThreads: ({ executable, cwd }) => listRecentCodexThreads({ executable, cwd }),
    isThreadActive: (threadId) => activeCodexClients.has(threadId),
  });

  const onboardProject = createProjectOnboarding({
    store,
    getCodex: () => detectCommand("codex"),
    appServerCwd: resolveAppServerCwd({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    listProjects: ({ executable, cwd }) => listCodexProjects({ executable, cwd }),
    skillPath: resolveBundledSkillPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    openExternal: (uri) => shell.openExternal(uri),
    ensureProjectFolder: async (input) => {
      // Do not pre-write the Desktop-owned compatibility JSON. It can race
      // with Codex's atom flush and erase newer Projects. The official
      // app-server call below is the durable creation path; legacy mapping is
      // retained only for an explicit compatibility opt-in.
      let folder;
      if (allowLegacyCodexStateSync) {
        try { folder = ensureCodexProjectFolder({ ...input, statePath: codexFolderStatePath, enabled: allowLegacyCodexStateSync }); } catch (error) {
          try { errorLog?.capture(error, { operation: "codex-legacy-state-sync", stage: "onboarding-prewrite" }); } catch {}
        }
      }
      if (process.env.APH_DISABLE_CODEX_PROJECT_PROVISION === "1") return { legacyProjectId: folder?.projectId };
      const official = await ensureCodexProject({
        executable: input.executable,
        cwd: input.cwd || input.projectPath,
        projectPath: input.projectPath,
        projectName: input.projectName,
      });
      if (allowLegacyCodexStateSync) {
        try {
          folder = ensureCodexProjectFolder({
            ...input,
            officialProjectId: official.projectId,
            statePath: codexFolderStatePath,
            enabled: allowLegacyCodexStateSync,
          });
        } catch (error) {
          try { errorLog?.capture(error, { operation: "codex-legacy-state-sync", stage: "onboarding-postwrite" }); } catch {}
        }
      }
      return { ...official, legacyProjectId: folder?.projectId };
    },
    assignThreadToProjectFolder: (input) => {
      if (!allowLegacyCodexStateSync) return { skipped: true, ...input };
      return assignCodexThreadToProjectFolder({ ...input, statePath: codexFolderStatePath, enabled: allowLegacyCodexStateSync });
    },
    ensureControlSessions: async ({ project, codex, folder }) => {
      for (const session of project.sessions.filter((item) => ["cto", "review"].includes(item.role) && !item.externalThreadId)) {
        await ensureControlThread(project, session, codex, folder?.projectId);
      }
    },
    buildSnapshot,
    onLaunched(launched, context) { registerLaunchedRuntime(launched, context, { autoReview: process.env.APH_AUTO_REVIEW === "1" }); },
  });
  const handleOnboarding = createOnboardingIpcHandler({ onboardProject, errorLog });
  ipcMain.handle("project:add-by-name", handleOnboarding);
  // Blank creation is deliberately local-only: unlike onboarding it never
  // searches Codex/recent CWDs and never starts an Agent. The resulting
  // project can be filled by hand before the user opts into a Codex session.
  ipcMain.handle("project:create-blank", async (_event, input) => {
    const payload = typeof input === "string" ? { name: input } : (input || {});
    let projectId;
    if (payload.operationId) {
      const operation = await guideActions.execute({
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
    return { projectId, snapshot: await buildSnapshot() };
  });
  ipcMain.handle("project:connect-codex", async (_event, projectId, input = {}) => {
    const payload = { ...input, projectId };
    const operationId = String(input.operationId || "").trim();
    const result = operationId
      ? await guideActions.execute({ operationId, actionId: "project.connect", targetFingerprint: String(input.targetFingerprint || `project:${projectId}`), confirmedAt: input.confirmedAt, payload })
      : { result: await connectHarnessProject(projectId, payload) };
    return { ...result.result, snapshot: await buildSnapshot() };
  });
  ipcMain.handle("project:create-connected", async (_event, input) => {
    const payload = input && typeof input === "object" ? input : { name: input };
    const name = String(payload.name || payload.title || "").trim();
    if (!name) throw new Error("Project name is required");
    let projectPath = String(payload.path || payload.projectPath || "").trim();
    if (!projectPath) {
      const dataRoot = store.contextRoot || path.dirname(store.filePath);
      projectPath = createManagedWorkspace({ dataRoot, name }).path;
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
      const connected = await connectHarnessProject(project.id, { ...payload, path: projectPath });
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
  ipcMain.handle("project:import-codex", (event, input) => importCodexProjectFromName(event, input || {}));
  ipcMain.handle("diagnostics:show-error-log", () => diagnostics.showErrorLog());
  ipcMain.handle("diagnostics:report-renderer-error", (_event, details) => diagnostics.reportRendererError(details));

  ipcMain.handle("project:select", async (_event, projectId) => {
    store.update((state) => {
      machine.getProject(state, projectId);
      state.selectedProjectId = projectId;
    });
    return buildSnapshot();
  });

  ipcMain.handle("task:create", async (_event, projectId, input) => {
    store.update((state) => machine.createTask(state, projectId, input || {}));
    return buildSnapshot();
  });

  ipcMain.handle("task:dispatch", async (_event, projectId, taskId) => {
    try {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    // Import retries must use the dedicated read-only Project hydration
    // protocol; routing them through the ordinary task prompt would emit a
    // harness-result and silently lose the Codex Project history.
    if (task?.workstream === "codex-project-import") {
      return importCodexProjectFromName(_event, {
        name: project.codexImport?.sourceName || project.codexImport?.codexProjectId || project.name,
        codexProjectId: project.codexImport?.codexProjectId,
        targetProjectId: project.id,
        path: project.path,
      });
    }
    if (task?.agent === "claude" || task?.agent === "hermes") {
      const prepared = store.update((state) => machine.prepareUserAgentTask(state, projectId, taskId));
      clipboard.writeText(prepared.missionPacket);
      return { snapshot: await buildSnapshot(), missionPacket: prepared.missionPacket, userActionRequired: true, agent: task.agent };
    }
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法启动任务");
    // Create/resolve the real Codex Desktop Project before mutating Harness
    // task state. A failed project provision must not leave a task falsely
    // marked as running without a place to continue it.
    const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: false });
    const codexProjectId = plane.codexProjectId;
    const result = store.update((state) => machine.dispatchTask(state, projectId, taskId));
    clipboard.writeText(result.missionPacket);
    if (codex.installed && process.env.APH_DISABLE_AGENT_LAUNCH !== "1") {
      const skillPath = resolveBundledSkillPath({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      });
      void launchHarnessTask({
        executable: codex.path,
        project,
        task: result.task,
        missionPacket: result.missionPacket,
        skillPath,
        projectId: codexProjectId,
        openExternal: (uri) => shell.openExternal(uri),
        preferProjectPath: false,
      }).then((launched) => {
        store.update((state) => machine.attachExternalThread(state, projectId, taskId, {
          threadId: launched.threadId,
          turnId: launched.turnId,
          processId: launched.processId,
          projectId: launched.projectId || codexProjectId,
          desktopOpened: launched.desktop.opened,
        }));
        if (allowLegacyCodexStateSync) try {
          assignCodexThreadToProjectFolder({
            threadId: launched.threadId,
            projectId: codexProjectId,
            statePath: codexFolderStatePath,
            enabled: allowLegacyCodexStateSync,
          });
        } catch {
          // Codex folder grouping is best effort; task monitoring remains usable.
        }
        registerLaunchedRuntime(launched, { projectId, taskId }, { autoReview: process.env.APH_AUTO_REVIEW === "1" });
        void publishRuntimeSnapshot({ type: "agent.run.started", detail: result.task.title });
      }).catch((error) => {
        try {
          errorLog?.capture(error, { operation: "task:dispatch", stage: "launch", context: { projectId, taskId } });
          store.update((state) => machine.markExternalLaunchFailed(state, projectId, taskId, error?.message || error));
          void publishRuntimeSnapshot({ type: "agent.run.failed", detail: String(error?.message || error) });
        } catch {
          // The task may have been changed by a concurrent user action.
        }
      });
    }
    return { snapshot: await buildSnapshot(), missionPacket: result.missionPacket };
    } catch (error) {
      let errorId;
      try { errorId = errorLog?.capture(error, { operation: "task:dispatch", stage: "preflight", context: { projectId, taskId } })?.id; } catch {}
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(errorId ? `${message}\n错误编号：${errorId}` : message);
    }
  });

  ipcMain.handle("task:submit-result", async (_event, projectId, taskId, input) => {
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

  ipcMain.handle("task:stop", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    const threadId = task?.run?.externalThreadId;
    const runtime = threadId ? activeCodexClients.get(threadId) : undefined;
    if (runtime) {
      runtime.intentionalStop = true;
      try { runtime.client.close(new Error("任务由用户停止")); } catch {}
      activeCodexClients.delete(threadId);
    } else if (task?.run?.processId && isProcessAlive(task.run.processId)) {
      await terminateCodexProcessTree(task.run.processId);
    }
    store.update((state) => machine.stopTask(state, projectId, taskId));
    return buildSnapshot();
  });

  ipcMain.handle("task:accept", async (_event, projectId, taskId) => {
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
    });
    return buildSnapshot();
  });

  ipcMain.handle("task:request-changes", async (_event, projectId, taskId) => {
    const currentTask = machine.getProject(store.state, projectId).tasks.find((item) => item.id === taskId);
    if (currentTask?.workstream === "codex-project-import" && currentTask.run?.externalThreadId) {
      const runtime = activeCodexClients.get(currentTask.run.externalThreadId);
      if (runtime) {
        runtime.intentionalStop = true;
        try { runtime.client.close(new Error("用户要求重新盘点 Codex Project")); } catch {}
        activeCodexClients.delete(currentTask.run.externalThreadId);
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

  ipcMain.handle("task:reject", async (_event, projectId, taskId, reason) => {
    const currentTask = machine.getProject(store.state, projectId).tasks.find((item) => item.id === taskId);
    if (currentTask?.workstream === "codex-project-import" && currentTask.run?.externalThreadId) {
      const runtime = activeCodexClients.get(currentTask.run.externalThreadId);
      if (runtime) {
        runtime.intentionalStop = true;
        try { runtime.client.close(new Error("用户拒绝 Codex 项目导入")); } catch {}
        activeCodexClients.delete(currentTask.run.externalThreadId);
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

  ipcMain.handle("mission:copy", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task || !task.run) throw new Error("Task has no active run");
    const session = project.sessions.find((item) => item.id === task.run.sessionId);
    if (!session) throw new Error("Session not found");
    const packet = machine.buildMissionPacket(project, task, session);
    clipboard.writeText(packet);
    return { copied: true, packet };
  });

  ipcMain.handle("git:refresh", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    return buildSnapshot({ forceGithub: true });
  });

  ipcMain.handle("github:refresh", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    return buildSnapshot({ forceGithub: true });
  });

  ipcMain.handle("github:set-remote", async (_event, projectId, remoteUrl, name) => {
    const project = machine.getProject(store.state, projectId);
    const remote = await setGitRemote(project.path, remoteUrl, { name });
    return { remote, snapshot: await buildSnapshot({ forceGithub: true }) };
  });

  ipcMain.handle("project:set-status", async (_event, projectId, status) => {
    store.update((state) => machine.setProjectStatus(state, projectId, String(status || "active")));
    return buildSnapshot();
  });

  ipcMain.handle("project:archive", async (_event, projectId, reason) => {
    store.update((state) => machine.archiveProject(state, projectId, reason));
    return buildSnapshot();
  });

  ipcMain.handle("project:restore", async (_event, projectId) => {
    store.update((state) => machine.restoreProject(state, projectId));
    return buildSnapshot();
  });

  ipcMain.handle("project:update-contract", async (_event, projectId, input) => {
    store.update((state) => machine.updateProjectContract(state, projectId, input || {}));
    return buildSnapshot();
  });
  ipcMain.handle("project:refresh-profile", async (_event, projectId) => {
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
  ipcMain.handle("project:list-templates", async () => listTemplates());
  ipcMain.handle("project:apply-template", async (_event, projectId, templateId) => {
    store.update((state) => applyProjectTemplate(state, projectId, templateId));
    return buildSnapshot();
  });

  ipcMain.handle("objective:create", async (_event, projectId, input) => {
    store.update((state) => machine.createObjective(state, projectId, input || {}));
    return buildSnapshot();
  });

  ipcMain.handle("objective:set-status", async (_event, projectId, status) => {
    store.update((state) => machine.setObjectiveStatus(state, projectId, String(status || "active")));
    return buildSnapshot();
  });
  ipcMain.handle("project:add-decision", async (_event, projectId, input) => {
    store.update((state) => applyDecisionProposal(state, projectId, input || {}));
    return buildSnapshot();
  });

  ipcMain.handle("project:activity", async (_event, projectId, limit) => {
    const project = machine.getProject(store.state, projectId);
    return machine.getProjectActivity(project, { limit });
  });

  ipcMain.handle("section:create", async (_event, projectId, input) => {
    store.update((state) => machine.createSection(state, projectId, input || {}));
    return buildSnapshot();
  });

  ipcMain.handle("section:assign-task", async (_event, projectId, taskId, sectionId) => {
    store.update((state) => machine.assignTaskToSection(state, projectId, taskId, sectionId));
    return buildSnapshot();
  });

  ipcMain.handle("section:close", async (_event, projectId, sectionId, reason) => {
    store.update((state) => machine.closeSection(state, projectId, sectionId, reason));
    return buildSnapshot();
  });

  ipcMain.handle("section:archive", async (_event, projectId, sectionId, reason) => {
    store.update((state) => machine.archiveSection(state, projectId, sectionId, reason));
    return buildSnapshot();
  });

  ipcMain.handle("archive:import", async (event, projectId, requestedPath) => {
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

  ipcMain.handle("archive:list", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    return listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId });
  });
  ipcMain.handle("archive:verify", async (_event, projectId, hash) => {
    machine.getProject(store.state, projectId);
    const manifest = listArchiveManifests(store.contextRoot || path.dirname(store.filePath), { projectId }).find((item) => item.sha256 === String(hash));
    if (!manifest) throw new Error("Archive manifest not found");
    return verifyArchiveObject(store.contextRoot || path.dirname(store.filePath), manifest);
  });

  ipcMain.handle("archive:open", async (_event, projectId) => {
    machine.getProject(store.state, projectId);
    const target = path.join(store.contextRoot || path.dirname(store.filePath), "archive");
    const error = await shell.openPath(target);
    return { opened: !error, path: target, ...(error ? { error } : {}) };
  });

  ipcMain.handle("archive:open-run", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    const target = task?.run?.transcriptPath;
    if (!target) throw new Error("该任务还没有运行归档");
    const error = await shell.openPath(target);
    return { opened: !error, path: target, ...(error ? { error } : {}) };
  });

  ipcMain.handle("project:open-ledger", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    const target = project.ledger?.path || path.join(store.contextRoot || path.dirname(store.filePath), "projects", project.id, "PROJECT-LEDGER.md");
    const error = await shell.openPath(target);
    return { opened: !error, path: target, ...(error ? { error } : {}) };
  });

  ipcMain.handle("project:open-path", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    if (!project.path) return { opened: false, path: "", error: "空白项目尚未绑定本地目录" };
    const error = await shell.openPath(project.path);
    return { opened: !error, path: project.path, ...(error ? { error } : {}) };
  });
  ipcMain.handle("window:toggle-pin", async () => {
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

  ipcMain.handle("project:export", async (_event, projectId, requestedPath) => {
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

  ipcMain.handle("project:import", async (_event, requestedPath) => {
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

  ipcMain.handle("project:open-cto", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    if (!project.path) throw new Error("空白项目还没有项目目录；请先绑定本地工作区，再打开 CTO");
    let cto = project.sessions.find((item) => item.role === "cto");
    if (!cto) {
      store.update((state) => machine.ensureProjectControlSessions(machine.getProject(state, projectId)));
      cto = machine.getProject(store.state, projectId).sessions.find((item) => item.role === "cto");
    }
    if (!cto) throw new Error("CTO 控制 Session 未建立");
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法打开 CTO Session");

    // Ensure both control threads before opening the requested CTO entry. A
    // previous implementation only repaired CTO here, leaving Review absent.
    const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true });
    markCodexDesktopRegistered(projectId, plane.codexProjectId);
    const codexProjectId = plane.codexProjectId;
    cto = machine.getProject(store.state, projectId).sessions.find((item) => item.role === "cto");

    // Persisting the packet is handled by HarnessStore.write. Repair old
    // profiles that do not yet have the derived file before opening Desktop.
    if (!cto || !cto.externalThreadId) throw new Error("CTO 控制 Session 没有 Codex thread");
    if (codexProjectId) {
      if (allowLegacyCodexStateSync) try {
        assignCodexThreadToProjectFolder({ threadId: cto.externalThreadId, projectId: codexProjectId, statePath: codexFolderStatePath, enabled: allowLegacyCodexStateSync });
      } catch {
        // Folder grouping is best effort; opening the CTO remains usable.
      }
    }
    store.write();
    const latestProject = machine.getProject(store.state, projectId);
    const packetPath = latestProject.contextPackets?.cto?.path;
    if (!packetPath) throw new Error("CTO 项目上下文文件未生成");
    const draftReference = `@${packetPath}`;
    // Codex app-server has no public composer-draft API. Put the file mention
    // on the clipboard so the user can paste it into the opened composer and
    // continue asking questions before sending; nothing is auto-submitted.
    clipboard.writeText(draftReference);
    const opened = await openCodexDesktop(codex.path, latestProject.path, {
      threadId: cto.externalThreadId,
      openExternal: (uri) => shell.openExternal(uri),
      // Release smoke can exercise the full IPC and file path without
      // interrupting the user's existing Desktop window.
      preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1",
    });
    store.update((state) => machine.markControlSessionOpened(state, projectId, "cto", packetPath));
    return {
      ...opened,
      supported: true,
      capability: opened.capability ? `${opened.capability}+draft-reference-clipboard` : "thread-deep-link+draft-reference-clipboard",
      threadId: cto.externalThreadId,
      packetPath,
      draftReference,
      message: opened.opened
        ? "已打开 CTO 主 Session；精简项目上下文已生成并复制为待发送文件引用（未发送）。"
        : "CTO 上下文文件已生成并复制为待发送引用，但 Codex Desktop 未能打开，请重试。",
      snapshot: await buildSnapshot(),
    };
  });

  ipcMain.handle("project:new-conversation", async (_event, projectId, input) => {
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
    const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: false });
    const codexProjectId = plane.codexProjectId;
    const session = store.update((state) => machine.createConversationSession(state, projectId, input || {}));
    try {
      const created = await createCodexControlThread({
        executable: codex.path,
        projectPath: project.path,
        name: session.title,
        projectId: codexProjectId,
        bootstrapText: [
          "# AI Project Harness · 项目新对话已就绪",
          `PROJECT: ${project.name}`,
          `PROJECT_PATH: ${project.path}`,
          "这是一个新的项目对话入口。等待用户输入。",
        ].join("\n"),
      });
      store.update((state) => {
        const target = machine.getProject(state, projectId).sessions.find((item) => item.id === session.id);
        if (target) { target.externalThreadId = created.threadId; target.externalProjectId = codexProjectId; target.lastOpenedAt = new Date().toISOString(); }
      });
      if (allowLegacyCodexStateSync) try { assignCodexThreadToProjectFolder({ threadId: created.threadId, projectId: codexProjectId, statePath: codexFolderStatePath, enabled: allowLegacyCodexStateSync }); } catch {}
      const opened = await openCodexDesktop(codex.path, project.path, { threadId: created.threadId, openExternal: (uri) => shell.openExternal(uri), preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1" });
      return { ...opened, supported: true, threadId: created.threadId, message: opened.opened ? "已创建并打开项目新对话。" : "项目新对话已创建，但 Codex Desktop 未能自动打开。", snapshot: await buildSnapshot() };
    } catch (error) {
      store.update((state) => {
        const target = machine.getProject(state, projectId).sessions.find((item) => item.id === session.id);
        if (target) { target.status = "retired"; target.error = String(error?.message || error); }
      });
      throw error;
    }
  });

  ipcMain.handle("project:open-session", async (_event, projectId, sessionId) => {
    let project = machine.getProject(store.state, projectId);
    let session = project.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("Session not found");
    if (session.externalThreadId && session.agent === "codex") {
      const codex = await detectCommand("codex");
      if (codex.installed) {
        try {
          const health = await inspectCodexThread({ executable: codex.path, cwd: project.path, threadId: session.externalThreadId });
          if (!health.readable) {
            const officialId = await ensureProjectFolder(project, codex, { verify: true });
            await ensureControlThread(project, session, codex, officialId, { verifyExisting: true });
            project = machine.getProject(store.state, projectId);
            session = project.sessions.find((item) => item.id === sessionId);
          }
        } catch (error) {
          // A transient app-server read failure should not hide the existing
          // deep link; the opener below still reports a concrete Desktop error.
          try { errorLog?.capture(error, { operation: "project:open-session", stage: "history-probe", context: { projectId, sessionId } }); } catch {}
        }
      }
      const opened = await openCodexDesktop(codex.path, project.path, { threadId: session.externalThreadId, openExternal: (uri) => shell.openExternal(uri), preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1" || activeCodexClients.has(session.externalThreadId) });
      store.update((state) => {
        const target = machine.getProject(state, projectId).sessions.find((item) => item.id === sessionId);
        if (target) target.lastOpenedAt = new Date().toISOString();
      });
      return { ...opened, supported: true, threadId: session.externalThreadId, message: opened.opened ? "已打开项目对话。" : "项目对话已存在，但 Desktop 未能打开。", snapshot: await buildSnapshot() };
    }
    const error = await shell.openPath(project.path);
    return { opened: !error, supported: true, capability: "user-invoked-workspace", message: !error ? "已打开项目工作区，请在对应 Agent 中继续。" : `工作区未能打开：${error}`, snapshot: await buildSnapshot(), ...(error ? { error } : {}) };
  });

  ipcMain.handle("task:open-agent", (_event, projectId, taskId) => openTask(projectId, taskId));
  ipcMain.handle("task:open-workspace", async (_event, projectId, taskId) => {
    const project = machine.getProject(store.state, projectId);
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Task not found");
    const error = await shell.openPath(project.path);
    return { opened: !error, path: project.path, agent: task.agent, ...(error ? { error } : {}) };
  });
  ipcMain.handle("project:open-codex", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    if (!project.path) throw new Error("这是空白项目；请先填写项目目录，再连接 Codex Project");
    const codex = await detectCommand("codex");
    if (codex.installed && project.status !== "archived") {
      const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true });
      markCodexDesktopRegistered(projectId, plane.codexProjectId);
    }
    return openProject(projectId);
  });
  ipcMain.handle("project:sync-codex", async (_event, projectId) => {
    const project = machine.getProject(store.state, projectId);
    if (!project.path) throw new Error("空白项目还没有项目目录；请先在项目契约中绑定本地工作区");
    const codex = await detectCommand("codex");
    if (!codex.installed) throw new Error("未检测到 Codex，无法同步 Project");
    try {
      const plane = await ensureProjectControlPlane(project, codex, { verifyProject: true, openThreads: true, forceRegistration: true });
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
  const projectPath = resolveAppServerCwd({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const dataRoot = resolveDataRoot({ userDataPath: app.getPath("userData") });
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
  guideStore = new GuideStateStore(path.join(dataRoot, "guide-state.json"));
  guideProbeRunner = createProbeRunner({
    detectors: {
      "codex-cli": async () => {
        const codex = await detectCommand("codex");
        return { status: codex.installed ? "ok" : "missing", capabilityVersion: codex.version, safeSummary: codex.installed ? "已检测到 Codex CLI" : "未检测到 Codex CLI", remediationActionIds: codex.installed ? [] : ["help.open", "probe.recheck"] };
      },
      "codex-desktop": async () => {
        const codex = await detectCommand("codex");
        return { status: codex.installed ? "ok" : "missing", safeSummary: codex.installed ? "已检测到 Codex 安装入口；Desktop 可见性仍需实际打开验证" : "未检测到 Codex", remediationActionIds: codex.installed ? [] : ["help.open", "probe.recheck"] };
      },
      "codex-login": async () => {
        const codex = await detectCommand("codex");
        if (!codex.installed) return { status: "missing", safeSummary: "未检测到 Codex，无法检查登录", remediationActionIds: ["help.open", "probe.recheck"] };
        try {
          await listCodexProjects({ executable: codex.path, cwd: projectPath });
          return { status: "ok", safeSummary: "Codex app-server 已完成只读授权检查", remediationActionIds: [] };
        } catch (error) {
          if (/unauth|login|401|403|authorization/i.test(String(error?.message || error))) return { status: "unauth", safeSummary: "已找到 Codex，但尚未验证登录", remediationActionIds: ["probe.recheck"] };
          throw error;
        }
      },
      "app-server": async () => {
        const codex = await detectCommand("codex");
        if (!codex.installed) return { status: "missing", safeSummary: "未检测到 Codex CLI", remediationActionIds: ["help.open"] };
        await listCodexProjects({ executable: codex.path, cwd: projectPath });
        return { status: "ok", safeSummary: "当前版本支持实验性 app-server Project 只读检查", remediationActionIds: [] };
      },
      "deep-link": async () => ({ status: "unknown", safeSummary: "精确对话打开需在用户触发后以实际结果验证", remediationActionIds: [] }),
      git: async () => {
        const git = await detectCommand("git");
        return { status: git.installed ? "ok" : "missing", safeSummary: git.installed ? "已检测到 Git（仅用于可选证据）" : "未检测到 Git；本地空白项目仍可使用", remediationActionIds: [] };
      },
      network: async () => ({ status: "unknown", safeSummary: "未主动发起联网探测", remediationActionIds: [] }),
      "release-integrity": async () => ({ status: app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "app.asar")) ? "ok" : "unknown", safeSummary: app.isPackaged ? "已找到打包运行时" : "开发模式不代表 Release 完整性", remediationActionIds: [] }),
    },
  });
  registerIpc();
  createWindow();
  void resumePendingCodexArchives();
  // Repair projects created by pre-0.0.12 versions in the background. This is
  // idempotent and safe to retry when Codex is temporarily unavailable.
  void provisionMissingControlThreads();
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
  for (const runtime of activeCodexClients.values()) {
    try { runtime.client.close(new Error("Harness 正在退出")); } catch {}
  }
  activeCodexClients.clear();
});
