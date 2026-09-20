import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const captureDir = process.env.APH_CAPTURE_DIR ? path.resolve(process.env.APH_CAPTURE_DIR) : undefined;
if (captureDir) fs.mkdirSync(captureDir, { recursive: true });

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not reserve a local renderer smoke port");
  return port;
}

const configuredPort = Number(process.env.APH_SMOKE_PORT || 0);
const smokePort = process.env.APH_SMOKE_URL ? configuredPort : (configuredPort || await findFreePort());
const targetUrl = process.env.APH_SMOKE_URL || `http://127.0.0.1:${smokePort}`;
const executablePath = [
  process.env.PW_EXECUTABLE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((candidate) => candidate && fs.existsSync(candidate));
if (!executablePath) throw new Error("No local Chromium browser was found for the headless renderer smoke");

let previewServer;
if (!process.env.APH_SMOKE_URL) {
  const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  previewServer = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(smokePort), "--strictPort"], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) break;
    } catch {
      // The preview server is still starting.
    }
    if (attempt === 49) throw new Error(`Vite preview did not become ready: ${targetUrl}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const snapshot = {
  state: {
    schemaVersion: 1,
    selectedProjectId: "project-smoke",
    projects: [{
      id: "project-smoke",
      name: "AI Project Harness",
      path: "E:\\fixture\\AI-Project-Harness",
      status: "active",
      revision: 1,
      goal: "验证项目接入的加载、失败和恢复状态。",
      objective: { id: "objective-smoke", title: "项目接入交互 smoke", status: "active" },
      tasks: Array.from({ length: 18 }, (_, index) => ({
        id: `task-smoke-${index + 1}`,
        title: `持续滚动回归任务 ${index + 1}`,
        workstream: "renderer",
        criteria: ["heartbeat 后仍保持页面位置"],
        agent: "codex",
        sessionPolicy: "warm",
        status: "accepted",
        baseRevision: 1,
        createdAt: "2026-09-02T05:00:00.000Z",
      })),
      sessions: [],
      checkpoints: [],
      updatedAt: "2026-09-02T05:00:00.000Z",
    }],
  },
  git: {
    "project-smoke": {
      available: true,
      root: "E:\\fixture\\AI-Project-Harness",
      branch: "main",
      ahead: 0,
      behind: 0,
      dirty: false,
      changeCount: 0,
      changes: [],
      commits: [],
      checkedAt: "2026-09-02T05:00:00.000Z",
    },
  },
  agents: {
    codex: { installed: true, path: "C:\\fixture\\codex.exe" },
    claude: { installed: false, path: "" },
  },
  platform: "win32",
};
snapshot.state.projects[0].sessions = Array.from({ length: 18 }, (_, index) => ({
  id: `session-smoke-${index + 1}`,
  agent: "codex",
  type: "warm",
  status: "warm",
  workstream: `工作流 ${index + 1}`,
  cursor: 1,
  taskIds: [],
  createdAt: "2026-09-02T05:00:00.000Z",
}));
snapshot.state.projects.push(...Array.from({ length: 14 }, (_, index) => ({
  id: `project-smoke-${index + 2}`,
  name: `其他项目 ${index + 1}`,
  path: `E:\\fixture\\project-${index + 2}`,
  status: "active",
  revision: 1,
  goal: "用于验证项目导航滚动位置。",
  objective: { id: `objective-smoke-${index + 2}`, title: "导航滚动回归", status: "active" },
  tasks: [],
  sessions: [],
  checkpoints: [],
  updatedAt: "2026-09-02T05:00:00.000Z",
})));

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.addInitScript((initialSnapshot) => {
    const progressListeners = new Set();
    const runtimeListeners = new Set();
    let pending;
    window.__aphSmoke = {
      emit(progress) { for (const listener of progressListeners) listener(progress); },
      emitRuntime(update) { for (const listener of runtimeListeners) listener(update); },
      snapshot: initialSnapshot,
      fail(message) { pending?.reject(new Error(message)); pending = undefined; },
      succeed() {
        pending?.resolve({
          snapshot: initialSnapshot,
          projectId: "project-smoke",
          taskId: "task-smoke",
          threadId: "thread-smoke",
          desktopOpened: true,
          matchedProjectName: "Local Chat",
          match: { query: "localchat", score: 1, kind: "exact" },
        });
        pending = undefined;
      },
      warn() {
        pending?.resolve({
          snapshot: initialSnapshot,
          projectId: "project-smoke",
          taskId: "task-smoke",
          threadId: "thread-smoke",
          desktopOpened: false,
          desktopError: "codex app exited (1)",
          desktopWarning: {
            message: "项目已经准备好，但 Codex 没有自动打开。你可以再试一次。",
            errorId: "APH-20260902-060000-open01",
          },
          matchedProjectName: "Local Chat",
          match: { query: "localchat", score: 1, kind: "exact" },
        });
        pending = undefined;
      },
      logOpenCount: 0,
      refreshCalls: 0,
      rendererReports: [],
    };
    window.harness = {
      snapshot: async () => initialSnapshot,
      addProjectByName: () => new Promise((resolve, reject) => { pending = { resolve, reject }; }),
      createBlankProject: async () => ({ projectId: "project-blank", snapshot: initialSnapshot }),
      importCodexProject: () => new Promise((resolve, reject) => { pending = { resolve, reject }; }),
      onProjectOnboardingProgress: (listener) => {
        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
      },
      onAgentRuntimeUpdate: (listener) => {
        runtimeListeners.add(listener);
        return () => runtimeListeners.delete(listener);
      },
      onArchiveProgress: () => () => {},
      showErrorLog: async () => {
        window.__aphSmoke.logOpenCount += 1;
        return { opened: true, path: "C:\\fixture\\logs\\harness-errors.jsonl" };
      },
      reportRendererError: async (details) => {
        window.__aphSmoke.rendererReports.push(details);
        return { errorId: "APH-RENDERER-SMOKE" };
      },
      selectProject: async () => initialSnapshot,
      createTask: async () => initialSnapshot,
      dispatchTask: async () => ({ snapshot: initialSnapshot, missionPacket: "fixture" }),
      submitTaskResult: async () => initialSnapshot,
      acceptTaskResult: async () => initialSnapshot,
      requestChanges: async () => initialSnapshot,
      copyMissionPacket: async () => ({ copied: true, packet: "fixture" }),
      refreshGit: async () => {
        window.__aphSmoke.refreshCalls += 1;
        return initialSnapshot;
      },
      openCodexProject: async () => ({ opened: true, supported: true, capability: "fixture", message: "fixture", snapshot: initialSnapshot }),
      openAgentTask: async () => ({ opened: true, supported: true, capability: "fixture", message: "fixture", snapshot: initialSnapshot }),
      refreshGitHub: async () => initialSnapshot,
      setProjectStatus: async () => initialSnapshot,
      archiveProject: async () => initialSnapshot,
      restoreProject: async () => initialSnapshot,
      updateProjectContract: async () => initialSnapshot,
      listTemplates: async () => [],
      applyTemplate: async () => initialSnapshot,
      refreshProjectProfile: async () => initialSnapshot,
      createObjective: async () => initialSnapshot,
      setObjectiveStatus: async () => initialSnapshot,
      addDecision: async () => initialSnapshot,
      createSection: async () => initialSnapshot,
      assignTaskToSection: async () => initialSnapshot,
      closeSection: async () => initialSnapshot,
      archiveSection: async () => initialSnapshot,
      importArchive: async () => ({ canceled: true, snapshot: initialSnapshot }),
      listArchives: async () => [],
      verifyArchive: async () => ({ valid: true, bytes: 0, sha256: "" }),
      openArchive: async () => ({ opened: true, path: "fixture" }),
      openRunArchive: async () => ({ opened: true, path: "fixture" }),
      openLedger: async () => ({ opened: true, path: "fixture" }),
      openProjectPath: async () => ({ opened: true, path: "fixture" }),
      exportProject: async () => ({ canceled: true, snapshot: initialSnapshot }),
      importProject: async () => ({ canceled: true, snapshot: initialSnapshot }),
      setGitRemote: async () => ({ remote: { name: "origin", url: "fixture" }, snapshot: initialSnapshot }),
      syncCodexProject: async () => initialSnapshot,
      newProjectConversation: async () => ({ opened: true, supported: true, capability: "fixture", message: "fixture", snapshot: initialSnapshot }),
      openProjectSession: async () => ({ opened: true, supported: true, capability: "fixture", message: "fixture", snapshot: initialSnapshot }),
      toggleWindowPin: async () => ({ alwaysOnTop: false, snapshot: initialSnapshot }),
      stopTask: async () => initialSnapshot,
      rejectTask: async () => initialSnapshot,
    };
  }, snapshot);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".app-shell").waitFor();
  if (captureDir) await page.screenshot({ path: path.join(captureDir, "01-dashboard.png") });
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await page.waitForFunction(() => window.__aphSmoke.refreshCalls === 1);
  await page.getByRole("button", { name: "添加项目", exact: true }).click();
  const dialog = page.locator("#project-dialog");
  const initialChoice = await dialog.evaluate((element) => ({
    submit: element.querySelector('button[type="submit"]')?.textContent?.trim(),
    disabled: element.querySelector('button[type="submit"]')?.disabled,
  }));
  if (!initialChoice.disabled || initialChoice.submit !== "选择方式后继续") throw new Error(`Project source gate missing: ${JSON.stringify(initialChoice)}`);
  await dialog.locator('[data-action="select-project-mode"][data-mode="import"]').click();
  await dialog.getByLabel("Codex 项目名称").fill("Local Chat");
  await dialog.getByRole("button", { name: "开始导入" }).click();

  const starting = await dialog.evaluate((element) => ({
    open: element.hasAttribute("open"),
    busy: element.querySelector("form")?.getAttribute("aria-busy"),
    submit: element.querySelector('button[type="submit"]')?.textContent,
    disabled: element.querySelector('button[type="submit"]')?.disabled,
    value: element.querySelector('input[name="importName"]')?.value,
    status: element.querySelector("#project-onboarding-status")?.textContent,
  }));
  if (!starting.open || starting.busy !== "true" || !starting.disabled || starting.submit?.trim() !== "正在处理…") {
    throw new Error(`Loading state missing: ${JSON.stringify(starting)}`);
  }
  await page.evaluate(() => window.__aphSmoke.emitRuntime({ snapshot: window.__aphSmoke.snapshot, event: { type: "runtime.heartbeat" } }));
  if (!await dialog.isVisible()) throw new Error("Runtime update closed the active onboarding dialog");
  await page.keyboard.press("Escape");
  if (!await dialog.isVisible()) throw new Error("Busy onboarding dialog closed before the operation completed");

  await page.evaluate(() => window.__aphSmoke.emit({
    stage: "checking_git",
    progress: 46,
    label: "正在检查 Git",
    detail: "Local Chat",
  }));
  const progress = await dialog.evaluate((element) => ({
    label: element.querySelector(".onboarding-feedback__heading strong")?.textContent,
    value: element.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
  }));
  if (progress.label !== "正在检查 Git" || progress.value !== "46") {
    throw new Error(`Progress state incorrect: ${JSON.stringify(progress)}`);
  }

  await page.evaluate(() => window.__aphSmoke.fail(
    "Error invoking remote method 'project:add-by-name': Error: fetch failed\n错误编号：APH-20260902-053000-smoke1",
  ));
  await dialog.locator('[role="alert"]').waitFor();
  const failed = await dialog.evaluate((element) => ({
    open: element.hasAttribute("open"),
    busy: element.querySelector("form")?.getAttribute("aria-busy"),
    value: element.querySelector('input[name="importName"]')?.value,
    inputDisabled: element.querySelector('input[name="importName"]')?.disabled,
    submit: element.querySelector('button[type="submit"]')?.textContent,
    error: element.querySelector('[role="alert"]')?.textContent,
  }));
  if (!failed.open || failed.busy !== "false" || failed.value !== "Local Chat" || failed.inputDisabled || failed.submit?.trim() !== "重新尝试") {
    throw new Error(`Recoverable failure state incorrect: ${JSON.stringify(failed)}`);
  }
  if (!failed.error?.includes("无法连接 Codex 服务") || !failed.error.includes("APH-20260902-053000-smoke1") || /Error invoking|fetch failed/.test(failed.error)) {
    throw new Error(`Persistent error panel incorrect: ${JSON.stringify(failed)}`);
  }
  if (process.env.APH_SMOKE_SCREENSHOT) {
    await dialog.screenshot({ path: process.env.APH_SMOKE_SCREENSHOT });
  }

  await dialog.getByRole("button", { name: "打开错误日志" }).click();
  if (await page.evaluate(() => window.__aphSmoke.logOpenCount) !== 1) throw new Error("Error-log action did not call the diagnostics bridge");

  await dialog.getByRole("button", { name: "重新尝试" }).click();
  await page.evaluate(() => {
    window.__aphSmoke.warn();
  });
  await dialog.getByText("已经连接，但 Codex 没有打开").waitFor();
  const warning = await dialog.evaluate((element) => ({
    open: element.hasAttribute("open"),
    submit: element.querySelector('button[type="submit"]')?.textContent,
    error: element.querySelector('[role="alert"]')?.textContent,
  }));
  if (!warning.open || warning.submit?.trim() !== "重新打开 Codex" || !warning.error?.includes("APH-20260902-060000-open01")) {
    throw new Error(`Desktop-open warning state incorrect: ${JSON.stringify(warning)}`);
  }

  await dialog.getByRole("button", { name: "重新打开 Codex" }).click();
  await page.evaluate(() => {
    window.__aphSmoke.emit({ stage: "completed", progress: 100, label: "准备好了" });
    window.__aphSmoke.succeed();
  });
  await dialog.waitFor({ state: "hidden" });

  const final = {
    dialogClosed: !(await dialog.isVisible()),
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    runtimeErrors,
  };
  if (!final.dialogClosed || final.horizontalOverflow || runtimeErrors.length) {
    throw new Error(`Final renderer state failed: ${JSON.stringify(final)}`);
  }

  const surface = page.locator(".work-surface");
  const beforeScroll = await surface.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
  });
  if (beforeScroll.max < 1 || beforeScroll.top < beforeScroll.max - 1) {
    throw new Error(`Homepage did not expose a scrollable work surface: ${JSON.stringify(beforeScroll)}`);
  }
  await page.evaluate(() => window.__aphSmoke.emitRuntime({ snapshot: window.__aphSmoke.snapshot, event: { type: "runtime.heartbeat" } }));
  const afterScroll = await surface.evaluate((element) => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
  if (afterScroll.top < beforeScroll.top - 1) {
    throw new Error(`Runtime update reset homepage scroll: before=${JSON.stringify(beforeScroll)} after=${JSON.stringify(afterScroll)}`);
  }

  const rail = page.locator(".project-rail nav");
  const beforeRailScroll = await rail.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
  });
  if (beforeRailScroll.max < 1 || beforeRailScroll.top < beforeRailScroll.max - 1) {
    throw new Error(`Project rail did not expose a scrollable navigation: ${JSON.stringify(beforeRailScroll)}`);
  }
  await page.evaluate(() => window.__aphSmoke.emitRuntime({ snapshot: window.__aphSmoke.snapshot, event: { type: "runtime.heartbeat" } }));
  const afterRailScroll = await rail.evaluate((element) => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
  if (afterRailScroll.top < beforeRailScroll.top - 1) {
    throw new Error(`Runtime update reset project rail scroll: before=${JSON.stringify(beforeRailScroll)} after=${JSON.stringify(afterRailScroll)}`);
  }

  await page.getByRole("button", { name: "项目详情", exact: true }).click();
  if (captureDir) await page.screenshot({ path: path.join(captureDir, "02-details-drawer.png") });
  await page.waitForFunction(() => document.querySelector(".project-drawer")?.getAttribute("aria-hidden") === "false");
  const drawerScroll = page.locator(".drawer-scroll");
  const beforeDrawerScroll = await drawerScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const drawer = element.closest(".project-drawer");
    return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight, height: element.clientHeight, scrollHeight: element.scrollHeight, drawer: drawer ? { rect: drawer.getBoundingClientRect().toJSON(), display: getComputedStyle(drawer).display, visibility: getComputedStyle(drawer).visibility, transform: getComputedStyle(drawer).transform } : null };
  });
  if (beforeDrawerScroll.max < 1 || beforeDrawerScroll.top < beforeDrawerScroll.max - 1) {
    throw new Error(`Project details did not expose a scrollable drawer: ${JSON.stringify(beforeDrawerScroll)}`);
  }
  await page.evaluate(() => window.__aphSmoke.emitRuntime({ snapshot: window.__aphSmoke.snapshot, event: { type: "runtime.heartbeat" } }));
  if (await page.locator(".project-drawer").getAttribute("aria-hidden") !== "false") throw new Error("Runtime update closed the project details drawer");
  const afterDrawerScroll = await drawerScroll.evaluate((element) => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
  if (afterDrawerScroll.top < beforeDrawerScroll.top - 1) {
    throw new Error(`Runtime update reset project details scroll: before=${JSON.stringify(beforeDrawerScroll)} after=${JSON.stringify(afterDrawerScroll)}`);
  }
  await page.locator(".project-drawer").getByRole("button", { name: "关闭项目详情" }).click();

  const detailsButton = page.getByRole("button", { name: "项目详情", exact: true });
  await detailsButton.focus();
  const focusedRuntimeSnapshot = await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    next.state.projects[0].revision = 2;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "agent.progress" } });
    return next;
  });
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R2");
  const focusedRuntime = await page.evaluate(() => ({
    activeAction: document.activeElement?.getAttribute("data-action"),
    activeLabel: document.activeElement?.getAttribute("aria-label"),
  }));
  if (focusedRuntime.activeAction !== "open-details" || focusedRuntime.activeLabel !== null) {
    throw new Error(`Runtime update interrupted ordinary control focus: ${JSON.stringify(focusedRuntime)} / ${focusedRuntimeSnapshot.state.projects[0].revision}`);
  }

  const criteriaDetails = page.locator(".task-row details").first();
  await criteriaDetails.locator("summary").click();
  if (!(await criteriaDetails.evaluate((element) => element.open))) {
    throw new Error("Task acceptance details did not open");
  }
  const detailsRuntimeSnapshot = await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    next.state.projects[0].revision = 25;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.heartbeat" } });
    return next;
  });
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R25");
  if (!(await criteriaDetails.evaluate((element) => element.open))) {
    throw new Error(`Runtime update collapsed task acceptance details: ${detailsRuntimeSnapshot.state.projects[0].revision}`);
  }
  const restoredCriteriaFocus = await page.evaluate(() => ({
    key: document.activeElement?.getAttribute("data-preserve-focus-key"),
    action: document.activeElement?.getAttribute("data-action"),
  }));
  if (restoredCriteriaFocus.key !== "task-criteria-task-smoke-1" || restoredCriteriaFocus.action !== null) {
    throw new Error(`Runtime update lost task acceptance summary focus: ${JSON.stringify(restoredCriteriaFocus)}`);
  }
  await criteriaDetails.locator("summary").click();
  if (await criteriaDetails.evaluate((element) => element.open)) throw new Error("Task acceptance details did not close");
  await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    next.state.projects[0].revision = 251;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.heartbeat" } });
  });
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R251");
  if (await page.locator(".task-row details").first().evaluate((element) => element.open)) {
    throw new Error("Runtime update reopened a task acceptance details disclosure that the user had closed");
  }

  const reviewRuntimeSnapshot = await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    const task = next.state.projects[0].tasks[0];
    task.status = "review";
    task.candidate = {
      summary: "review details heartbeat regression",
      completed: ["details"],
      remaining: [],
      nextStep: "none",
      acceptance: [{ criterion: "details remain open", status: "pass" }],
      evidence: [{ type: "test", value: "renderer smoke" }],
    };
    const second = structuredClone(task);
    second.id = "task-smoke-review-2";
    second.title = "第二个待审核结果";
    second.candidate = { ...task.candidate, summary: "第二个候选" };
    next.state.projects[0].tasks.unshift(second);
    next.state.projects[0].revision = 252;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.heartbeat" } });
    return next;
  });
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R252");
  const reviewDetails = page.locator(".review-details").first();
  if (await page.locator(".review-block").count() < 2) throw new Error("Review queue dropped a second pending candidate");
  await reviewDetails.locator("summary").click();
  if (!(await reviewDetails.evaluate((element) => element.open))) {
    throw new Error("Review details did not open");
  }
  const reviewPreserveSnapshot = await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    next.state.projects[0].revision = 253;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.heartbeat" } });
    return next;
  });
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R253");
  if (!(await reviewDetails.evaluate((element) => element.open))) {
    throw new Error(`Runtime update collapsed review details: ${reviewPreserveSnapshot.state.projects[0].revision}`);
  }
  await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    const task = next.state.projects[0].tasks[0];
    task.status = "accepted";
    delete task.candidate;
    next.state.projects[0].checkpoints = [
      { revision: 28, summary: "最新已验收进展", acceptedAt: "2026-09-02T06:28:00.000Z" },
      { revision: 27, summary: "较早的进展", acceptedAt: "2026-09-02T06:27:00.000Z" },
    ];
    next.state.projects[0].revision = 254;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.heartbeat" } });
  });
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R254");
  if (await page.locator(".checkpoint strong").textContent() !== "最新已验收进展") {
    throw new Error("Homepage rendered an older checkpoint instead of the latest accepted progress");
  }
  await page.evaluate(() => {
    const stale = structuredClone(window.__aphSmoke.snapshot);
    stale.state.projects[0].revision = 200;
    window.__aphSmoke.emitRuntime({ snapshot: stale, event: { type: "runtime.stale" } });
  });
  await page.waitForTimeout(80);
  if (await page.locator(".project-context b").textContent() !== "HEAD R254") throw new Error("Renderer accepted a stale runtime snapshot");

  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  if (captureDir) await page.screenshot({ path: path.join(captureDir, "03-task-dialog.png") });
  const taskDialog = page.locator("#task-dialog");
  await taskDialog.waitFor({ state: "visible" });
  await taskDialog.locator('input[name="title"]').fill("heartbeat 后仍保留的任务");
  await taskDialog.locator('select[name="agent"]').selectOption("claude");
  await taskDialog.locator('select[name="sessionPolicy"]').selectOption("disposable");
  const dependencySelect = taskDialog.locator('select[name="dependsOn"]');
  const dependencyValues = await dependencySelect.locator("option").evaluateAll((options) => options.filter((option) => !option.disabled).slice(0, 2).map((option) => option.value));
  if (dependencyValues.length) await dependencySelect.selectOption(dependencyValues);
  const dialogViewport = await taskDialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  if (dialogViewport.scrollHeight <= dialogViewport.clientHeight || !["auto", "scroll"].includes(dialogViewport.overflowY)) {
    throw new Error(`Task dialog did not expose a usable internal scroll: ${JSON.stringify(dialogViewport)}`);
  }
  const taskInputHandle = await taskDialog.locator('input[name="title"]').elementHandle();
  await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    next.state.projects[0].revision = 255;
    window.__aphSmoke.snapshot = next;
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.heartbeat" } });
  });
  const taskDialogState = await taskDialog.evaluate((element) => ({ open: element.hasAttribute("open"), value: element.querySelector('input[name="title"]')?.value }));
  const taskSelectState = await taskDialog.evaluate((element) => ({
    agent: element.querySelector('select[name="agent"]')?.value,
    sessionPolicy: element.querySelector('select[name="sessionPolicy"]')?.value,
    dependencies: Array.from(element.querySelector('select[name="dependsOn"]')?.selectedOptions || []).map((option) => option.value),
  }));
  if (!taskDialogState.open || taskDialogState.value !== "heartbeat 后仍保留的任务"
    || taskSelectState.agent !== "claude" || taskSelectState.sessionPolicy !== "disposable"
    || JSON.stringify(taskSelectState.dependencies) !== JSON.stringify(dependencyValues)) {
    throw new Error(`Runtime update lost task dialog state: ${JSON.stringify({ taskDialogState, taskSelectState })}`);
  }
  const dialogBottomState = await taskDialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const submit = element.querySelector('button[type="submit"]');
    const rect = submit?.getBoundingClientRect();
    const viewport = element.getBoundingClientRect();
    return { scrollTop: element.scrollTop, max: element.scrollHeight - element.clientHeight, submitVisible: Boolean(rect && rect.bottom <= viewport.bottom + 1 && rect.top >= viewport.top - 1) };
  });
  if (dialogBottomState.max < 1 || !dialogBottomState.submitVisible) {
    throw new Error(`Task dialog bottom action is not reachable: ${JSON.stringify(dialogBottomState)}`);
  }
  if (captureDir) await taskDialog.screenshot({ path: path.join(captureDir, "04-task-dialog-bottom.png") });
  if (!await page.evaluate((element) => document.querySelector('#task-dialog input[name="title"]') === element, taskInputHandle)) throw new Error("Runtime update replaced the actively edited task input");
  await taskDialog.locator('[data-close]').first().click();
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R255");

  const scrollGuardSnapshot = await page.evaluate(() => {
    const next = structuredClone(window.__aphSmoke.snapshot);
    next.state.projects[0].revision = 256;
    window.__aphSmoke.snapshot = next;
    document.querySelector(".work-surface")?.dispatchEvent(new Event("scroll"));
    window.__aphSmoke.emitRuntime({ snapshot: next, event: { type: "runtime.auto-refresh" } });
    return next;
  });
  const duringScroll = await page.locator(".project-context b").textContent();
  if (duringScroll?.trim() === "HEAD R256") throw new Error(`Runtime update interrupted active scrolling: ${scrollGuardSnapshot.state.projects[0].revision}`);
  await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R256", undefined, { timeout: 1000 });

  const bootPage = await browser.newPage({ viewport: { width: 900, height: 640 } });
  const bootErrors = [];
  bootPage.on("pageerror", (error) => bootErrors.push(error.message));
  await bootPage.addInitScript(() => {
    window.__aphBootSmoke = { logOpenCount: 0 };
    window.harness = {
      snapshot: async () => { throw new Error("boot snapshot failed"); },
      onProjectOnboardingProgress: () => () => {},
      onAgentRuntimeUpdate: () => () => {},
      showErrorLog: async () => {
        window.__aphBootSmoke.logOpenCount += 1;
        return { opened: true, path: "C:\\fixture\\logs\\harness-errors.jsonl" };
      },
      reportRendererError: async () => ({ errorId: "APH-20260902-054500-boot01" }),
    };
  });
  await bootPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await bootPage.getByRole("heading", { name: "启动失败" }).waitFor();
  await bootPage.getByRole("button", { name: "打开错误日志" }).click();
  await bootPage.waitForFunction(() => window.__aphBootSmoke.logOpenCount === 1, undefined, { timeout: 2000 });
  const bootFailure = {
    errorId: await bootPage.locator(".fatal-empty code").textContent(),
    logOpenCount: await bootPage.evaluate(() => window.__aphBootSmoke.logOpenCount),
    runtimeErrors: bootErrors,
  };
  if (bootFailure.errorId !== "APH-20260902-054500-boot01" || bootErrors.length) {
    throw new Error(`Boot diagnostics state failed: ${JSON.stringify(bootFailure)}`);
  }

  process.stdout.write(`${JSON.stringify({ starting, progress, failed, warning, final, scroll: { beforeScroll, afterScroll, beforeRailScroll, afterRailScroll, beforeDrawerScroll, afterDrawerScroll }, bootFailure }, null, 2)}\n`);
} finally {
  await browser.close();
  previewServer?.kill();
}
