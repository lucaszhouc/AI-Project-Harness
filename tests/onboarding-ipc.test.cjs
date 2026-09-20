const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createErrorLog } = require("../electron/error-log.cjs");
const { createOnboardingIpcHandler } = require("../electron/onboarding-ipc.cjs");

test("onboarding IPC forwards real progress and logs the exact failing stage", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-onboarding-ipc-"));
  const filePath = path.join(root, "harness-errors.jsonl");
  try {
    const errorLog = createErrorLog({
      filePath,
      appVersion: "0.0.7-test",
      now: () => new Date("2026-09-02T04:15:00.000Z"),
      randomId: () => "stage1",
    });
    const sent = [];
    const event = { sender: { send: (...args) => sent.push(args), isDestroyed: () => false } };
    const onboardProject = async (_name, { onProgress }) => {
      onProgress({ stage: "detecting_codex", progress: 10, label: "正在连接 Codex" });
      onProgress({ stage: "discovering_project", progress: 28, label: "正在定位本地项目" });
      throw new Error("fetch failed");
    };
    const handler = createOnboardingIpcHandler({ onboardProject, errorLog });

    await assert.rejects(handler(event, "Local Chat"), /fetch failed[\s\S]*APH-20260902-041500-stage1/);

    assert.deepEqual(sent.map((entry) => entry[0]), [
      "project:onboarding-progress",
      "project:onboarding-progress",
    ]);
    assert.equal(sent.at(-1)[1].stage, "discovering_project");
    const record = JSON.parse(fs.readFileSync(filePath, "utf8").trim());
    assert.equal(record.stage, "discovering_project");
    assert.equal(record.operation, "project:add-by-name");
    assert.deepEqual(record.context, { queryLength: 10 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("onboarding keeps the original failure visible when the log disk is unavailable", async () => {
  const handler = createOnboardingIpcHandler({
    onboardProject: async () => { throw new Error("Codex app-server exited (1)"); },
    errorLog: { capture: () => { throw new Error("disk full"); } },
  });

  await assert.rejects(
    handler({ sender: { send() {}, isDestroyed: () => false } }, "Local Chat"),
    /Codex app-server exited \(1\)/,
  );
});

test("partial desktop-open failure is logged and returned as a persistent warning", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-onboarding-warning-"));
  const filePath = path.join(root, "harness-errors.jsonl");
  try {
    const errorLog = createErrorLog({
      filePath,
      appVersion: "0.0.9-test",
      now: () => new Date("2026-09-02T06:00:00.000Z"),
      randomId: () => "open01",
    });
    const handler = createOnboardingIpcHandler({
      onboardProject: async () => ({
        desktopOpened: false,
        desktopError: "codex app exited (1)",
        matchedProjectName: "iva-local-chat",
      }),
      errorLog,
    });

    const result = await handler({ sender: { send() {}, isDestroyed: () => false } }, "Local Chat");
    assert.deepEqual(result.desktopWarning, {
      message: "项目已经准备好，但 Codex 没有自动打开。你可以再试一次。",
      errorId: "APH-20260902-060000-open01",
    });
    const record = JSON.parse(fs.readFileSync(filePath, "utf8").trim());
    assert.equal(record.operation, "codex:open-desktop");
    assert.equal(record.stage, "opening_codex_desktop");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("official Project creation returns a cold-restart notice without fabricating an error", async () => {
  const handler = createOnboardingIpcHandler({
    onboardProject: async () => ({
      desktopOpened: true,
      desktopProjectRestartRequired: true,
      desktopProjectWarning: "连接已经完成。请彻底退出 Codex Desktop 后重新打开，确认项目是否出现在侧栏。",
    }),
    errorLog: { capture: () => { throw new Error("must not log an informational notice"); } },
  });
  const result = await handler({ sender: { send() {}, isDestroyed: () => false } }, "AI Harness");
  assert.equal(result.desktopProjectRestartRequired, true);
  assert.equal(result.desktopProjectWarning.includes("彻底退出"), true);
  assert.equal(result.desktopWarning, undefined);
});
