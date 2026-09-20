const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("public docs sync never reads host project state or emits project names", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "sync-docs.mjs"), "utf8");
  assert.doesNotMatch(source, /APH_DATA_ROOT|harness-state\.json|state\.projects|E:\\/);
  assert.match(source, /publicStatus/);
  assert.match(source, /README\.zh-CN\.md/);
});

