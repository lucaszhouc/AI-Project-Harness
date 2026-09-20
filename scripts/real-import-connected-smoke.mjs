#!/usr/bin/env node
/**
 * Opt-in real import smoke. It keeps the Harness window alive until the
 * import candidate reaches review (or the bounded 8 minute deadline).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.env.APH_REAL_IMPORT_SMOKE !== "1") throw new Error("真实 import smoke 需要 APH_REAL_IMPORT_SMOKE=1");
const require = createRequire(import.meta.url);
const { listCodexProjects, listAllCodexThreads, inspectCodexThread } = require("../electron/codex-adapter.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.resolve(process.env.APH_REAL_IMPORT_EVIDENCE || path.join(os.tmpdir(), `aph-real-import-connected-${Date.now()}`));
const userData = path.join(evidence, "electron-user-data");
const dataRoot = path.join(evidence, "harness-data");
const workspace = process.env.APH_IMPORT_WORKSPACE;
const sourceProjectId = process.env.APH_IMPORT_CODEX_PROJECT_ID;
if (!workspace || !sourceProjectId) throw new Error("Set APH_IMPORT_WORKSPACE and APH_IMPORT_CODEX_PROJECT_ID for the explicit real-import fixture");
const executable = process.env.APH_REAL_IMPORT_HARNESS_EXECUTABLE || path.join(root, "release", "win-unpacked", "AI Project Harness.exe");
const codexExecutable = process.env.CODEX_EXECUTABLE || "codex";
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });
const report = { evidence, workspace, sourceProjectId, startedAt: new Date().toISOString(), pass: false, consoleErrors: [] };
const app = await electron.launch({ executablePath: executable, args: [], env: { ...process.env, APH_USER_DATA: userData, APH_DATA_ROOT: dataRoot, APH_TEST_WINDOW_HIDDEN: "1", APH_DISABLE_DESKTOP_DEEPLINK: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" } });
try {
  const page = await app.firstWindow();
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => report.consoleErrors.push(error.message));
  await page.locator(".app-shell").waitFor({ timeout: 20_000 });
  const result = await page.evaluate(({ sourceProjectId, workspace }) => window.harness.importCodexProject({ codexProjectId: sourceProjectId, name: "workspace", path: workspace }), { sourceProjectId, workspace });
  report.request = { projectId: result.projectId, taskId: result.taskId, threadId: result.threadId, status: result.status };
  const statePath = path.join(dataRoot, "harness-state.json");
  const deadline = Date.now() + 25 * 60 * 1000;
  let last;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (!fs.existsSync(statePath)) continue;
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const project = state.projects.find((item) => item.id === result.projectId);
    const task = project?.tasks.find((item) => item.id === result.taskId);
    last = { projectStatus: project?.codexImport?.status, taskStatus: task?.status, runStatus: task?.run?.status, phase: task?.run?.phase, candidate: Boolean(task?.importCandidate), error: task?.run?.error || project?.codexImport?.error, eventCount: task?.run?.eventCount || 0 };
    if (last.candidate || last.taskStatus === "review") { report.pass = true; report.final = last; break; }
    if (["failed", "rejected"].includes(last.taskStatus) && !task?.run?.externalThreadId) break;
  }
  report.final ||= last;
  report.statePath = statePath;
  report.official = await listCodexProjects({ executable: codexExecutable, cwd: workspace });
  report.threads = (await listAllCodexThreads({ executable: codexExecutable, cwd: workspace, maxThreads: 5000 })).filter((thread) => String(thread.projectId || "") === sourceProjectId).slice(0, 20).map((thread) => ({ id: thread.id, name: thread.name, projectId: thread.projectId, updatedAt: thread.updatedAt }));
  if (report.request.threadId) report.threadHealth = await inspectCodexThread({ executable: codexExecutable, cwd: workspace, threadId: report.request.threadId });
} catch (error) {
  report.error = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await app.close();
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
