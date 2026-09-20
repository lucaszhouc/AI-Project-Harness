const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sm = require("../electron/state-machine.cjs");
const { syncSqliteIndex, readSqliteSummary } = require("../electron/sqlite-index.cjs");
const { HarnessStore } = require("../electron/store.cjs");

test("SQLite projection mirrors bounded project state when node:sqlite is available", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-sqlite-"));
  try {
    const state = sm.createInitialState(path.join(root, "repo"));
    const result = syncSqliteIndex(path.join(root, "state-index.sqlite"), state);
    if (!result.available) return; // Electron runtimes without node:sqlite use JSON fallback.
    const summary = readSqliteSummary(result.path);
    assert.equal(summary.available, true);
    assert.equal(summary.projects, 1);
    assert.ok(summary.tasks >= 3);
    assert.ok(summary.events >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("store initializes the optional SQLite projection for an existing JSON profile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-sqlite-existing-"));
  try {
    const statePath = path.join(root, "state.json");
    const first = new HarnessStore(statePath, path.join(root, "repo"), { contextRoot: root, sqlitePath: path.join(root, "index.sqlite") });
    const second = new HarnessStore(statePath, path.join(root, "repo"), { contextRoot: root, sqlitePath: path.join(root, "index.sqlite") });
    if (second.sqliteStatus?.available) assert.equal(readSqliteSummary(second.sqliteStatus.path).projects, first.state.projects.length);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
