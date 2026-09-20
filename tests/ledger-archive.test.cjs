const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInitialState, createTask, createSection } = require("../electron/state-machine.cjs");
const { buildProjectLedger, persistProjectLedger } = require("../electron/project-ledger.cjs");
const { importTranscript, listArchiveManifests, readArchiveObject, verifyArchiveObject } = require("../electron/archive.cjs");

test("project ledger is bounded, detached from repository, and updates deterministically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-ledger-"));
  const state = createInitialState(path.join(root, "repo"));
  const project = state.projects[0];
  project.goal = "长期目标";
  project.techStack = ["Electron", "TypeScript"];
  createSection(state, project.id, { name: "前端", kind: "reusable" });
  createTask(state, project.id, { title: "首项任务" });
  assert.match(buildProjectLedger(project), /动态项目白皮书/);
  assert.equal(persistProjectLedger(state, root), true);
  const first = project.ledger;
  assert.ok(fs.existsSync(first.path));
  assert.equal(persistProjectLedger(state, root), false);
  assert.equal(project.ledger.hash, first.hash);
  project.goal = "新的长期目标";
  assert.equal(persistProjectLedger(state, root), true);
  assert.notEqual(project.ledger.hash, first.hash);
  project.goal = "z".repeat(50000);
  assert.ok(buildProjectLedger(project).length <= 24000);
  fs.rmSync(root, { recursive: true, force: true });
});

test("large transcript import stores one content-addressed object and deduplicates repeats", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-archive-"));
  const source = path.join(root, "session.jsonl");
  fs.writeFileSync(source, Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i, text: "same" })).join("\n") + "\n", "utf8");
  const first = await importTranscript(source, root, { projectId: "project-1" });
  const second = await importTranscript(source, root, { projectId: "project-1", sourceId: "thread-1", sourceType: "codex-thread" });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(first.manifest.sha256, second.manifest.sha256);
  assert.equal(first.manifest.lineCount, 1000);
  assert.equal(first.manifest.messageCount, 1000);
  assert.equal(second.manifest.sourceId, "thread-1");
  assert.equal(second.manifest.sourceType, "codex-thread");
  assert.equal(listArchiveManifests(root, { projectId: "project-1" }).length, 1);
  const bytes = await readArchiveObject(root, first.manifest.sha256);
  assert.equal(bytes.length, fs.statSync(source).size);
  assert.equal((await verifyArchiveObject(root, first.manifest)).valid, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("transcript import emits a bounded progress completion signal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-archive-progress-"));
  const source = path.join(root, "progress.log");
  fs.writeFileSync(source, "line\n", "utf8");
  const updates = [];
  await importTranscript(source, root, { onProgress: (value) => updates.push(value) });
  assert.equal(updates.at(-1).done, true);
  assert.equal(updates.at(-1).bytes, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test("transcript import honors an explicit byte safety limit and leaves no partial object", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-archive-limit-"));
  const source = path.join(root, "large.txt");
  fs.writeFileSync(source, "x".repeat(4096), "utf8");
  await assert.rejects(() => importTranscript(source, root, { maxBytes: 100 }), /configured 100 byte limit/);
  const objects = path.join(root, "archive", "objects");
  assert.equal(fs.existsSync(objects) ? fs.readdirSync(objects, { recursive: true }).length : 0, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
