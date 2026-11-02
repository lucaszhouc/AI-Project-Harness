const test = require("node:test");
const assert = require("node:assert/strict");

test("project onboarding renders an observed stage without an invented percentage", async () => {
  const { progressOnboardingState, renderOnboardingStatus } = await import("../src/onboarding-ui.mjs");
  const state = progressOnboardingState({
    stage: "checking_git",
    progress: 46,
    label: "正在检查 Git 仓库",
    detail: "Local <Chat>",
  });
  const html = renderOnboardingStatus(state);

  assert.equal(state.progress, undefined);
  assert.doesNotMatch(html, /aria-valuenow|width:46%|46%/);
  assert.match(html, /总量未知/);
  assert.match(html, /正在检查 Git 仓库/);
  assert.match(html, /Local &lt;Chat&gt;/);
});

test("project onboarding failure stays visible with a Chinese reason, error id, and log action", async () => {
  const { failedOnboardingState, renderOnboardingStatus } = await import("../src/onboarding-ui.mjs");
  const state = failedOnboardingState(
    new Error("Error invoking remote method 'project:add-by-name': Error: fetch failed\n错误编号：APH-20260902-044500-dead12"),
  );
  const html = renderOnboardingStatus(state);

  assert.match(html, /role="alert"/);
  assert.match(html, /这一步没完成/);
  assert.match(html, /无法连接 Codex 服务/);
  assert.match(html, /APH-20260902-044500-dead12/);
  assert.match(html, /data-action="open-error-log"/);
  assert.doesNotMatch(html, /Error invoking|fetch failed/);
});

test("desktop-open partial failure renders a persistent warning instead of false success", async () => {
  const module = await import("../src/onboarding-ui.mjs");
  assert.equal(typeof module.completedOnboardingState, "function");
  const state = module.completedOnboardingState({
    desktopOpened: false,
    desktopWarning: {
      message: "项目已经准备好，但 Codex 没有自动打开。你可以再试一次。",
      errorId: "APH-20260902-060000-open01",
    },
  });
  const html = module.renderOnboardingStatus(state);

  assert.equal(state.status, "warning");
  assert.match(html, /已经连接，但 Codex 没有打开/);
  assert.match(html, /APH-20260902-060000-open01/);
  assert.match(html, /data-action="open-error-log"/);
  assert.doesNotMatch(html, /Codex 已启动并注入上下文/);
});

test("official Project creation explains that the Desktop sidebar needs live verification", async () => {
  const module = await import("../src/onboarding-ui.mjs");
  const state = module.completedOnboardingState({
    desktopOpened: true,
    desktopProjectRestartRequired: true,
    desktopProjectWarning: "连接已经完成。请在现有 Codex Desktop 窗口刷新或手动核对侧栏。",
  });
  const html = module.renderOnboardingStatus(state);

  assert.equal(state.status, "notice");
  assert.match(html, /侧栏/);
  assert.match(html, /现有 Codex Desktop 窗口刷新|手动核对侧栏/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /打开错误日志/);
  assert.doesNotMatch(html, /Codex 已启动并注入上下文/);
});
