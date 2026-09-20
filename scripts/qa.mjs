import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const cdpUrl = process.env.APH_CDP_URL || "http://127.0.0.1:9333";
const qaDir = path.resolve(process.env.APH_QA_DIR || "qa/manual");
fs.mkdirSync(qaDir, { recursive: true });

async function waitForCdp() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return;
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Electron CDP did not become ready: ${cdpUrl}`);
}

await waitForCdp();
const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => !candidate.url().startsWith("devtools://")) || context.pages()[0];
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 15000 });
await page.evaluate(() => window.resizeTo(1480, 920));
await page.waitForTimeout(350);

const initial = await page.evaluate(() => ({
  title: document.querySelector(".head-copy h1")?.textContent,
  revision: document.querySelector(".project-context b")?.textContent,
  review: document.querySelector(".review-block h2")?.textContent,
  drawerHidden: document.querySelector(".project-drawer")?.getAttribute("aria-hidden"),
  mainHasGitPanel: Boolean(document.querySelector(".work-surface .git-head")),
  primaryRegions: document.querySelectorAll(".content-column > .project-head, .content-column > .review-block, .content-column > .task-section").length,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  fontBahnschrift: document.fonts.check("16px Bahnschrift"),
  accent: getComputedStyle(document.documentElement).getPropertyValue("--signal").trim(),
}));

if (initial.revision !== "HEAD R1") throw new Error(`Expected initial HEAD R1, got ${initial.revision}`);
if (!initial.review) throw new Error("Initial review gate is missing");
if (initial.drawerHidden !== "true") throw new Error("Project details drawer should be closed by default");
if (initial.mainHasGitPanel) throw new Error("Git detail leaked into the primary work surface");
if (initial.primaryRegions !== 3) throw new Error(`Expected three primary regions, got ${initial.primaryRegions}`);
if (initial.horizontalOverflow) throw new Error("Initial desktop layout overflows horizontally");
if (!initial.fontBahnschrift) throw new Error("Bahnschrift did not load");
await page.screenshot({ path: path.join(qaDir, "01-simple-first-read.png") });

await page.getByRole("button", { name: "接入项目", exact: true }).click();
const projectDialog = page.locator("#project-dialog");
await projectDialog.waitFor({ state: "visible", timeout: 3000 });
const projectOnboarding = await projectDialog.evaluate((dialog) => ({
  inputCount: dialog.querySelectorAll("input").length,
  inputName: dialog.querySelector("input")?.getAttribute("name"),
  inputFocused: dialog.querySelector("input") === document.activeElement,
  text: dialog.textContent,
  submitText: dialog.querySelector('button[type="submit"]')?.textContent,
}));
if (projectOnboarding.inputCount !== 1 || projectOnboarding.inputName !== "projectName") {
  throw new Error("Project onboarding must ask only for a project name");
}
if (!projectOnboarding.inputFocused) throw new Error("Project-name input did not receive focus");
if (!projectOnboarding.text?.includes("Codex · 默认连接") || !projectOnboarding.text.includes("自动创建独立任务并注入 Harness Skill")) {
  throw new Error("Default Codex connection contract is not visible");
}
if (!projectOnboarding.text?.includes("只需要近似项目名") || !projectOnboarding.text.includes("支持缩写、少量错拼和省略分隔符")) {
  throw new Error("Approximate project-name discovery guidance is not visible");
}
if (projectOnboarding.submitText?.trim() !== "交给 Codex") throw new Error("Project onboarding primary action is incorrect");
await page.screenshot({ path: path.join(qaDir, "02-project-onboarding.png") });
const missingProjectName = "aph-project-that-does-not-exist-qa";
await projectDialog.locator('input[name="projectName"]').fill(missingProjectName);
await projectDialog.getByRole("button", { name: "交给 Codex" }).click();
await page.waitForSelector(".toast--error", { state: "visible", timeout: 20000 });
const failedOnboarding = await page.evaluate((expected) => ({
  dialogOpen: document.querySelector("#project-dialog")?.hasAttribute("open"),
  inputValue: document.querySelector("#project-dialog input")?.value,
  error: document.querySelector(".toast--error")?.textContent,
}), missingProjectName);
if (!failedOnboarding.dialogOpen || failedOnboarding.inputValue !== missingProjectName || !/未找到项目|未能可靠定位项目/.test(failedOnboarding.error || "")) {
  throw new Error("Failed project discovery did not preserve the dialog, input, and actionable error");
}
await page.waitForSelector(".toast--visible", { state: "hidden", timeout: 5000 });
await page.keyboard.press("Escape");
if (await projectDialog.isVisible()) throw new Error("Project onboarding dialog did not close with Escape");

await page.getByRole("button", { name: "项目详情", exact: true }).click();
await page.waitForSelector(".project-drawer--open");
const drawer = await page.evaluate(() => ({
  visible: document.querySelector(".project-drawer")?.getAttribute("aria-hidden"),
  branch: document.querySelector(".project-drawer .git-head strong")?.textContent,
  agents: document.querySelectorAll(".project-drawer .agent-row").length,
  closeFocused: document.activeElement?.getAttribute("aria-label"),
}));
if (drawer.visible !== "false" || drawer.branch !== "main" || drawer.agents !== 2) throw new Error("Project details drawer is incomplete");
if (drawer.closeFocused !== "关闭项目详情") throw new Error("Drawer did not move focus to its close action");
await page.screenshot({ path: path.join(qaDir, "03-project-details-drawer.png") });
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".project-drawer")?.getAttribute("aria-hidden") === "true");

await page.getByRole("button", { name: "接受并推进 HEAD" }).click();
await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R2");
if (!await page.getByText("目前没有需要确认的结果").isVisible()) throw new Error("Quiet no-review state is missing");

await page.keyboard.press("Control+n");
const taskDialog = page.locator("#task-dialog");
const titleFocused = await taskDialog.locator('input[name="title"]').evaluate((element) => element === document.activeElement);
if (!titleFocused) throw new Error("New-task shortcut did not focus the title");
await taskDialog.locator('input[name="title"]').fill("验证一次性 Session 在超长任务标题下仍保持审核与 Git 证据的完整关联");
await taskDialog.locator('input[name="workstream"]').fill("qa-boundary");
await taskDialog.locator('textarea[name="criteria"]').fill("最小桌面宽度不横向溢出\n候选结果必须经过用户审核\n一次性 Session 在接受后退役");
await taskDialog.locator('select[name="sessionPolicy"]').selectOption("disposable");
await taskDialog.getByRole("button", { name: "创建任务" }).click();

const taskRow = page.locator(".task-row").filter({ hasText: "验证一次性 Session" }).first();
await taskRow.getByRole("button", { name: "开始任务" }).click();
await taskRow.getByRole("button", { name: "提交结果" }).click();
const resultDialog = page.locator("#result-dialog");
await resultDialog.locator('textarea[name="result"]').fill(JSON.stringify({
  summary: "边界任务已完成，等待用户接受后推进 Project HEAD。",
  completed: ["最小窗口检查", "审核门检查", "Session 退役检查"],
  remaining: [],
  nextStep: "接受结果并确认 R3。",
  acceptance: [
    { criterion: "最小桌面宽度不横向溢出", status: "pass" },
    { criterion: "候选结果必须经过用户审核", status: "pass" },
    { criterion: "一次性 Session 在接受后退役", status: "pending" },
  ],
  evidence: [
    { type: "test", value: "npm run check" },
    { type: "git", value: "live worktree status" },
  ],
}, null, 2));
await resultDialog.getByRole("button", { name: "送交审核" }).click();
await page.waitForSelector(".review-block");

await page.evaluate(() => window.resizeTo(1100, 700));
await page.waitForTimeout(350);
const pressure = await page.evaluate(() => ({
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  reviewVisible: Boolean(document.querySelector(".review-actions")),
  railWidth: document.querySelector(".project-rail")?.getBoundingClientRect().width,
  workWidth: document.querySelector(".work-surface")?.getBoundingClientRect().width,
  titleClipped: document.querySelector(".task-row h3")?.scrollWidth > document.querySelector(".task-row h3")?.clientWidth,
}));
if (pressure.horizontalOverflow) throw new Error("Minimum desktop layout overflows horizontally");
if (!pressure.reviewVisible || pressure.railWidth < 180 || pressure.workWidth < 800) throw new Error("Critical desktop structure collapsed at minimum width");
await page.screenshot({ path: path.join(qaDir, "04-pressure-1100x700.png") });

await page.getByRole("button", { name: "接受并推进 HEAD" }).click();
await page.waitForFunction(() => document.querySelector(".project-context b")?.textContent === "HEAD R3");
await page.evaluate(() => window.resizeTo(1480, 920));
await page.waitForTimeout(350);

const finalState = await page.evaluate(() => ({
  revision: document.querySelector(".project-context b")?.textContent,
  reviewEmpty: document.querySelector(".review-empty strong")?.textContent,
  retiredSession: Array.from(document.querySelectorAll(".session-state")).some((item) => item.textContent === "retired"),
  acceptedRows: document.querySelectorAll(".task-row--accepted").length,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
}));
if (finalState.revision !== "HEAD R3") throw new Error("Accepted result did not advance Project HEAD to R3");
if (!finalState.retiredSession) throw new Error("Disposable Session did not retire");
if (finalState.acceptedRows < 2) throw new Error("Accepted Task state did not render");
if (finalState.horizontalOverflow) throw new Error("Final desktop layout overflows horizontally");
if (consoleErrors.length) throw new Error(`Renderer errors: ${consoleErrors.join(" | ")}`);
await page.screenshot({ path: path.join(qaDir, "05-no-review-final.png") });

const report = { cdpUrl, initial, projectOnboarding, failedOnboarding, drawer, pressure, finalState, consoleErrors };
fs.writeFileSync(path.join(qaDir, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await browser.close();
