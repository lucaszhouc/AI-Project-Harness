const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectProjectProfile } = require("../electron/project-profile.cjs");

test("project profile detects stack, package manager, scripts and entrypoints without recursing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-profile-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@9", scripts: { dev: "vite" }, devDependencies: { typescript: "x", electron: "x" } }), "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "main.ts"), "", "utf8");
  const profile = inspectProjectProfile(root);
  assert.deepEqual(profile.stack, ["Node.js", "TypeScript", "Electron"]);
  assert.equal(profile.packageManager, "pnpm@9");
  assert.deepEqual(profile.entrypoints, ["src/main.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});
