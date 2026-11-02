const { runStillOwnsThread } = require("./conversation-open.cjs");

function updateStore(store, mutator) {
  if (typeof store?.update === "function") return store.update(mutator);
  return mutator(store.state);
}

function taskFor(machine, state, projectId, taskId) {
  const project = machine.getProject(state, projectId);
  return { project, task: project.tasks.find((item) => item.id === taskId) };
}

// A project may still have a durable Desktop thread id from an explicit user
// handoff. No provider executable or background index is consulted here.
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
    const threadId = task.run?.externalThreadId;

    if (threadId && isThreadActive(threadId)) {
      return {
        opened: false,
        requestAccepted: false,
        verified: false,
        supported: true,
        capability: "active-thread-deferred",
        threadId,
        message: "该对话正在由 Harness 执行；连接释放后才能安全打开 Codex Desktop 对话。",
        snapshot: await buildSnapshot(),
      };
    }

    let cleanupError;

    const opened = await openDesktop("", project.path, {
      threadId,
      // A live Desktop 原生控制面 owns the writer lock. Opening its exact deep link
      // would only show Codex's "opened in another app" screen, so use the
      // project entry until that process is released.
      preferProjectPath: Boolean(threadId && isThreadActive(threadId)),
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
          ? "已向 Codex 请求打开任务对话；尚未验证原生窗口是否完成跳转。"

        : cleanupError
          ? `已打开 Codex 项目目录，但未能精确跳转：${cleanupError}`
          : task.run
            ? "已打开 Codex 项目目录，并非任务对话；该后台任务的实时信息仅在 Harness 可见。"
            : "已打开 Codex 项目目录；最近对话深链不可用，Harness 已保留该任务记录。"
      : cleanupError
        ? `Codex 任务仍被运行进程占用，已打开项目入口但未能精确跳转：${cleanupError}`
        : "Codex Desktop 未能打开，请重试。";
    return {
      ...opened,
      supported: true,
      capability: opened.capability || "desktop-native-only-blocked",
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
  isThreadActive = () => false,
}) {
  return async function openProject(projectId) {
    const project = machine.getProject(store.state, projectId);
    const codex = await detectCodex();
    const recentThread = selectPersistedProjectThread(project);
    if (!codex.installed && !recentThread) {
      return {
        opened: false,
        supported: false,
        capability: "codex-unavailable",
        message: "未检测到 Codex，且项目没有可恢复的持久对话；请启动 Codex 后重试。",
        error: "DESKTOP_NATIVE_UNAVAILABLE",
        snapshot: await buildSnapshot(),
      };
    }
    if (recentThread && isThreadActive(recentThread.id)) {
      return {
        opened: false,
        requestAccepted: false,
        verified: false,
        supported: true,
        capability: "active-thread-deferred",
        threadId: recentThread.id,
        message: "该项目最近对话正在由 Harness 执行；连接释放后才能安全打开 Codex Desktop 对话。",
        snapshot: await buildSnapshot(),
      };
    }
    const opened = await openDesktop("", project.path, {
      threadId: recentThread?.id,
      // A live Desktop 原生控制面 still owns the thread writer lock. Keep the safe
      // project entry in that case instead of sending Desktop to its lock
      // error screen.
      preferProjectPath: !recentThread || isThreadActive(recentThread.id),
      openExternal,
    });
    return {
      ...opened,
      supported: true,
      capability: opened.capability || "desktop-native-only-blocked",
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
