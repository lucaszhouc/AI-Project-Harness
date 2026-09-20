const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const packageJson = require("../package.json");

const {
  resolveAppServerCwd,
  resolveBundledSkillPath,
  resolveBundledAgentSkillPath,
  resolveBundledProtocolPath,
  resolveHarnessCliPath,
  resolveHarnessMcpPath,
} = require("../electron/runtime-paths.cjs");

test("packaged Codex app-server uses a real resources directory instead of app.asar", () => {
  const resourcesPath = "C:\\Program Files\\AI Project Harness\\resources";
  const appPath = path.join(resourcesPath, "app.asar");

  assert.equal(resolveAppServerCwd({ isPackaged: true, resourcesPath, appPath }), resourcesPath);
});

test("packaged Harness skill resolves outside app.asar for the external Codex process", () => {
  const resourcesPath = "C:\\Program Files\\AI Project Harness\\resources";
  const appPath = path.join(resourcesPath, "app.asar");

  assert.equal(
    resolveBundledSkillPath({ isPackaged: true, resourcesPath, appPath }),
    path.join(resourcesPath, "integrations", "codex", "skills", "ai-project-harness", "SKILL.md"),
  );
  assert.equal(
    resolveBundledProtocolPath({ isPackaged: true, resourcesPath, appPath }),
    path.join(resourcesPath, "protocol", "harness-import.schema.json"),
  );
});

test("development runtime keeps using the source checkout", () => {
  const appPath = "E:\\work\\AI-Project-Harness";
  const resourcesPath = "E:\\work\\AI-Project-Harness\\node_modules\\electron\\dist\\resources";

  assert.equal(resolveAppServerCwd({ isPackaged: false, resourcesPath, appPath }), appPath);
  assert.equal(
    resolveBundledSkillPath({ isPackaged: false, resourcesPath, appPath }),
    path.join(appPath, "integrations", "codex", "skills", "ai-project-harness", "SKILL.md"),
  );
});

test("packaging copies Codex integrations into external resources", () => {
  assert.ok(packageJson.build.extraResources.some((item) => item.from === "integrations" && item.to === "integrations"));
  assert.ok(packageJson.build.extraResources.some((item) => item.from === "protocol" && item.to === "protocol"));
  assert.ok(packageJson.build.extraResources.some((item) => item.to === "harness-runtime/electron"));
  assert.ok(packageJson.build.extraResources.some((item) => item.to === "harness-runtime/scripts/harness-cli.mjs"));
});

test("agent skill packs include Claude Code and Hermes handoff contracts", () => {
  for (const agent of ["claude", "hermes"]) {
    const filePath = path.join(__dirname, "..", "integrations", agent, "skills", "ai-project-harness", "SKILL.md");
    assert.ok(fs.existsSync(filePath), `${agent} skill missing`);
    assert.match(fs.readFileSync(filePath, "utf8"), /harness-result/);
  }
});

test("agent skill resolver keeps packaged paths outside app.asar", () => {
  assert.equal(resolveBundledAgentSkillPath({ agent: "claude", isPackaged: true, resourcesPath: "C:\\app\\resources", appPath: "C:\\app\\resources\\app.asar" }), "C:\\app\\resources\\integrations\\claude\\skills\\ai-project-harness\\SKILL.md");
});

test("packaged bridge paths point at executable resources", () => {
  assert.equal(resolveHarnessCliPath({ agent: "codex", isPackaged: true, resourcesPath: "C:\\app\\resources", appPath: "C:\\app\\resources\\app.asar" }), "C:\\app\\resources\\harness-runtime\\scripts\\harness-cli.mjs");
  assert.equal(resolveHarnessMcpPath({ isPackaged: false, resourcesPath: "C:\\app\\resources", appPath: "C:\\repo" }), "C:\\repo\\scripts\\harness-mcp.mjs");
});
