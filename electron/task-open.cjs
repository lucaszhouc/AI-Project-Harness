const { runStillOwnsThread } = require("./conversation-open.cjs");
const { selectLatestCodexThread } = require("./codex-adapter.cjs");

function updateStore(store, mutator) {
  if (typeof store?.update === "function") return store.update(mutator);
  return mutator(store.state);
}

function taskFor(machine, state, projectId, taskId) {
  const project = machine.getProject(state, projectId);
  return { project, task: project.tasks.find((item) => item.id === taskId) };
}

// A project may still have durable Codex thread ids even when the CLI is not
// currently discoverable on PATH. Keep the top-level "open recent" action
// useful by selecting the newest persisted member before using the CLI index.
function selectPersistedProjectThread(project) {
  const candidates = [
    ...(project?.sessions || [])
      .filter((session) => session.agent === "codex" && session.externalThreadId)
      .map((session) => ({
        id: session.externalThreadId,
        recencyAt: session.lastOpenedAt || session.lastUsedAt || session.createdAt,
      })),
    ...(project?.tasks || [])
      .filter((task) => task.agent === "codex" && task.run?.externalThreadId)
      .map((task) => ({
        id: task.run.externalThreadId,
        recencyAt: task.run.lastEventAt || task.run.completedAt || task.run.startedAt || task.createdAt,
      })),
  ];
  return candidates
    .filter((item) => item.id)
    .sort((left, right) => String(right.recencyAt || "").localeCompare(String(left.recencyAt || "")))[0];
}

function createTaskOpenHandler({
  store,
  machine,
  detectCodex,
  openDesktop,
  terminateProcessTree = async () => ({ terminated: false }),
  isProcessAlive = () => false,
  buildSnapshot,
  openExternal,
  listThreads,
  openWorkspace,
  isThreadActive = () => false,
}) {
  return async function openTask(projectId, taskId) {
    let { project, task } = taskFor(machine, store.state, projectId, taskId);
    if (!task) throw new Error("Task not found");
    if (["claude", "hermes"].includes(task.run?.externalAgent) || ["claude", "hermes"].includes(task.agent)) {
      const agentName = task.agent === "hermes" || task.run?.externalAgent === "hermes" ? "Hermes" : "Claude Code";
      if (typeof openWorkspace === "function") {
        const opened = await openWorkspace(project.path);
        return { opened: !opened, supported: true, capability: "user-invoked-workspace", message: !opened ? `已打开项目工作区，请在 ${agentName} 中主动调用 Harness Skill。` : `项目工作区未能打开：${opened}`, snapshot: await buildSnapshot(), ...(opened ? { error: opened } : {}) };
      }
      return {
        opened: false,
        supported: false,
        capability: "user-invoked-only",
        message: `${agentName} 当前没有可验证的桌面任务深链；请在项目工作区中主动调用 Harness Skill。`,
        snapshot: await buildSnapshot(),
      };
    }

    const codex = await detectCodex();
    // Exact Desktop deep links do not need the CLI executable. Keep the
    // deep-link path usable when the user launched Harness without Codex on
    // PATH; the project fallback will still report a concrete error below.
    const executable = codex.installed ? codex.path : "";

    // Pre-0.0.13 tasks may not have persisted their thread id. Recover the
    // newest durable Codex conversation for this exact project path so the
    // task remains actionable after a migration. This is read-only and best
    // effort; an uncertain lookup falls through to the project entry below.
    let recoveredThread;
    if (!task.run?.externalThreadId && codex.installed && typeof listThreads === "function") {
      try {
        const threads = await listThreads({ executable: codex.path, cwd: project.path });
        recoveredThread = selectLatestCodexThread(threads, project.path);
      } catch {
        // The Desktop index can be unavailable while Codex is updating. The
        // project-path fallback still gives the user a deterministic entry.
      }
    }
    const threadId = task.run?.externalThreadId || recoveredThread?.id;

    const terminalRun = task.run && ["completed", "failed"].includes(String(task.run.status || "").toLowerCase());
    let cleanupError;
    if (terminalRun && task.run?.processId && isProcessAlive(task.run.processId)) {
      const cleaned = await terminateProcessTree(task.run.processId);
      if (cleaned?.terminated) {
        updateStore(store, (state) => {
          const latest = taskFor(machine, state, projectId, taskId).task;
          if (latest?.run) latest.run.processId = undefined;
        });
        ({ project, task } = taskFor(machine, store.state, projectId, taskId));
      } else {
        cleanupError = cleaned?.error || "无法释放 Codex app-server 进程";
      }
    }

    const opened = await openDesktop(executable, project.path, {
      threadId,
      // A live app-server owns the writer lock. Opening its exact deep link
      // would only show Codex's "opened in another app" screen, so use the
      // project entry until that process is released.
      preferProjectPath: Boolean(cleanupError)
        || runStillOwnsThread(task.run, isProcessAlive)
        || Boolean(threadId && isThreadActive(threadId)),
      openExternal,
    });
    if (task.run?.externalThreadId) {
      updateStore(store, (state) => machine.setExternalDesktopOpened(
        state,
        projectId,
        taskId,
        opened.opened,
      ));
    }

    const exact = opened.capability === "thread-deep-link";
    const message = opened.opened
      ? exact
        ? recoveredThread && !task.run?.externalThreadId
          ? "已打开该项目最近的 Codex 对话（旧任务未保存独立 thread）。"
          : "已打开 Codex 当前任务对话。"
        : cleanupError
          ? `已打开 Codex 项目目录，但未能精确跳转：${cleanupError}`
          : task.run
            ? "已打开 Codex 项目目录；当前任务仍在执行，Harness 已保留该任务 ID。"
            : "已打开 Codex 项目目录；最近对话深链不可用，Harness 已保留该任务记录。"
      : cleanupError
        ? `Codex 任务仍被运行进程占用，已打开项目入口但未能精确跳转：${cleanupError}`
        : "Codex Desktop 未能打开，请重试。";
    return {
      ...opened,
      supported: true,
      capability: opened.capability || "project-path-fallback",
      threadId,
      message,
      snapshot: await buildSnapshot(),
    };
  };
}

