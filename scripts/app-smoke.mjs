import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright-core");

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const electronExecutable = path.resolve(process.env.APH_ELECTRON_EXECUTABLE || path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
));
const packagedExecutable = Boolean(process.env.APH_ELECTRON_EXECUTABLE);
const waitMs = Number(process.env.APH_SMOKE_WAIT_MS || 6500);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aph-app-smoke-"));
const reportPath = path.resolve(process.env.APH_SMOKE_REPORT || path.join(os.tmpdir(), "aph-app-smoke-report.json"));
const captureDir = process.env.APH_CAPTURE_DIR ? path.resolve(process.env.APH_CAPTURE_DIR) : undefined;
if (captureDir) fs.mkdirSync(captureDir, { recursive: true });

if (!fs.existsSync(electronExecutable)) throw new Error(`Electron executable missing: ${electronExecutable}`);

const app = await electron.launch({
  executablePath: electronExecutable,
  args: packagedExecutable ? [] : [projectRoot],
  env: {
    ...process.env,
    APH_USER_DATA: userData,
    APH_TEST_WINDOW_HIDDEN: "1",
    APH_DISABLE_CODEX_PROJECT_PROVISION: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  },
});

const consoleErrors = [];
const report = { waitMs, userData, consoleErrors };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let page;
try {
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".app-shell").waitFor({ timeout: 15000 });

  report.firstRun = await page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector(".head-copy h1")?.textContent?.trim(),
    revision: document.querySelector(".project-context b")?.textContent?.trim(),
    actions: Array.from(document.querySelectorAll("button[data-action]"))
      .map((button) => button.getAttribute("data-action"))
      .filter(Boolean),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  assert(report.firstRun.title === "AI Project Harness", `Unexpected title: ${report.firstRun.title}`);
  assert(!report.firstRun.revision, `Fresh production profile unexpectedly contains a project: ${report.firstRun.revision}`);
  assert(report.firstRun.actions.includes("add-project"), "Blank-project entry is missing");
  assert(report.firstRun.actions.includes("guide-recheck"), "Getting-started guide is missing");
  assert(!report.firstRun.horizontalOverflow, "Fresh first-run window overflows horizontally");
  if (captureDir) await page.screenshot({ path: path.join(captureDir, "first-run-empty.png") });

  await page.locator('[data-action="guide-locale"]').click();
  await page.getByRole("button", { name: "Create project", exact: true }).waitFor();
  const englishFirstRun = await page.locator(".app-shell").innerText();
  assert(englishFirstRun.includes("Getting started"), "English guide title is missing");
  assert(englishFirstRun.includes("Create project"), "English empty-state action is missing");
  assert(!/小助手|新建项目|从 Codex 导入/.test(englishFirstRun), "English first-run still exposes Chinese core actions");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  const englishProjectDialog = page.locator("#project-dialog");
  await englishProjectDialog.waitFor({ state: "visible", timeout: 3000 });
  const englishDialogText = await englishProjectDialog.innerText();
  assert(englishDialogText.includes("Add project"), "English project-dialog title is missing");
  assert(englishDialogText.includes("Import from Codex"), "English import action is missing");
  assert(!/项目从哪里来|从 Codex 导入/.test(englishDialogText), "English project dialog still exposes Chinese core actions");
  await englishProjectDialog.locator("[data-close]").first().click();
  report.englishFirstRun = { switched: true, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) };
  await page.locator('[data-action="guide-locale"]').click();
  await page.getByRole("button", { name: "新建项目", exact: true }).first().waitFor();

  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  const projectDialog = page.locator("#project-dialog");
  await projectDialog.waitFor({ state: "visible", timeout: 3000 });
  await projectDialog.locator('[data-action="select-project-mode"][data-mode="blank"]').click();
  await projectDialog.locator('input[name="blankName"]').fill("First-run smoke project");
  await projectDialog.locator('textarea[name="blankGoal"]').fill("Verify local-first guide and review flow");
  await projectDialog.getByRole("button", { name: "新建项目", exact: true }).last().click();
  await page.waitForFunction(() => /^HEAD R\d+$/.test(document.querySelector(".project-context b")?.textContent || ""), null, { timeout: 10000 });
  report.initial = await page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector(".head-copy h1")?.textContent?.trim(),
    revision: document.querySelector(".project-context b")?.textContent?.trim(),
    actions: Array.from(document.querySelectorAll("button[data-action]")).map((button) => button.getAttribute("data-action")).filter(Boolean),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  assert(/^HEAD R\d+$/.test(report.initial.revision), `Unexpected initial revision: ${report.initial.revision}`);
  assert(report.initial.actions.includes("refresh"), "Refresh action is missing");
  assert(report.initial.actions.includes("open-details"), "Project-details action is missing");
  assert(report.initial.actions.includes("connect-codex"), "Explicit second-transaction Codex connect action is missing");
  assert(report.initial.actions.includes("new-task"), "New-task action is missing");
  assert(!report.initial.horizontalOverflow, "Initial window overflows horizontally");
  if (captureDir) await page.screenshot({ path: path.join(captureDir, "first-run-created.png") });

  await page.locator('[data-action="guide-locale"]').click();
  await page.getByRole("button", { name: "New task", exact: true }).waitFor();
  await page.getByRole("button", { name: "Project details", exact: true }).click();
  const englishDrawer = page.locator(".project-drawer");
  await page.waitForFunction(() => document.querySelector(".project-drawer")?.getAttribute("aria-hidden") === "false");
  const englishDrawerText = await englishDrawer.innerText();
  assert(englishDrawerText.includes("Project health"), "English project-health section is missing");
  assert(englishDrawerText.includes("Conversation archives"), "English archive section is missing");
  assert(!/项目详情|项目健康|会话归档|项目工具/.test(englishDrawerText), "English project drawer still exposes Chinese core labels");
  await englishDrawer.getByRole("button", { name: "Close project details" }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const englishTaskDialog = page.locator("#task-dialog");
  await englishTaskDialog.waitFor({ state: "visible" });
  const englishTaskDialogText = await englishTaskDialog.innerText();
  assert(englishTaskDialogText.includes("Acceptance criteria"), "English task acceptance field is missing");
  assert(englishTaskDialogText.includes("Review mode"), "English task review field is missing");
  assert(!/任务名称|验收条件|审核方式|创建任务/.test(englishTaskDialogText), "English task dialog still exposes Chinese core labels");
  await englishTaskDialog.locator("[data-close]").first().click();
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), "English project window overflows horizontally");
  await page.locator('[data-action="guide-locale"]').click();
  await page.getByRole("button", { name: "新建任务", exact: true }).waitFor();

  await page.locator('[data-action="new-conversation"]').first().evaluate((button) => button.click());
  const conversationDialog = page.locator("#conversation-dialog");
  await conversationDialog.waitFor({ state: "visible", timeout: 3000 });
  assert(await conversationDialog.locator('select[name="agent"] option[value="codex"]').count() === 1, "Project conversation agent selector is missing");
  await conversationDialog.locator('[data-close]').first().click();

  await page.evaluate(() => {
    window.__aphRefreshTrace = [];
    const record = (type) => {
      if (window.__aphRefreshTrace.length >= 100) return;
      window.__aphRefreshTrace.push({
        type,
        at: performance.now(),
        toast: document.querySelector("#toast")?.textContent,
        toastClass: document.querySelector("#toast")?.className,
        busy: document.body.classList.contains("is-busy"),
      });
    };
    record("armed");
    window.__aphRefreshObserver = new MutationObserver(() => record("mutation"));
    window.__aphRefreshObserver.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  report.refreshStartedAt = new Date().toISOString();
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("状态已手动刷新"), null, { timeout: 5000, polling: 100 });
  report.refreshTrace = await page.evaluate(() => {
    window.__aphRefreshObserver?.disconnect();
    return window.__aphRefreshTrace;
  });
  await page.waitForTimeout(1000);
  report.refreshAfterRuntimeUpdate = await page.evaluate(() => ({
    toast: document.querySelector("#toast")?.textContent,
    toastClass: document.querySelector("#toast")?.className,
  }));
  assert(report.refreshAfterRuntimeUpdate.toast?.includes("状态已手动刷新"), "Runtime refresh erased the manual-refresh toast");
  assert(report.refreshAfterRuntimeUpdate.toastClass?.includes("toast--visible"), "Runtime refresh hid the manual-refresh toast early");

  await page.getByRole("button", { name: "项目详情", exact: true }).click();
  const drawer = page.locator(".project-drawer");
  await page.waitForFunction(() => document.querySelector(".project-drawer")?.getAttribute("aria-hidden") === "false");
  const drawerScrollBefore = await page.locator(".drawer-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
  });
  await page.waitForTimeout(waitMs);
  const drawerAfterRefresh = {
    visible: await drawer.getAttribute("aria-hidden"),
    scroll: await page.locator(".drawer-scroll").evaluate((element) => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight })),
  };
  assert(drawerAfterRefresh.visible === "false", "Runtime refresh closed the project-details drawer");
  assert(drawerAfterRefresh.scroll.top >= drawerScrollBefore.top - 1, "Runtime refresh reset project-details scroll");
  await drawer.getByRole("button", { name: "关闭项目详情" }).click();

  const detailsButton = page.getByRole("button", { name: "项目详情", exact: true });
  await detailsButton.focus();
  await page.waitForTimeout(waitMs);
  assert(await page.evaluate(() => document.activeElement?.getAttribute("data-action") === "open-details"), "Runtime refresh interrupted ordinary control focus");

  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const taskDialog = page.locator("#task-dialog");
  await taskDialog.waitFor({ state: "visible" });
  await taskDialog.locator('input[name="title"]').fill("自动刷新期间保持表单状态");
  await taskDialog.locator('select[name="agent"]').selectOption("claude");
  await taskDialog.locator('select[name="sessionPolicy"]').selectOption("disposable");
  await page.waitForTimeout(waitMs);
  const dialogDuringRefresh = await taskDialog.evaluate((element) => ({
    open: element.hasAttribute("open"),
    title: element.querySelector('input[name="title"]')?.value,
    agent: element.querySelector('select[name="agent"]')?.value,
    sessionPolicy: element.querySelector('select[name="sessionPolicy"]')?.value,
  }));
  assert(dialogDuringRefresh.open, "Runtime refresh closed the active task dialog");
  assert(dialogDuringRefresh.title === "自动刷新期间保持表单状态", "Runtime refresh lost task-dialog text");
  assert(dialogDuringRefresh.agent === "claude" && dialogDuringRefresh.sessionPolicy === "disposable", "Runtime refresh lost task-dialog selections");
  await taskDialog.locator('[data-close]').first().click();

  assert(await page.getByText("目前没有需要确认的结果").isVisible(), "Legacy review candidate was left as a manual confirmation gate");

  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await taskDialog.locator('input[name="title"]').fill("Claude 错误路径可见");
  await taskDialog.locator('select[name="agent"]').selectOption("claude");
  await taskDialog.getByRole("button", { name: "创建任务" }).click();
  const taskRow = page.locator(".task-row").filter({ hasText: "Claude 错误路径可见" }).first();
  await taskRow.waitFor();
  await taskRow.getByRole("button", { name: "开始任务" }).click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("Claude Code"), null, { timeout: 5000 });
  assert((await page.locator("#toast").textContent()).includes("Claude Code"), `Claude user-invoked path was not surfaced clearly: ${await page.locator("#toast").textContent()}`);
  await taskRow.getByRole("button", { name: "提交结果", exact: true }).click();
  const resultDialog = page.locator("#result-dialog");
  await resultDialog.waitFor({ state: "visible", timeout: 3000 });
  await resultDialog.locator('textarea[name="result"]').fill(JSON.stringify({ summary: "Claude 用户主动路径完成", completed: ["交接"], remaining: [], nextStep: "继续", acceptance: [{ criterion: "用户可审核", status: "pass" }], evidence: [{ type: "test", value: "app-smoke" }] }));
  await resultDialog.getByRole("button", { name: "送交审核", exact: true }).click();
  await page.getByRole("button", { name: "接受并推进 HEAD", exact: true }).last().waitFor({ timeout: 10000 }).catch(async (error) => {
    throw new Error(`${error.message} | buttons=${await page.locator("button").allTextContents()}`);
  });
  await page.getByRole("button", { name: "接受并推进 HEAD", exact: true }).last().click();
  await page.waitForFunction((initialRevision) => document.querySelector(".project-context b")?.textContent !== initialRevision, report.initial.revision, { timeout: 10000 });
  report.afterAccept = await page.evaluate(() => ({
    revision: document.querySelector(".project-context b")?.textContent,
    reviewEmpty: Boolean(document.querySelector(".review-empty")),
    reviewBlocks: document.querySelectorAll(".review-block").length,
    toast: document.querySelector("#toast")?.textContent,
    buttons: Array.from(document.querySelectorAll("button[data-action]")).map((button) => `${button.getAttribute("data-action")}:${button.textContent?.trim()}`),
  }));

  await page.evaluate(() => window.resizeTo(1100, 700));
  await page.waitForTimeout(350);
  report.minimumWindow = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    reviewEmpty: Boolean(document.querySelector(".review-empty")),
    reviewBlocks: document.querySelectorAll(".review-block").length,
    reviewText: document.querySelector(".review-block")?.textContent?.trim(),
  }));
  assert(!report.minimumWindow.horizontalOverflow, "Minimum desktop window overflows horizontally");
  assert(report.minimumWindow.reviewEmpty, "Minimum desktop window lost the no-review state");
  if (captureDir) await page.screenshot({ path: path.join(captureDir, "first-run-1100x700.png") });
  assert(consoleErrors.length === 0, `Renderer errors: ${consoleErrors.join(" | ")}`);

  report.pass = true;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: ${reportPath}\n`);
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  if (page) {
    report.failureState = await page.evaluate(() => ({
      toast: document.querySelector("#toast")?.textContent,
      toastClass: document.querySelector("#toast")?.className,
      busy: document.body.classList.contains("is-busy"),
      refreshTrace: window.__aphRefreshTrace || [],
    })).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError?.message || diagnosticError) }));
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
}
