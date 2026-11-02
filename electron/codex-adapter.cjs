const { harnessProtocolReference } = require("./handoff-protocol.cjs");

const DESKTOP_NATIVE_BLOCKED = "DESKTOP_NATIVE_BLOCKED";
const DESKTOP_NATIVE_UNAVAILABLE = "DESKTOP_NATIVE_UNAVAILABLE";

function desktopNativeBlocked(operation, detail = "当前操作没有公开的 Codex Desktop 原生控制接口") {
  const error = new Error(`${operation}: ${detail}`);
  error.code = DESKTOP_NATIVE_BLOCKED;
  error.capability = "desktop-native-only";
  return error;
}

function requireOpener(openExternal, operation) {
  if (typeof openExternal === "function") return openExternal;
  throw desktopNativeBlocked(operation, "缺少 Desktop 深链 opener");
}

function normalizeProjectPath(value) {
  const projectPath = String(value || "").trim();
  if (!projectPath) throw new Error("Project path is required");
  return projectPath;
}

/** Open a user-owned Codex Desktop surface. This is the only supported
 * integration boundary: no executable path, process, backend request or
 * compatibility cache is consulted. */
async function openCodexDesktop(_ignoredPath, projectPath, options = {}) {
  const openExternal = requireOpener(options.openExternal, "打开 Codex Desktop");
  const threadId = String(options.threadId || "").trim();
  const promptQuery = options.prompt ? `&prompt=${encodeURIComponent(String(options.prompt))}` : "";
  const uri = threadId
    ? `codex://threads/${encodeURIComponent(threadId)}`
    : `codex://threads/new?path=${encodeURIComponent(normalizeProjectPath(projectPath))}${promptQuery}`;
  try {
    await openExternal(uri);
    return { opened: true, requestAccepted: true, verified: false, capability: threadId ? "thread-deep-link" : "desktop-native-new-thread-deep-link", uri };
  } catch (error) {
    return { opened: false, requestAccepted: false, verified: false, capability: "desktop-native-only-blocked", uri, error: error instanceof Error ? error.message : String(error) };
  }
}

async function registerCodexDesktopProject({ projectPath, openExternal, route = "legacy" } = {}) {
  const opener = requireOpener(openExternal, "注册 Codex Desktop Project");
  const params = new URLSearchParams({ path: normalizeProjectPath(projectPath) });
  const normalizedRoute = String(route || "legacy").trim().toLowerCase();
  const uri = normalizedRoute === "threads" ? `codex://threads/new?${params}` : `codex://new?${params}`;
  try {
    await opener(uri);
    return { opened: true, requestAccepted: true, verified: false, capability: "desktop-native-project-deep-link", route: normalizedRoute === "threads" ? "threads" : "legacy", uri };
  } catch (error) {
    return { opened: false, requestAccepted: false, verified: false, capability: "desktop-native-only-blocked", route: normalizedRoute === "threads" ? "threads" : "legacy", uri, error: error instanceof Error ? error.message : String(error) };
  }
}

function codexProjectDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "APH/项目";
  if (/^APH\//i.test(raw)) return raw;
  return /project\s*-?\s*harness/i.test(raw) ? `APH/${raw.replace(/^project\s*-?\s*harness\s*[:：·/\\-]*/i, "").trim() || "项目"}` : raw;
}

function onboardingPrompt(project, task, missionPacket, protocolPaths = {}) {
  return [missionPacket, "MODE: ONBOARDING", `PROJECT_PATH: ${project.path}`, `HARNESS_PROJECT_ID: ${project.id}`, `HARNESS_TASK_ID: ${task.id}`, project.ledger?.path ? `PROJECT_LEDGER: ${project.ledger.path}` : undefined, harnessProtocolReference(protocolPaths), "请在当前 Codex Desktop 原生对话中继续；Harness 不启动后台执行器。"].filter(Boolean).join("\n");
}

function taskPrompt(project, task, missionPacket, protocolPaths = {}) {
  return [missionPacket, "MODE: TASK", `PROJECT_PATH: ${project.path}`, `HARNESS_PROJECT_ID: ${project.id}`, `HARNESS_TASK_ID: ${task.id}`, project.ledger?.path ? `PROJECT_LEDGER: ${project.ledger.path}` : undefined, harnessProtocolReference(protocolPaths), "请在当前 Codex Desktop 原生对话中继续；Harness 不启动后台执行器。"].filter(Boolean).join("\n");
}

/** Desktop deep links do not expose a thread id or turn state to Harness.
 * Unsupported reads stay explicit in the IPC handlers and never fall back to
 * a process, backend request or compatibility cache. */
module.exports = {
  DESKTOP_NATIVE_BLOCKED,
  DESKTOP_NATIVE_UNAVAILABLE,
  desktopNativeBlocked,
  openCodexDesktop,
  registerCodexDesktopProject,
  codexProjectDisplayName,
  onboardingPrompt,
  taskPrompt,
  harnessProtocolReference,
  terminateCodexProcessTree: async () => ({ terminated: false, capability: "desktop-native-only" }),
};
