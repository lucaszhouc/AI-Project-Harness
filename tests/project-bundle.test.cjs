const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sm = require("../electron/state-machine.cjs");
const { buildBundle, exportProjectBundle, importProjectBundle, validateBundle } = require("../electron/project-bundle.cjs");

test("project bundle exports state without transcript bytes and imports idempotently", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-bundle-"));
  const source = sm.createInitialState(path.join(root, "repo"));
  const project = source.projects[0];
  const target = path.join(root, "demo.aph-project.json");
  const exported = exportProjectBundle(project, target, { archives: [{ id: "a", sha256: "a".repeat(64), bytes: 12 }] });
  assert.ok(fs.existsSync(target));
  assert.equal(validateBundle(exported.bundle).project.id, project.id);
  const destination = { schemaVersion: 1, selectedProjectId: "", projects: [] };
  assert.equal(importProjectBundle(destination, exported.bundle).imported, true);
  assert.equal(importProjectBundle(destination, exported.bundle).imported, false);
  assert.equal(destination.projects.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
