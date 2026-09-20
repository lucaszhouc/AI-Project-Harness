const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("main process keeps one guarded background runtime refresh", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(source, /runtimeRefreshTimer/);
  assert.match(source, /RUNTIME_REFRESH_INTERVAL_MS/);
  assert.match(source, /runtimeRefreshInFlight/);
  assert.match(source, /folderReconcileInFlight/);
  assert.match(source, /reconcileCodexProjectFolders/);
  assert.match(source, /\}\)\(\)\s*\.catch\(/);
  assert.match(source, /if \(runtimeRefreshInFlight/);
  assert.match(source, /setInterval\(/);
  assert.doesNotMatch(source, /monitor\.refresh/);
  assert.match(source, /legacyStateSyncEnabled/);
  assert.match(source, /syncLegacy = false/);
  assert.match(source, /provisionMissingControlThreads[\s\S]*syncLegacy: false/);
  assert.match(source, /allowLegacyCodexStateSync/);
  assert.match(source, /if \(!machine\.shouldAutoProvisionCodexProject\(project\)\) continue/);
  assert.match(source, /function resumePendingCodexArchives/);
  assert.match(source, /void resumePendingCodexArchives\(\)/);
  assert.match(source, /project:create-connected/);
  assert.match(source, /registerCodexDesktopProject/);
  assert.match(source, /ensureProjectControlPlane/);
  assert.match(source, /APH_AUTO_PROVISION_CONTROLS/);
  assert.match(source, /preferProjectPath: false/);
  assert.match(source, /LAUNCH_RECONCILE_GRACE_MS/);
  assert.match(source, /run\.status === "starting" && !run\.externalThreadId && !run\.processId/);
});

test("automated Electron smoke can keep the native window hidden and never pinned", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(source, /APH_TEST_WINDOW_HIDDEN/);
  assert.match(source, /show:\s*!hideAutomatedTestWindow/);
  assert.match(source, /setAlwaysOnTop\(hideAutomatedTestWindow \? false : windowPinned/);
});

test("terminal run durability is not blocked by renderer snapshot projection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(source, /store\.write\(\);[\s\S]{0,300}void publishRuntimeSnapshot\(update\.event\)/);
  assert.match(source, /await finalizeRunArchive\(\);\s*launched\.client\.close\(\)/);
});

test("Codex Project import uses the dedicated read-only hydration runtime", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(source, /resolveCodexProjectByName/);
  assert.match(source, /listCodexProjects/);
  assert.match(source, /launchHarnessImport/);
  assert.match(source, /project:import-codex[\s\S]{0,180}importCodexProjectFromName/);
  assert.match(source, /workstream === "codex-project-import"[\s\S]{0,500}importCodexProjectFromName/);
  assert.match(source, /importMode: true/);
  assert.match(source, /recordCodexImportCandidate/);
  assert.match(source, /applyHarnessImport[\s\S]{0,300}acceptCodexImportCandidate/);
});
