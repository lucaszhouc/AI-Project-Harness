const test = require("node:test");
const assert = require("node:assert/strict");
const { registerCodexDesktopProject, onboardingPrompt, taskPrompt } = require("../electron/codex-adapter.cjs");

test("task prompt remains a Harness task contract", () => {
  const text = taskPrompt({ id: "p", name: "Demo", path: "C:\\demo" }, { id: "t" }, "TASK: fix", {
    skillPath: "C:\\app\\skills\\ai-project-harness\\SKILL.md",
    writebackSkillPath: "C:\\app\\skills\\ai-project-harness-writeback\\SKILL.md",
    taskStatusSchemaPath: "C:\\app\\protocol\\harness-task-status.schema.json",
  });
  assert.match(text, /MODE: TASK/);
  assert.doesNotMatch(text, /npm run harness|codex app-server|Codex CLI/i);
});

test("native Desktop project registration emits only a codex deep link", async () => {
  const opened = [];
  const result = await registerCodexDesktopProject({
    projectPath: "C:\\work\\demo alpha",
    openExternal: async (uri) => opened.push(uri),
  });
  assert.equal(result.opened, true);
  assert.equal(result.capability, "desktop-native-project-deep-link");
  assert.equal(result.uri, "codex://new?path=C%3A%5Cwork%5Cdemo+alpha");
  assert.deepEqual(opened, [result.uri]);
});

test("native Desktop thread registration never invokes a CLI fallback", async () => {
  const opened = [];
  const result = await registerCodexDesktopProject({
    projectPath: "C:\\work\\desktop-only",
    openExternal: async (uri) => opened.push(uri),
    route: "threads",
  });
  assert.equal(result.opened, true);
  assert.equal(result.capability, "desktop-native-project-deep-link");
  assert.deepEqual(opened, ["codex://threads/new?path=C%3A%5Cwork%5Cdesktop-only"]);
});
