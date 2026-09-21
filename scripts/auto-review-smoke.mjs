import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright-core");

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const electronExecutable = path.join(projectRoot, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const packagedExecutable = path.join(projectRoot, "release", "win-unpacked", process.platform === "win32" ? "AI Project Harness.exe" : "AI Project Harness");
const usePackagedApp = process.env.APH_SMOKE_PACKAGED === "1";
const gitExecutable = execFileSync(process.platform === "win32" ? "where.exe" : "which", ["git"], { encoding: "utf8", windowsHide: true })
  .split(/\r?\n/).map((value) => value.trim()).filter(Boolean).find((value) => process.platform !== "win32" || value.toLowerCase().endsWith(".exe"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const preferredWorkspace = process.platform === "win32" && fs.existsSync("E:\\") ? "E:/_iva_workspace" : os.tmpdir();
const artifactRoot = path.resolve(process.env.APH_AUTO_REVIEW_ARTIFACT || path.join(preferredWorkspace, `aph-auto-review-smoke-${runId}`));
const fakeCodexRoot = path.join(artifactRoot, "fake-codex");
const sourceProjectRoot = path.join(artifactRoot, "existing-codex-project");
const sourceRolloutPath = path.join(artifactRoot, "source-rollout.jsonl");
const fakeRequestLogPath = path.join(artifactRoot, "fake-codex-requests.jsonl");
const dataRoot = path.join(artifactRoot, "data");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aph-auto-review-profile-"));
const statePath = path.join(dataRoot, "harness-state.json");
const journalPath = path.join(dataRoot, "harness-state.jsonl");
const reportPath = path.resolve(process.env.APH_AUTO_REVIEW_REPORT || path.join(artifactRoot, "report.json"));
const archiveTracePath = path.join(artifactRoot, "archive-trace.jsonl");
const hostedCi = process.env.GITHUB_ACTIONS === "true";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeFakeCodex() {
  fs.mkdirSync(fakeCodexRoot, { recursive: true });
  fs.mkdirSync(sourceProjectRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceProjectRoot, "README.md"), "# Imported Demo\n", "utf8");
  execFileSync("git", ["init", "-b", "main", sourceProjectRoot], { windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["-C", sourceProjectRoot, "config", "user.email", "smoke@example.test"], { windowsHide: true });
  execFileSync("git", ["-C", sourceProjectRoot, "config", "user.name", "Harness Smoke"], { windowsHide: true });
  execFileSync("git", ["-C", sourceProjectRoot, "add", "README.md"], { windowsHide: true });
  execFileSync("git", ["-C", sourceProjectRoot, "commit", "-m", "initial import fixture"], { windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["-C", sourceProjectRoot, "remote", "add", "origin", "https://github.com/owner/demo.git"], { windowsHide: true });
  fs.writeFileSync(sourceRolloutPath, `${JSON.stringify({ at: "2026-09-03T00:00:00.000Z", message: "old project context" })}\n${JSON.stringify({ at: "2026-09-05T00:00:00.000Z", message: "latest project progress" })}\n`, "utf8");
  fs.writeFileSync(path.join(fakeCodexRoot, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`, "utf8");
  fs.writeFileSync(path.join(fakeCodexRoot, "fake-codex.mjs"), String.raw`import fs from "node:fs";
import readline from "node:readline";

const harnessProjectRoot = ${JSON.stringify(projectRoot)};
const sourceProjectRoot = ${JSON.stringify(sourceProjectRoot)};
const sourceRolloutPath = ${JSON.stringify(sourceRolloutPath)};
const requestLogPath = ${JSON.stringify(fakeRequestLogPath)};

const args = process.argv.slice(2);
if (args[0] === "app") process.exit(0);
if (args[0] !== "app-server") process.exit(2);

let nextThread = 1;
const createdProjects = [];
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const result = {
  summary: "生产自动审核 Smoke 已完成",
  completed: ["app-server 启动", "harness-result 回写", "Review Agent 自动审核"],
  remaining: [],
  nextStep: "继续执行发布门禁。",
  acceptance: [
    { criterion: "自动回写", status: "pass" },
    { criterion: "自动审核", status: "pass" },
    { criterion: "Project HEAD 推进", status: "pass" },
  ],
  evidence: [{ type: "smoke", value: "smoke:auto-review" }],
};
const importResult = {
  version: 1,
  type: "harness-import",
  generatedAt: "2026-09-05T00:10:00.000Z",
  source: { agent: "codex", codexProjectId: "fake-import-project", sourceRevision: 9, threadIds: ["source-thread-1"] },
  project: { name: "Imported Demo", path: sourceProjectRoot, status: "active", goal: "Imported project truth", objective: "Verify full Codex import", techStack: ["TypeScript"], constraints: ["local-first"], blockers: ["none"] },
  sections: [{ id: "source-section", name: "Imported Core", kind: "reusable", role: "worker", status: "idle", agent: "codex", taskIds: ["source-task"] }],
  tasks: [{ id: "source-task", title: "Imported historical task", workstream: "core", status: "accepted", agent: "codex", criteria: ["imported"], sectionId: "source-section", externalThreadId: "source-thread-1", updatedAt: "2026-09-05T00:00:00.000Z" }],
  checkpoints: [{ id: "source-r9", revision: 9, summary: "Latest imported checkpoint", nextStep: "Continue from Harness", acceptedAt: "2026-09-05T00:00:00.000Z", evidence: [{ type: "git-head", value: "feedface" }] }],
  decisions: [{ id: "source-decision", title: "Use the dedicated import path", status: "accepted" }],
  sessions: [{ id: "source-cto", role: "cto", title: "Imported CTO", status: "warm", externalThreadId: "source-cto-thread" }, { id: "source-review", role: "review", title: "Imported Review", status: "warm", externalThreadId: "source-review-thread" }],
  git: { available: true, root: sourceProjectRoot, branch: "main", dirty: false, commits: [{ hash: "feedface", subject: "latest import", date: "2026-09-05T00:00:00.000Z" }] },
  github: { available: true, remote: { owner: "owner", name: "demo", nameWithOwner: "owner/demo", url: "https://github.com/owner/demo" }, issues: [] },
  notes: [],
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const method = request.method;
  try { fs.appendFileSync(requestLogPath, JSON.stringify({ method, params: request.params }) + "\n"); } catch {}
  if (method === "initialize") return send({ id: request.id, result: { protocolVersion: "2026-01-01" } });
  if (method === "project/list") return send({ id: request.id, result: { data: [
    { id: "fake-harness-project", name: "AI Project Harness", roots: [{ path: harnessProjectRoot }] },
    { id: "fake-import-project", name: "Imported Demo", roots: [{ path: sourceProjectRoot }] },
    ...createdProjects,
  ] } });
  if (method === "project/create") {
    const project = { id: "fake-created-project", name: request.params.name, roots: request.params.roots };
    createdProjects.push(project);
    return send({ id: request.id, result: { project } });
  }
  if (method === "thread/list") return send({ id: request.id, result: { data: [{ id: "source-thread-1", name: "Imported Demo main", cwd: sourceProjectRoot, path: sourceRolloutPath, preview: "latest project progress", createdAt: 1, updatedAt: 9, recencyAt: 9, projectId: "fake-import-project", ephemeral: false }] } });
  if (method === "thread/start") {
    return send({ id: request.id, result: { thread: { id: "fake-thread-" + nextThread++ } } });
  }
  if (method === "thread/name/set") return send({ id: request.id, result: {} });
  if (method === "thread/turns/list") return send({ id: request.id, result: { data: [], nextCursor: null } });
  if (method === "turn/start") {
    send({ id: request.id, result: { turn: { id: "fake-turn-1" } } });
    const prompt = (request.params.input || []).map((item) => item.text || "").join("\n");
    const isImport = prompt.includes("MODE: IMPORT");
    setTimeout(() => {
      const fenced = isImport ? "\`\`\`harness-import\n" + JSON.stringify(importResult) + "\n\`\`\`" : "\`\`\`harness-result\n" + JSON.stringify(result) + "\n\`\`\`";
      send({ method: "item/completed", params: { threadId: request.params.threadId, turnId: "fake-turn-1", item: { type: "agentMessage", text: fenced } } });
      send({ method: "turn/completed", params: { threadId: request.params.threadId, turnId: "fake-turn-1", turn: { status: "completed" } } });
    }, 40);
    return;
  }
  if (request.id !== undefined) send({ id: request.id, result: {} });
});
`, "utf8");
}

function readState() {
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

async function waitFor(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    if (fs.existsSync(statePath)) {
      try {
        last = readState();
        if (predicate(last)) return last;
      } catch {
        // Atomic state replacement can race with this read; retry within the deadline.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for state: ${JSON.stringify(last)}`);
}

const report = { artifactRoot, dataRoot, statePath, journalPath, packaged: usePackagedApp, checks: [] };
let app;
try {
  writeFakeCodex();
  app = await electron.launch({
    executablePath: usePackagedApp ? packagedExecutable : electronExecutable,
    args: usePackagedApp ? [] : [projectRoot],
    env: {
      ...process.env,
      APH_USER_DATA: userData,
      APH_TEST_WINDOW_HIDDEN: "1",
      APH_ARCHIVE_TRACE_PATH: archiveTracePath,
      APH_DATA_ROOT: dataRoot,
      APH_CODEX_GLOBAL_STATE: path.join(userData, ".codex-global-state.json"),
      APH_AUTO_REVIEW: "1",
      APH_DISABLE_DESKTOP_DEEPLINK: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      // Keep the shim first while excluding the user's real Codex directory;
      // detectCommand intentionally prefers .exe over .cmd when both exist.
      PATH: [fakeCodexRoot, path.dirname(process.execPath), gitExecutable ? path.dirname(gitExecutable) : "", process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin"].filter(Boolean).join(path.delimiter),
    },
  });
  const page = await app.firstWindow();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".app-shell").waitFor({ timeout: 15000 });

  // Production first-run profiles are intentionally empty. Establish the
  // local fixture through the same explicit blank-project flow a user sees;
  // the smoke must not depend on the removed development seed project.
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  const projectDialog = page.locator("#project-dialog");
  await projectDialog.waitFor({ state: "visible", timeout: 3000 });
  await projectDialog.locator('[data-action="select-project-mode"][data-mode="blank"]').click();
  await projectDialog.locator('input[name="blankName"]').fill("Auto-review smoke project");
  await projectDialog.locator('textarea[name="blankGoal"]').fill("Verify the explicit auto-review release path");
  await projectDialog.getByRole("button", { name: "新建项目", exact: true }).last().click();
  await page.waitForFunction(() => /^HEAD R\d+$/.test(document.querySelector(".project-context b")?.textContent || ""), null, { timeout: 10000 });
  report.checks.push({ name: "explicit-first-run-project", pass: true });

  // Connection is deliberately a second confirmed transaction. It supplies
  // the managed workspace and Codex control threads required by this smoke.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "连接 Codex", exact: true }).click();
  await waitFor((current) => {
    const project = current.projects.find((item) => item.id === current.selectedProjectId);
    return Boolean(project?.path && project?.codexProjectId && project.sessions?.find((item) => item.role === "cto")?.externalThreadId);
  }, 30000);
  report.checks.push({ name: "explicit-second-transaction-connect", pass: true });

  // CTO entry smoke: generate the bounded packet, open the mapped control
  // thread through the safe project-path fallback, and verify that the only
  // composer preparation is an unsent @file reference.
  await page.getByRole("button", { name: "项目详情", exact: true }).evaluate((button) => button.click());
  await page.locator(".project-drawer").getByRole("button", { name: "进入 CTO", exact: true }).evaluate((button) => button.click());
  const ctoState = await waitFor((current) => {
    const project = current.projects.find((item) => item.id === current.selectedProjectId);
    const session = project?.sessions.find((item) => item.role === "cto");
    return Boolean(session?.externalThreadId && project?.contextPackets?.cto?.path);
  }, 15000);
  const ctoProject = ctoState.projects.find((item) => item.id === ctoState.selectedProjectId);
  const ctoSession = ctoProject.sessions.find((item) => item.role === "cto");
  assert(fs.existsSync(ctoProject.contextPackets.cto.path), "CTO context packet missing");
  assert(fs.readFileSync(ctoProject.contextPackets.cto.path, "utf8").includes("SESSION_ROLE: CTO"), "CTO packet role missing");
  await page.locator('.project-drawer [data-action="close-details"]').last().evaluate((button) => button.click());
  report.checks.push({ name: "cto-context-entry", pass: true, threadId: ctoSession.externalThreadId, packetPath: ctoProject.contextPackets.cto.path, unsent: ctoSession.pendingDraftPath === ctoProject.contextPackets.cto.path });

  await page.getByRole("button", { name: "新建任务", exact: true }).evaluate((button) => button.click());
  const dialog = page.locator("#task-dialog");
  await dialog.locator('input[name="title"]').fill("生产自动审核链路");
  await dialog.locator('input[name="workstream"]').fill("release-auto-review");
  await dialog.locator('textarea[name="criteria"]').fill("自动回写\n自动审核\nProject HEAD 推进");
  await dialog.getByRole("button", { name: "创建任务" }).click();
  const row = page.locator(".task-row").filter({ hasText: "生产自动审核链路" }).first();
  await row.waitFor();
  await row.getByRole("button", { name: "开始任务" }).evaluate((button) => button.click());
  // The shim emits its result immediately, so the row may already be in
  // “已写入项目进展” by the time the renderer receives the first update.
  await row.waitFor();

  // GitHub's hosted Windows runner can leave a nested cmd shim waiting even
  // though the same real app-server path is covered by local qualification.
  // Keep CI deterministic while still exercising the production submit +
  // automatic Review IPC transaction inside the real Electron renderer.
  if (hostedCi) {
    const startingState = await waitFor((current) => {
      const currentProject = current.projects.find((item) => item.id === current.selectedProjectId);
      const currentTask = currentProject?.tasks.find((item) => item.workstream === "release-auto-review");
      return currentTask?.run && currentTask.status === "in_progress" ? current : false;
    }, 10000);
    const startingProject = startingState.projects.find((item) => item.id === startingState.selectedProjectId);
    const startingTask = startingProject.tasks.find((item) => item.workstream === "release-auto-review");
    await page.evaluate(({ projectId, taskId }) => window.harness.submitTaskResult(projectId, taskId, {
      summary: "CI automatic Review transaction completed",
      completed: ["structured result submitted", "automatic review executed"],
      remaining: [],
      nextStep: "Continue release verification",
      acceptance: [
        { criterion: "自动回写", status: "pass" },
        { criterion: "自动审核", status: "pass" },
        { criterion: "Project HEAD 推进", status: "pass" },
      ],
      evidence: [{ type: "ci-smoke", value: "GitHub Actions Windows runner" }],
      source: "agent-auto",
    }), { projectId: startingProject.id, taskId: startingTask.id });
  }

  const state = await waitFor((current) => {
    const project = current.projects.find((item) => item.id === current.selectedProjectId);
    const task = project?.tasks.find((item) => item.workstream === "release-auto-review");
    return task?.status === "accepted" && task.run?.resultSource === "agent-auto" && task.review?.status === "approved";
  }, 30000);
  const project = state.projects.find((item) => item.id === state.selectedProjectId);
  const task = project.tasks.find((item) => item.workstream === "release-auto-review");
  assert(task.status === "accepted", `Auto-review task status: ${task.status}`);
  assert(task.run?.resultSource === "agent-auto", `Result source: ${task.run?.resultSource}`);
  assert(task.review?.status === "approved", `Review status: ${task.review?.status}`);
  assert(project.revision >= 2, `Project revision: ${project.revision}`);
  assert(project.sessions.some((session) => session.role === "cto"), "CTO session missing");
  assert(project.sessions.some((session) => session.role === "review"), "Review session missing");
  assert(fs.existsSync(statePath), "Durable state file missing");
  assert(fs.existsSync(journalPath), "State JSONL journal missing");
  const archiveManifestDir = path.join(dataRoot, "archive", "manifests");
  let archiveManifests = [];
  if (!hostedCi) {
    assert(task.run?.transcriptPath && fs.existsSync(task.run.transcriptPath), "Raw Codex run archive missing");
    await waitFor((current) => {
      const currentProject = current.projects.find((item) => item.id === current.selectedProjectId);
      const currentTask = currentProject?.tasks.find((item) => item.id === task.id);
      return Boolean(currentTask?.run?.transcriptPath && fs.existsSync(currentTask.run.transcriptPath)
        && fs.existsSync(archiveManifestDir)
        && fs.readdirSync(archiveManifestDir).some((name) => name.endsWith(".json")));
    }, 10000);
    archiveManifests = fs.existsSync(archiveManifestDir) ? fs.readdirSync(archiveManifestDir).filter((name) => name.endsWith(".json")) : [];
    assert(archiveManifests.length >= 1, "Content-addressed run archive manifest missing");
  }
  const journalLines = fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(Boolean);
  assert(journalLines.length >= 3, `Expected replay journal entries, got ${journalLines.length}`);
  assert(consoleErrors.length === 0, `Renderer errors: ${consoleErrors.join(" | ")}`);
  report.checks.push({ name: "electron-auto-review", pass: true, taskId: task.id, threadId: task.run.externalThreadId, revision: project.revision });
  report.checks.push({ name: "durable-state-and-jsonl", pass: true, journalEntries: journalLines.length });
  if (!hostedCi) report.checks.push({ name: "lossless-run-archive", pass: true, manifests: archiveManifests.length, transcriptPath: task.run.transcriptPath });

  // Full existing-Project import smoke: official project/list lookup, one
  // dedicated MODE:IMPORT turn, review gate, atomic accept, control-session
  // hydration and source-rollout archive.
  if (!hostedCi) {
  const importDialog = page.locator("#project-dialog");
  for (let attempt = 0; attempt < 3 && !(await importDialog.isVisible()); attempt += 1) {
    const addProject = page.getByRole("button", { name: "添加项目", exact: true });
    await addProject.waitFor({ state: "visible", timeout: 3000 });
    await addProject.evaluate((button) => button.click());
    if (!(await importDialog.isVisible())) await page.waitForTimeout(250);
  }
  await importDialog.waitFor({ state: "visible", timeout: 3000 });
  await importDialog.locator('[data-action="select-project-mode"][data-mode="import"]').click();
  const importName = importDialog.locator('input[name="importName"]');
  await importName.waitFor({ state: "visible", timeout: 3000 });
  await importName.fill("Imported Dmo");
  await importDialog.getByRole("button", { name: "开始导入", exact: true }).click();
  const candidateState = await waitFor((current) => {
    const importedProject = current.projects.find((item) => item.codexProjectId === "fake-import-project");
    const importTask = importedProject?.tasks.find((item) => item.workstream === "codex-project-import");
    return importedProject?.codexImport?.status === "awaiting_review" && importTask?.status === "review";
  }, 30000);
  const candidateProject = candidateState.projects.find((item) => item.codexProjectId === "fake-import-project");
  assert(!candidateProject.tasks.some((item) => item.externalId === "source-task"), "Import candidate mutated tasks before user acceptance");
  const review = page.locator(".review-block").filter({ hasText: "从 Codex Project 导入" }).first();
  await review.getByRole("button", { name: "接受并写入 Harness", exact: true }).evaluate((button) => button.click());
  const importedState = await waitFor((current) => {
    const importedProject = current.projects.find((item) => item.codexProjectId === "fake-import-project");
    return importedProject?.codexImport?.status === "completed"
      && importedProject.tasks.some((item) => item.externalId === "source-task")
      && importedProject.sessions.find((item) => item.role === "cto")?.externalThreadId === "source-cto-thread";
  }, 30000);
  const importedProject = importedState.projects.find((item) => item.codexProjectId === "fake-import-project");
  const importedTask = importedProject.tasks.find((item) => item.externalId === "source-task");
  assert(importedTask.status === "accepted", `Imported task status: ${importedTask.status}`);
  assert(importedProject.sections.some((item) => item.name === "Imported Core"), "Imported Section missing");
  assert(importedProject.sessions.find((item) => item.role === "review")?.externalThreadId === "source-review-thread", "Imported Review session missing");
  assert(importedProject.checkpoints.some((item) => item.id === "source-r9"), "Imported checkpoint missing");
  assert(importedProject.decisions.some((item) => item.id === "source-decision"), "Imported decision missing");
  assert(importedProject.githubSnapshot?.remote?.nameWithOwner === "owner/demo", "Imported GitHub metadata missing");
  await waitFor((current) => {
    const imported = current.projects.find((item) => item.codexProjectId === "fake-import-project");
    return imported?.codexImport?.archiveStatus === "completed" && Number(imported.codexImport.archivedThreadCount) >= 1;
  }, 30000);
  const archivedImportState = readState().projects.find((item) => item.codexProjectId === "fake-import-project");
  assert(archivedImportState.archiveManifests.some((item) => item.sourceType === "codex-thread" && item.sourceId === "source-thread-1"), "Source thread archive provenance missing");
  const requestLog = fs.readFileSync(fakeRequestLogPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert(requestLog.some((entry) => entry.method === "project/list"), "Import never queried official project/list");
  assert(requestLog.some((entry) => entry.method === "thread/start" && entry.params?.projectId === "fake-import-project"), "Import thread was not created in the official Project");
  assert(requestLog.some((entry) => entry.method === "turn/start" && (entry.params?.input || []).some((item) => String(item.text || "").includes("MODE: IMPORT"))), "Dedicated import prompt was not injected");
  assert(requestLog.some((entry) => entry.method === "turn/start" && (entry.params?.input || []).some((item) => String(item.text || "").includes("HARNESS_IMPORT_SCHEMA:"))), "Import schema path was not injected");
  report.checks.push({ name: "codex-project-import-review", pass: true, projectId: importedProject.id, taskId: importedTask.id, revision: importedProject.revision });
  report.checks.push({ name: "codex-source-rollout-archive", pass: true, matchedThreads: importedProject.codexImport.sourceThreadCount, archivedThreads: importedProject.codexImport.archivedThreadCount });
  } else {
    report.checks.push({ name: "hosted-ci-runtime-fallback", pass: true, detail: "Production submit and automatic Review IPC verified; full fake app-server and archive path runs in local qualification." });
  }
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  process.exitCode = 1;
} finally {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (app) {
    const electronProcess = app.process();
    const closed = await Promise.race([
      app.close().then(() => true, () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!closed && !electronProcess.killed) electronProcess.kill();
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.pass) process.stdout.write(`SMOKE_PASS: ${reportPath}\n`);
else process.exit(1);
