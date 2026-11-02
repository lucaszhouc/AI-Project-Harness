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
  project.ruleCards = [{ id: "rule-1", type: "rule", status: "active", kind: "must", scope: "project", title: "先测试", statement: "交付前必须测试。", sources: [] }];
  project.playbooks = [{ id: "playbook-1", type: "playbook", status: "active", version: 1, scope: "project", title: "发布闭环", trigger: "发布新版", purpose: "可靠交付", steps: [{ order: 1, action: "运行 smoke", sources: [] }] }];
  const packet = buildCtoContextPacket(project);
  assert.ok(packet.length <= CTO_MAX_CHARS);
  assert.match(packet, /由 AI Project Harness 自举接入/);
  assert.match(packet, /PROJECT_HEAD: R1/);
  assert.match(packet, /下一项任务/);
  assert.match(packet, /CTO · 项目核心/);
  assert.match(packet, /项目目录：/);
  assert.match(packet, /用户规则与 Playbook/);
  assert.match(packet, /交付前必须测试/);
  assert.match(packet, /发布闭环/);
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
  project.knowledgeCandidates = [{ id: "rule-pending", type: "rule", status: "pending", title: "截图必须交付", scope: "project", kind: "must", statement: "完成后展示截图。", sources: [{ evidenceId: "u1", quote: "截图不知道发。", role: "user" }] }];
  const packet = buildReviewContextPacket(project);
  assert.ok(packet.length <= REVIEW_MAX_CHARS);
  assert.match(packet, /Review Agent/);
  assert.match(packet, /审核候选/);
  assert.ok(!packet.includes("x".repeat(20000)));
  assert.ok(!packet.includes("y".repeat(20000)));
  assert.match(packet, /待审核知识候选/);
  assert.match(packet, /截图不知道发/);
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

test("store preserves legacy review candidates as unverified for human review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-legacy-review-"));
  try {
    const store = new HarnessStore(path.join(root, "harness-state.json"), root, { contextRoot: root });
    const project = store.state.projects[0];
    const task = project.tasks.find((item) => item.status === "review" && item.candidate);
    assert.ok(task, "legacy bootstrap candidate was not preserved");
    assert.equal(task.review?.agent, "codex");
    assert.equal(task.review?.status, "legacy_unverified");
    assert.equal(task.review?.automatic, false);
    assert.equal(project.revision, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
