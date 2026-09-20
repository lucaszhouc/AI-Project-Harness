const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createManagedWorkspace } = require("../electron/managed-workspace.cjs");

test("managed workspace creates a safe directory under dataRoot/workspaces", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-managed-"));
  try {
    const result = createManagedWorkspace({ dataRoot: root, name: "Demo / Project" });
    assert.equal(path.dirname(result.path), path.join(root, "workspaces"));
    assert.equal(fs.statSync(result.path).isDirectory(), true);
    assert.match(path.basename(result.path), /^Demo-Project$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("managed workspace never overwrites an existing project and allocates a suffix", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-managed-collision-"));
  try {
    const first = createManagedWorkspace({ dataRoot: root, name: "Demo" });
    fs.writeFileSync(path.join(first.path, "keep.txt"), "keep");
    const second = createManagedWorkspace({ dataRoot: root, name: "Demo" });
    assert.notEqual(second.path, first.path);
    assert.equal(fs.readFileSync(path.join(first.path, "keep.txt"), "utf8"), "keep");
    assert.match(path.basename(second.path), /^Demo-2$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("managed workspace rejects empty and reserved Windows names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-managed-invalid-"));
  try {
    assert.throws(() => createManagedWorkspace({ dataRoot: root, name: "   " }), /Project name is required/);
    const result = createManagedWorkspace({ dataRoot: root, name: "CON" });
    assert.doesNotMatch(path.basename(result.path), /^CON$/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
