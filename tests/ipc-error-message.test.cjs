const test = require("node:test");
const assert = require("node:assert/strict");

test("renderer hides Electron remote-method wrappers from users", async () => {
  const { userFacingErrorMessage } = await import("../src/ipc-error-message.mjs");
  const message = userFacingErrorMessage(
    new Error("Error invoking remote method 'project:add-by-name': Error: 未找到项目“Local Chat”"),
  );

  assert.equal(message, "未找到项目“Local Chat”");
  assert.doesNotMatch(message, /Error invoking remote method|project:add-by-name/);
});

test("renderer translates an unavailable Codex executable into an actionable Chinese error", async () => {
  const { userFacingErrorMessage } = await import("../src/ipc-error-message.mjs");
  const message = userFacingErrorMessage(
    new Error("Error invoking remote method 'project:add-by-name': Error: spawn C:\\Codex\\codex.exe ENOENT"),
  );

  assert.equal(message, "无法启动 Codex。请确认 Codex Desktop 已安装并可正常打开。");
});

test("renderer translates a Windows cmd spawn EINVAL into an actionable Chinese error", async () => {
  const { userFacingErrorDetails } = await import("../src/ipc-error-message.mjs");
  const details = userFacingErrorDetails(
    new Error("Error invoking remote method 'project:add-by-name': Error: spawn EINVAL\n错误编号：APH-20260902-050607-1f3a30"),
  );

  assert.deepEqual(details, {
    message: "Codex 启动入口不兼容。请更新 Harness 后重试；若仍失败，请打开错误日志。",
    errorId: "APH-20260902-050607-1f3a30",
  });
});

test("renderer turns a two-word network failure into Chinese and keeps its error id separate", async () => {
  const { userFacingErrorDetails } = await import("../src/ipc-error-message.mjs");
  const details = userFacingErrorDetails(
    new Error("Error invoking remote method 'project:add-by-name': Error: fetch failed\n错误编号：APH-20260902-043000-a1b2c3"),
  );

  assert.deepEqual(details, {
    message: "无法连接 Codex 服务。请确认 Codex Desktop 正常运行后重试。",
    errorId: "APH-20260902-043000-a1b2c3",
  });
});

test("renderer explains Codex app-server timeout, closed input, and exit failures", async () => {
  const { userFacingErrorDetails } = await import("../src/ipc-error-message.mjs");
  const cases = [
    ["initialize timed out after 15000ms", "Codex 连接超时（初始化阶段）。请确认 Codex Desktop 正常运行后重试。"],
    ["Codex app-server is not writable", "Codex 连接已中断。请重新打开 Codex Desktop 后重试。"],
    ["Codex app-server exited (1)", "Codex 后台服务意外退出。请重新打开 Codex Desktop 后重试。"],
  ];

  for (const [raw, expected] of cases) {
    assert.equal(userFacingErrorDetails(new Error(raw)).message, expected);
  }
});