function createProjectOpenHandler({
  store,
  machine,
  detectCodex,
  openDesktop,
  buildSnapshot,
  openExternal,
  listThreads,
  isThreadActive = () => false,
}) {
  return async function openProject(projectId) {
    const project = machine.getProject(store.state, projectId);
    const codex = await detectCodex();
    const executable = codex.installed ? codex.path : "";
    let recentThread;
    if (codex.installed && typeof listThreads === "function") {
      try {
        const threads = await listThreads({ executable: codex.path, cwd: project.path });
        recentThread = selectLatestCodexThread(threads, project.path);
      } catch {
        // Opening the project itself remains useful when the thread index is
        // unavailable or Codex is restarting.
      }
    }
    recentThread ||= selectPersistedProjectThread(project);
    if (!codex.installed && !recentThread) {
      return {
        opened: false,
        supported: false,
        capability: "codex-unavailable",
        message: "未检测到 Codex，且项目没有可恢复的持久对话；请启动 Codex 后重试。",
        error: "Codex CLI executable unavailable",
        snapshot: await buildSnapshot(),
      };
    }
    const opened = await openDesktop(executable, project.path, {
      threadId: recentThread?.id,
      // A live app-server still owns the thread writer lock. Keep the safe
      // project entry in that case instead of sending Desktop to its lock
      // error screen.
      preferProjectPath: !recentThread || isThreadActive(recentThread.id),
      openExternal,
    });
    return {
      ...opened,
      supported: true,
      capability: opened.capability || "project-path-fallback",
      threadId: recentThread?.id,
      message: opened.opened
        ? recentThread && opened.capability === "thread-deep-link"
          ? "已打开该项目最近的 Codex 对话。"
          : "已打开 Codex 项目目录。"
        : "Codex Desktop 未能打开，请重试。",
      snapshot: await buildSnapshot(),
    };
  };
}

module.exports = { createTaskOpenHandler, createProjectOpenHandler };
