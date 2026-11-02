const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Windows Git checkouts may use CRLF; source-boundary checks use LF consistently.
const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8").replace(/\r\n/g, "\n");

test("main process keeps a guarded Desktop refresh heartbeat", () => {
  assert.match(source, /runtimeRefreshTimer/);
  assert.match(source, /RUNTIME_REFRESH_INTERVAL_MS/);
  assert.match(source, /runtimeRefreshInFlight/);
  assert.match(source, /setInterval\(/);
  assert.match(source, /reconcileCodexProjectFolders/);
  assert.doesNotMatch(source, /launchHarnessTask|launchHarnessImport|createCodexThread|createCodexControlThread/);
});

test("automated Electron smoke can keep the native window hidden and never pinned", () => {
  assert.match(source, /APH_TEST_WINDOW_HIDDEN/);
  assert.match(source, /show:\s*!hideAutomatedTestWindow/);
  assert.match(source, /setAlwaysOnTop\(hideAutomatedTestWindow \? false : windowPinned/);
});

test("project registration is Desktop deep-link only", () => {
  const registration = source.match(/async function ensureDesktopProjectRegistration[\s\S]*?\n}\n\nfunction markCodexDesktopRegistered/)?.[0] || "";
  assert.match(registration, /registerCodexDesktopProject\(\{/);
  assert.match(registration, /desktop-native-project-deep-link/);
  assert.doesNotMatch(registration, /CLI|app-server|global-state|createCodex/);
});

test("task and CTO entry points hand off through the native protocol", () => {
  assert.match(source, /machine\.prepareUserAgentTask/);
  assert.match(source, /taskPrompt\(/);
  assert.match(source, /openCodexDesktop\("",/);
  assert.match(source, /clipboard\.writeText/);
  assert.doesNotMatch(source, /APH_DISABLE_DESKTOP_OPEN|APH_DISABLE_AGENT_LAUNCH|APH_DISABLE_DESKTOP_DEEPLINK/);
});

test("accepted onboarding opens Review and CTO through idempotent Desktop deep links", () => {
  assert.match(source, /async function openStandardControlConversations\(projectId/);
  assert.match(source, /createStandardControlOpener/);
  assert.match(source, /openStandardControlConversations\(projectId\)/);
  assert.match(source, /task\?\.workstream === "project-onboarding"/);
  assert.doesNotMatch(source, /createCodexControlThread|launchHarnessTask|app-server/);
});

test("standard control deep-link requests are not reported as verified threads", () => {
  assert.match(source, /markControlSessionRequested/);
  assert.match(source, /project:attach-control-thread/);
  assert.match(source, /createStandardControlOpener/);
  assert.match(source, /attached: true, verified: false/);
  assert.doesNotMatch(source.match(/registerIpcHandle\("project:open-cto"[\s\S]*?\n  \}\);/)?.[0] || "", /markControlSessionOpened/);
});

test("unsupported Desktop reads are explicit blocks instead of fallbacks", () => {
  assert.match(source, /desktopNativeBlocked\("导入既有 Codex Project/);
  assert.match(source, /desktopNativeBlocked\("读取 Codex 对话索引/);
  assert.match(source, /desktopNativeBlocked\("导入已选 Codex 对话/);
  assert.doesNotMatch(source, /resolveAppServerCwd|listCodexProjects|listAllCodexThreads|searchCodexThreads/);
});
