const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harness", {
  snapshot: () => ipcRenderer.invoke("harness:snapshot"),
  addProjectByName: (name) => ipcRenderer.invoke("project:add-by-name", name),
  createBlankProject: (input) => ipcRenderer.invoke("project:create-blank", input),
  createConnectedProject: (input) => ipcRenderer.invoke("project:create-connected", input),
  connectCodexProject: (projectId, input) => ipcRenderer.invoke("project:connect-codex", projectId, input),
  importCodexProject: (input) => ipcRenderer.invoke("project:import-codex", input),
  guideProbe: (subject) => ipcRenderer.invoke("guide:probe", subject),
  guideCancelProbe: (subject) => ipcRenderer.invoke("guide:cancel-probe", subject),
  guideUpdate: (input) => ipcRenderer.invoke("guide:update", input),
  guideOperation: (operationId) => ipcRenderer.invoke("guide:operation", operationId),
  onProjectOnboardingProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("project:onboarding-progress", handler);
    return () => ipcRenderer.removeListener("project:onboarding-progress", handler);
  },
  onAgentRuntimeUpdate: (listener) => {
    const handler = (_event, update) => listener(update);
    ipcRenderer.on("agent:runtime-update", handler);
    return () => ipcRenderer.removeListener("agent:runtime-update", handler);
  },
  onArchiveProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("archive:progress", handler);
    return () => ipcRenderer.removeListener("archive:progress", handler);
  },
  showErrorLog: () => ipcRenderer.invoke("diagnostics:show-error-log"),
  reportRendererError: (details) => ipcRenderer.invoke("diagnostics:report-renderer-error", details),
  selectProject: (projectId) => ipcRenderer.invoke("project:select", projectId),
  createTask: (projectId, input) => ipcRenderer.invoke("task:create", projectId, input),
  dispatchTask: (projectId, taskId) => ipcRenderer.invoke("task:dispatch", projectId, taskId),
  stopTask: (projectId, taskId) => ipcRenderer.invoke("task:stop", projectId, taskId),
  submitTaskResult: (projectId, taskId, result) => ipcRenderer.invoke("task:submit-result", projectId, taskId, result),
  acceptTaskResult: (projectId, taskId) => ipcRenderer.invoke("task:accept", projectId, taskId),
  requestChanges: (projectId, taskId) => ipcRenderer.invoke("task:request-changes", projectId, taskId),
  rejectTask: (projectId, taskId, reason) => ipcRenderer.invoke("task:reject", projectId, taskId, reason),
  copyMissionPacket: (projectId, taskId) => ipcRenderer.invoke("mission:copy", projectId, taskId),
  refreshGit: (projectId) => ipcRenderer.invoke("git:refresh", projectId),
  refreshGitHub: (projectId) => ipcRenderer.invoke("github:refresh", projectId),
  setGitRemote: (projectId, remoteUrl, name) => ipcRenderer.invoke("github:set-remote", projectId, remoteUrl, name),
  setProjectStatus: (projectId, status) => ipcRenderer.invoke("project:set-status", projectId, status),
  archiveProject: (projectId, reason) => ipcRenderer.invoke("project:archive", projectId, reason),
  restoreProject: (projectId) => ipcRenderer.invoke("project:restore", projectId),
  updateProjectContract: (projectId, input) => ipcRenderer.invoke("project:update-contract", projectId, input),
  listTemplates: () => ipcRenderer.invoke("project:list-templates"),
  applyTemplate: (projectId, templateId) => ipcRenderer.invoke("project:apply-template", projectId, templateId),
  refreshProjectProfile: (projectId) => ipcRenderer.invoke("project:refresh-profile", projectId),
  createObjective: (projectId, input) => ipcRenderer.invoke("objective:create", projectId, input),
  setObjectiveStatus: (projectId, status) => ipcRenderer.invoke("objective:set-status", projectId, status),
  projectActivity: (projectId, limit) => ipcRenderer.invoke("project:activity", projectId, limit),
  addDecision: (projectId, input) => ipcRenderer.invoke("project:add-decision", projectId, input),
  createSection: (projectId, input) => ipcRenderer.invoke("section:create", projectId, input),
  assignTaskToSection: (projectId, taskId, sectionId) => ipcRenderer.invoke("section:assign-task", projectId, taskId, sectionId),
  closeSection: (projectId, sectionId, reason) => ipcRenderer.invoke("section:close", projectId, sectionId, reason),
  archiveSection: (projectId, sectionId, reason) => ipcRenderer.invoke("section:archive", projectId, sectionId, reason),
  importArchive: (projectId, filePath) => ipcRenderer.invoke("archive:import", projectId, filePath),
  listArchives: (projectId) => ipcRenderer.invoke("archive:list", projectId),
  verifyArchive: (projectId, hash) => ipcRenderer.invoke("archive:verify", projectId, hash),
  openArchive: (projectId) => ipcRenderer.invoke("archive:open", projectId),
  openRunArchive: (projectId, taskId) => ipcRenderer.invoke("archive:open-run", projectId, taskId),
  openLedger: (projectId) => ipcRenderer.invoke("project:open-ledger", projectId),
  openProjectPath: (projectId) => ipcRenderer.invoke("project:open-path", projectId),
  toggleWindowPin: () => ipcRenderer.invoke("window:toggle-pin"),
  exportProject: (projectId, filePath) => ipcRenderer.invoke("project:export", projectId, filePath),
  importProject: (filePath) => ipcRenderer.invoke("project:import", filePath),
  openAgentTask: (projectId, taskId) => ipcRenderer.invoke("task:open-agent", projectId, taskId),
  openTaskWorkspace: (projectId, taskId) => ipcRenderer.invoke("task:open-workspace", projectId, taskId),
  openCodexProject: (projectId) => ipcRenderer.invoke("project:open-codex", projectId),
  syncCodexProject: (projectId) => ipcRenderer.invoke("project:sync-codex", projectId),
  openCto: (projectId) => ipcRenderer.invoke("project:open-cto", projectId),
  newProjectConversation: (projectId, input) => ipcRenderer.invoke("project:new-conversation", projectId, input),
  openProjectSession: (projectId, sessionId) => ipcRenderer.invoke("project:open-session", projectId, sessionId),
});
