const test = require("node:test");
const assert = require("node:assert/strict");

test("project onboarding status renders a real stage and determinate progress", async () => {
  const { progressOnboardingState, renderOnboardingStatus } = await import("../src/onboarding-ui.mjs");
  const state = progressOnboardingState({
    stage: "checking_git",
    progress: 46,
    label: "正在检查 Git 仓库",
    detail: "Local <Chat>",
  });
  const html = renderOnboardingStatus(state);

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="46"/);
  assert.match(html, /width:46%/);
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

test("official Project creation explains that the Desktop sidebar needs a cold reload", async () => {
  const module = await import("../src/onboarding-ui.mjs");
  const state = module.completedOnboardingState({
    desktopOpened: true,
    desktopProjectRestartRequired: true,
    desktopProjectWarning: "连接已经完成。请彻底退出 Codex Desktop 后重新打开，确认项目是否出现在侧栏。",
  });
  const html = module.renderOnboardingStatus(state);

  assert.equal(state.status, "notice");
  assert.match(html, /侧栏/);
  assert.match(html, /彻底退出 Codex Desktop/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /打开错误日志/);
  assert.doesNotMatch(html, /Codex 已启动并注入上下文/);
});
