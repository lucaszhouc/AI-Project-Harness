const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { HarnessStore } = require("../electron/store.cjs");

test("a production store starts empty and does not create the Harness development project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-first-run-"));
  const store = new HarnessStore(path.join(root, "state.json"), "C:\\dev\\AI-Project-Harness", { persistJournal: false, boundHistory: false, initialStateMode: "empty" });
  assert.deepEqual(store.state.projects, []);
  assert.equal(store.state.selectedProjectId, "");
});
