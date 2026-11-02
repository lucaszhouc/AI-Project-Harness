const fs = require("node:fs");
const machine = require("./state-machine.cjs");
const { readGitStatus } = require("./git.cjs");
const { openCodexDesktop, onboardingPrompt } = require("./codex-adapter.cjs");
const { resolveProjectByName } = require("./project-discovery.cjs");
const { inspectProjectProfile } = require("./project-profile.cjs");

const ONBOARDING_PROGRESS = {
  detecting_codex: { label: "正在查找 Codex" },
  discovering_project: { label: "正在查找项目" },
  checking_git: { label: "正在检查 Git" },
  checking_skill: { label: "正在检查所需工具" },
  creating_thread: { label: "正在准备 Codex 对话" },
  saving_state: { label: "正在保存" },
  completed: { label: "准备好了" },
};
const CODEX_PROJECT_RESTART_WARNING = "连接已经完成。当前窗口未提供实时侧栏核对结果，请在现有 Codex Desktop 窗口刷新或手动核对。";

function createProjectOnboarding({
  store,
  getCodex,
  skillPath,
  protocolPaths = {},
  buildSnapshot,
  resolveProject = resolveProjectByName,
  resolveProjectOptions = {},
  readGit = readGitStatus,
  inspectProfile = inspectProjectProfile,
  openDesktop = openCodexDesktop,
  openExternal,
  copyPrompt = () => {},
  fileExists = fs.existsSync,
  ensureProjectFolder = async () => undefined,
}) {
  return async function onboardProjectByName(rawName, { onProgress = () => {}, projectId } = {}) {
    const emitProgress = (stage, detail) => onProgress({ stage, ...ONBOARDING_PROGRESS[stage], ...(detail ? { detail } : {}) });

    emitProgress("detecting_codex");
    const codex = await getCodex();
    if (!codex.installed) throw new Error("未检测到 Codex，无法建立默认连接");
    const desktopNative = codex.native === true;
    if (!desktopNative) throw new Error("必须使用 Codex Desktop 原生交接");

    emitProgress("discovering_project");
    let resolved;
    const indexedProjects = [];
    try {
      resolved = projectId ? machine.getProject(store.state, projectId)
        : resolveProject({ name: rawName, projects: [...store.state.projects, ...indexedProjects], ...resolveProjectOptions });
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "PROJECT_NOT_FOUND") throw error;
      throw new Error(`未找到项目“${rawName}”；请先在 Harness 中绑定本地目录。`);
    }

    emitProgress("checking_git", resolved.name);
    const git = await readGit(resolved.path);
    // A project can be a deployed/static workspace without a .git directory.
    // Keep the project discoverable and persist its unavailable Git evidence;
    // only a missing path is a hard onboarding failure.
    if (!git.available && !fs.existsSync(resolved.path)) throw new Error(`已找到“${resolved.name}”，但项目路径已不存在`);
    const profile = inspectProfile(resolved.path);
    emitProgress("checking_skill");
    if (!fileExists(skillPath)) throw new Error("Harness 内置 Codex Skill 缺失");

    let project;
    let onboarding;
    store.update((state) => {
      project = machine.addProject(state, resolved.path);
      const target = machine.getProject(state, project.id);
      target.profile = profile;
      if (!target.techStack?.length && profile.stack?.length) target.techStack = profile.stack.slice(0, 20);
      target.gitSnapshot = git;
      onboarding = machine.createAndDispatchOnboarding(state, project.id, { userInvoked: true });
    });
    if (onboarding.task.status === "review") {
      return { snapshot: await buildSnapshot(), projectId: project.id, taskId: onboarding.task.id, reused: true, awaitingReview: true };
    }
    try {
      await ensureProjectFolder({
        projectPath: project.path,
        projectName: project.name,
        cwd: project.path,
      });
    } catch (error) {
      // A real Codex Project is now part of the onboarding contract. Do not
      // leave a dispatched task running without the Project that owns its
      // 2+N conversations; make the task retryable and surface the cause.
      store.update((state) => machine.markExternalLaunchFailed(
        state,
        project.id,
        onboarding.task.id,
        `Codex Project 创建失败：${error instanceof Error ? error.message : String(error)}`,
      ));
      throw error;
    }
    emitProgress("creating_thread", resolved.name);
    if (onboarding.reused && onboarding.task.run?.externalThreadId) {
      const desktop = await openDesktop("", project.path, {
        threadId: onboarding.task.run.externalThreadId,
        openExternal,
      });
      emitProgress("saving_state");
      store.update((state) => machine.setExternalDesktopOpened(
        state,
        project.id,
        onboarding.task.id,
        desktop.opened,
      ));
      const snapshot = await buildSnapshot();
      emitProgress("completed", resolved.name);
      return {
        snapshot,
        projectId: project.id,
        taskId: onboarding.task.id,
        threadId: onboarding.task.run.externalThreadId,
        desktopOpened: desktop.opened,
        desktopError: desktop.opened ? undefined : desktop.error || "Codex Desktop 未能自动打开",
        desktopProjectRestartRequired: true,
        desktopProjectWarning: CODEX_PROJECT_RESTART_WARNING,
        reused: true,
        matchedProjectName: resolved.name,
        match: resolved.match,
      };
    }

    try {
      if (desktopNative) {
        const prompt = onboardingPrompt(project, onboarding.task, onboarding.missionPacket, protocolPaths);
        store.update((state) => {
          machine.getProject(state, project.id).tasks.find(task => task.id === onboarding.task.id).run.userPrompt = prompt;
        });
        copyPrompt(prompt);
        const desktop = await openDesktop("", project.path, { openExternal, prompt });
        if (!desktop.opened) throw new Error(desktop.error || "Desktop 初始化入口未能打开");
        emitProgress("saving_state");
        const snapshot = await buildSnapshot();
        emitProgress("completed", resolved.name);
        return {
          snapshot,
          projectId: project.id,
          taskId: onboarding.task.id,
          threadId: undefined,
          desktopOpened: desktop.opened,
          desktopError: desktop.opened ? undefined : desktop.error || "Codex Desktop 未能自动打开",
          desktopProjectRestartRequired: true,
          desktopProjectWarning: "已通过 Desktop 原生深链打开新对话；任务包已复制，请在 Desktop 中发送。",
          reused: false,
          matchedProjectName: resolved.name,
          match: resolved.match,
          missionPacket: prompt,
          userActionRequired: true,
          executionOwner: "codex-desktop",
        };
      }
    } catch (error) {
      store.update((state) => machine.markExternalLaunchFailed(
        state,
        project.id,
        onboarding.task.id,
        error instanceof Error ? error.message : String(error),
      ));
      throw error;
    }
  };
}

module.exports = { ONBOARDING_PROGRESS, CODEX_PROJECT_RESTART_WARNING, createProjectOnboarding };
