#!/usr/bin/env node
/**
 * Opt-in end-to-end smoke for the real local Codex Desktop connection.
 *
 * This intentionally creates one clearly-named temporary Project in the
 * user's real Codex Desktop, so it is never part of the ordinary release gate.
 * Run only with APH_REAL_CONNECTED_SMOKE=1. The evidence directory defaults
 * to the operating-system temporary directory and is not deleted.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.env.APH_REAL_CONNECTED_SMOKE !== "1") {
  throw new Error("真实 Codex 连接 smoke 是有副作用的；请显式设置 APH_REAL_CONNECTED_SMOKE=1");
}

const require = createRequire(import.meta.url);
const { listCodexProjects, listAllCodexThreads, inspectCodexThread } = require("../electron/codex-adapter.cjs");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const evidenceRoot = path.resolve(process.env.APH_REAL_CONNECTED_EVIDENCE || path.join(os.tmpdir(), `aph-real-connected-flow-${stamp}`));
const userData = path.join(evidenceRoot, "electron-user-data");
const dataRoot = path.join(evidenceRoot, "harness-data");
const workspace = path.join(evidenceRoot, "workspace");
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });

const packagedHarnessExecutable = process.env.APH_REAL_CONNECTED_HARNESS_EXECUTABLE
  ? path.resolve(process.env.APH_REAL_CONNECTED_HARNESS_EXECUTABLE)
  : undefined;
const electronExecutable = packagedHarnessExecutable || path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
if (!fs.existsSync(electronExecutable)) throw new Error(`Harness executable missing: ${electronExecutable}`);
const codexExecutable = process.env.CODEX_EXECUTABLE || "codex";
const projectName = `APH Real Connected ${stamp}`;
const app = await electron.launch({
  executablePath: electronExecutable,
  args: packagedHarnessExecutable ? [] : [projectRoot],
  env: {
    ...process.env,
    APH_USER_DATA: userData,
    APH_TEST_WINDOW_HIDDEN: "1",
    APH_DATA_ROOT: dataRoot,
    APH_DISABLE_AGENT_LAUNCH: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  },
});

const report = { evidenceRoot, projectName, workspace, consoleErrors: [] };
try {
  const page = await app.firstWindow();
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => report.consoleErrors.push(error.message));
  await page.locator(".app-shell").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  const dialog = page.locator("#project-dialog");
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  await dialog.getByRole("button", { name: "新建项目", exact: true }).first().click();
  await dialog.locator('input[name="blankName"]').fill(projectName);
  await dialog.locator('input[name="blankPath"]').fill(workspace);
  await dialog.locator('textarea[name="blankGoal"]').fill("验证真实 Codex Project 与 2+N 控制面对接");
  await dialog.locator('textarea[name="blankTechStack"]').fill("Electron\nCodex app-server");
  await dialog.locator('textarea[name="blankConstraints"]').fill("控制线程只执行一次低 effort 初始化 turn");
  await dialog.getByRole("button", { name: "新建项目", exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector("#project-dialog")?.hasAttribute("open"), null, { timeout: 120_000 });
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "连接 Codex", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[data-action="connect-codex"]'), null, { timeout: 120_000 });
  const statePath = path.join(dataRoot, "harness-state.json");
  if (!fs.existsSync(statePath)) throw new Error(`Harness state missing: ${statePath}`);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const project = state.projects.find((item) => item.name === projectName) || state.projects.find((item) => item.path === workspace);
  if (!project) throw new Error("新建项目未写入 Harness 状态");
  report.harness = {
    projectId: project.id,
    codexProjectId: project.codexProjectId,
    sync: project.codexProjectSync,
    source: project.source,
    sessions: (project.sessions || []).map((session) => ({ role: session.role, threadId: session.externalThreadId, projectId: session.externalProjectId })),
    statePath,
  };
  if (!project.codexProjectId || !project.codexProjectSync || !["desktop-registered", "app-server-confirmed"].includes(project.codexProjectSync.state)) {
    throw new Error(`Harness Project sync state is incomplete: ${JSON.stringify(report.harness.sync)}`);
  }
  const official = await listCodexProjects({ executable: codexExecutable, cwd: workspace });
  const officialProject = official.find((item) => String(item.id) === String(project.codexProjectId));
  if (!officialProject || !(officialProject.roots || []).some((root) => path.resolve(root.path) === path.resolve(workspace))) {
    throw new Error(`官方 Project/root 未找到: ${JSON.stringify({ id: project.codexProjectId, officialCount: official.length })}`);
  }
  report.officialProject = { id: officialProject.id, name: officialProject.name, roots: officialProject.roots };
  const threads = await listAllCodexThreads({ executable: codexExecutable, cwd: workspace, maxThreads: 5000 });
  const controlChecks = [];
  for (const session of project.sessions.filter((item) => ["cto", "review"].includes(item.role))) {
    if (!session.externalThreadId) throw new Error(`${session.role} thread id missing`);
    const thread = threads.find((item) => String(item.id) === String(session.externalThreadId));
    const health = await inspectCodexThread({ executable: codexExecutable, cwd: workspace, threadId: session.externalThreadId });
    controlChecks.push({ role: session.role, threadId: session.externalThreadId, projectId: thread?.projectId, readable: health.readable, turnCount: health.turns?.length || 0 });
    if (!thread || String(thread.projectId) !== String(project.codexProjectId) || !health.readable || (health.turns?.length || 0) < 1) {
      throw new Error(`控制 thread 验收失败: ${JSON.stringify(controlChecks.at(-1))}`);
    }
  }
  report.controlThreads = controlChecks;
  if (report.consoleErrors.length) throw new Error(`Renderer errors: ${report.consoleErrors.join(" | ")}`);
  report.pass = true;
  fs.writeFileSync(path.join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: real-connected-flow\n`);
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  fs.writeFileSync(path.join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
}
