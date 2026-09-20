const fs = require("node:fs");
const path = require("node:path");
const machine = require("./state-machine.cjs");
const { readGitStatus } = require("./git.cjs");
const { launchHarnessTask, listRecentCodexCwds, listCodexProjects, openCodexDesktop } = require("./codex-adapter.cjs");
const { resolveProjectByName } = require("./project-discovery.cjs");
const { inspectProjectProfile } = require("./project-profile.cjs");

const ONBOARDING_PROGRESS = {
  detecting_codex: { progress: 10, label: "正在查找 Codex" },
  discovering_project: { progress: 28, label: "正在查找项目" },
  checking_git: { progress: 46, label: "正在检查 Git" },
  checking_skill: { progress: 60, label: "正在检查所需工具" },
  creating_thread: { progress: 78, label: "正在准备 Codex 对话" },
  saving_state: { progress: 92, label: "正在保存" },
  completed: { progress: 100, label: "准备好了" },
};
const CODEX_PROJECT_RESTART_WARNING = "连接已经完成。请彻底退出 Codex Desktop（确认 ChatGPT.exe 已关闭）后重新打开，再确认项目是否出现在侧栏。";

function createProjectOnboarding({
  store,
  getCodex,
  appServerCwd,
  skillPath,
  buildSnapshot,
  listRecentCwds = listRecentCodexCwds,
  listProjects,
  resolveProject = resolveProjectByName,
  resolveProjectOptions = {},
  readGit = readGitStatus,
  inspectProfile = inspectProjectProfile,
  launchTask = launchHarnessTask,
  openDesktop = openCodexDesktop,
  openExternal,
  fileExists = fs.existsSync,
  ensureProjectFolder = async () => undefined,
  assignThreadToProjectFolder = async () => undefined,
  ensureControlSessions = async () => undefined,
  onLaunched = () => {},
}) {
  return async function onboardProjectByName(rawName, { onProgress = () => {} } = {}) {
    const emitProgress = (stage, detail) => onProgress({ stage, ...ONBOARDING_PROGRESS[stage], ...(detail ? { detail } : {}) });

    emitProgress("detecting_codex");
    const codex = await getCodex();
    if (!codex.installed) throw new Error("未检测到 Codex，无法建立默认连接");

    emitProgress("discovering_project");
    let resolved;
    let officialProjects = [];
    try {
      officialProjects = typeof listProjects === "function" ? await listProjects({ executable: codex.path, cwd: appServerCwd }) : [];
    } catch {
      // Official project listing is an index enhancement; thread/candidate
      // discovery remains usable when app-server temporarily lacks it.
    }
    const indexedProjects = (Array.isArray(officialProjects) ? officialProjects : []).flatMap((item) => (item?.roots || []).map((root) => ({ path: root.path, name: item.name || path.basename(root.path || "") })));
    try {
      resolved = resolveProject({ name: rawName, projects: [...store.state.projects, ...indexedProjects], ...resolveProjectOptions });
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "PROJECT_NOT_FOUND") throw error;
      const recentCwds = await listRecentCwds({ executable: codex.path, cwd: appServerCwd });
      resolved = resolveProject({ name: rawName, projects: [...store.state.projects, ...indexedProjects], recentCwds, ...resolveProjectOptions });
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
      onboarding = machine.createAndDispatchOnboarding(state, project.id);
    });
    let folder;
    try {
      folder = await ensureProjectFolder({
        projectPath: project.path,
        projectName: project.name,
        executable: codex.path,
        cwd: project.path,
      });
      if (folder?.projectId) store.update((state) => {
        const target = machine.getProject(state, project.id);
        target.codexProjectId = folder.projectId;
        machine.setCodexProjectSync(state, project.id, {
          officialProjectId: folder.projectId,
          legacyProjectId: folder.legacyProjectId,
        });
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
    try {
      await ensureControlSessions({ project, codex, folder });
    } catch {
      // Control sessions are additive; the onboarding task remains recoverable.
    }

    emitProgress("creating_thread", resolved.name);
    if (onboarding.reused && onboarding.task.run?.externalThreadId) {
      const desktop = await openDesktop(codex.path, project.path, {
        threadId: onboarding.task.run.externalThreadId,
        // The thread id is the only precise conversation target. Prefer the
        // registered Codex deep link in production; project-path fallback is
        // reserved for isolated smoke runs or an explicit compatibility flag.
        preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1",
        openExternal,
      });
      emitProgress("saving_state");
      store.update((state) => machine.setExternalDesktopOpened(
        state,
        project.id,
        onboarding.task.id,
        desktop.opened,
      ));
      if (folder?.projectId) await assignThreadToProjectFolder({ threadId: onboarding.task.run.externalThreadId, projectId: folder.projectId });
      const snapshot = await buildSnapshot();
      emitProgress("completed", resolved.name);
      return {
        snapshot,
        projectId: project.id,
        taskId: onboarding.task.id,
        threadId: onboarding.task.run.externalThreadId,
        desktopOpened: desktop.opened,
        desktopError: desktop.opened ? undefined : desktop.error || "Codex Desktop 未能自动打开",
        desktopProjectRestartRequired: Boolean(folder?.projectId),
        ...(folder?.projectId ? { desktopProjectWarning: CODEX_PROJECT_RESTART_WARNING } : {}),
        reused: true,
        matchedProjectName: resolved.name,
        match: resolved.match,
      };
    }

    try {
      const launched = await launchTask({
        executable: codex.path,
        project,
        task: onboarding.task,
        missionPacket: onboarding.missionPacket,
        skillPath,
        projectId: folder?.projectId,
        openExternal,
        // Do not silently open a new project-root chat when we already have a
        // persistent task thread. The exact deep link must be attempted first.
        preferProjectPath: process.env.APH_DISABLE_DESKTOP_DEEPLINK === "1",
      });
      emitProgress("saving_state");
      store.update((state) => machine.attachExternalThread(state, project.id, onboarding.task.id, {
        threadId: launched.threadId,
        turnId: launched.turnId,
        processId: launched.processId,
        projectId: launched.projectId || folder?.projectId,
        desktopOpened: launched.desktop.opened,
      }));
      if (folder?.projectId) await assignThreadToProjectFolder({ threadId: launched.threadId, projectId: folder.projectId });
      onLaunched(launched, { projectId: project.id, taskId: onboarding.task.id });
      const snapshot = await buildSnapshot();
      emitProgress("completed", resolved.name);
      return {
        snapshot,
        projectId: project.id,
        taskId: onboarding.task.id,
        threadId: launched.threadId,
        desktopOpened: launched.desktop.opened,
        desktopError: launched.desktop.opened ? undefined : launched.desktop.error || "Codex Desktop 未能自动打开",
        desktopProjectRestartRequired: Boolean(folder?.projectId),
        ...(folder?.projectId ? { desktopProjectWarning: CODEX_PROJECT_RESTART_WARNING } : {}),
        reused: false,
        matchedProjectName: resolved.name,
        match: resolved.match,
      };
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
