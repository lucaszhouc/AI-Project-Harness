const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");
const {
  CTO_MAX_CHARS,
  REVIEW_MAX_CHARS,
  buildCtoContextPacket,
  buildReviewContextPacket,
} = require("../electron/context-packets.cjs");

test("CTO packet is a bounded project index with source, HEAD, sessions and references", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  project.goal = "长期项目目标";
  project.checkpoints.unshift({ revision: 4, summary: "已接受进展", nextStep: "规划下一任务", evidence: [{ type: "test", value: "npm test" }] });
  project.tasks.unshift(machine.createTask(state, project.id, { title: "下一项任务", criteria: "可验收" }));
  const packet = buildCtoContextPacket(project);
  assert.ok(packet.length <= CTO_MAX_CHARS);
  assert.match(packet, /由 AI Project Harness 自举接入/);
  assert.match(packet, /PROJECT_HEAD: R1/);
  assert.match(packet, /下一项任务/);
  assert.match(packet, /CTO · 项目核心/);
  assert.match(packet, /项目目录：/);
});

test("Review packet stays bounded and contains only active candidate evidence", () => {
  const state = machine.createInitialState("C:\\fixture");
  const project = state.projects[0];
  const task = machine.createTask(state, project.id, { title: "审核候选" });
  machine.dispatchTask(state, project.id, task.id);
  machine.submitTaskResult(state, project.id, task.id, {
    summary: "x".repeat(20000),
    acceptance: [{ criterion: "通过", status: "pass" }],
    evidence: [{ type: "log", value: "y".repeat(20000) }],
  });
  const packet = buildReviewContextPacket(project);
  assert.ok(packet.length <= REVIEW_MAX_CHARS);
  assert.match(packet, /Review Agent/);
  assert.match(packet, /审核候选/);
  assert.ok(!packet.includes("x".repeat(20000)));
  assert.ok(!packet.includes("y".repeat(20000)));
});

test("store writes CTO and Review packet files atomically beside durable state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-context-packets-"));
  try {
    const dataRoot = path.join(root, "data");
    const statePath = path.join(dataRoot, "harness-state.json");
    const store = new HarnessStore(statePath, path.join(root, "project"), { contextRoot: dataRoot });
    const project = machine.addProject(store.state, path.join(root, "Local Chat"));
    store.write();
    const contextDir = path.join(dataRoot, "projects", project.id, "context");
    assert.ok(fs.existsSync(path.join(contextDir, "cto-context.md")));
    assert.ok(fs.existsSync(path.join(contextDir, "review-context.md")));
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const savedProject = saved.projects.find((item) => item.id === project.id);
    assert.equal(savedProject.contextPackets.cto.path, path.join(contextDir, "cto-context.md"));
    assert.ok(savedProject.contextPackets.review.chars <= REVIEW_MAX_CHARS);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("store migrates legacy review candidates through the automatic Review Agent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-legacy-review-"));
  try {
    const store = new HarnessStore(path.join(root, "harness-state.json"), root, { contextRoot: root });
    const project = store.state.projects[0];
    const task = project.tasks.find((item) => item.status === "accepted");
    assert.ok(task, "legacy bootstrap candidate was not auto-reviewed");
    assert.equal(task.review?.agent, "codex");
    assert.equal(task.review?.status, "approved");
    assert.equal(project.revision, 2);
    assert.equal(project.tasks.some((item) => item.status === "review" && item.candidate), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
