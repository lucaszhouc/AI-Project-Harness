const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");

function fixture() {
  const state = machine.createEmptyState();
  const project = machine.createBlankProject(state, { name: "Knowledge demo", path: "C:\\work\\knowledge", goal: "保留用户认可的工作方法" });
  const task = machine.createTask(state, project.id, { title: "发布桌面新版", workstream: "release", criteria: ["完成交付"] });
  return { state, project, task };
}

const knowledge = {
  version: 1,
  rules: [{
    id: "rule-release-version",
    type: "rule",
    status: "pending",
    title: "功能更新必须递增版本",
    scope: "project",
    kind: "must",
    statement: "功能更新交付前必须递增程序版本。",
    rationale: "避免桌面入口继续打开旧构建。",
    sources: [{ evidenceId: "u1", quote: "以后功能更新必须更新版本。", role: "user", threadId: "thread-1", turnId: "turn-1" }],
  }],
  playbooks: [{
    id: "playbook-release",
    type: "playbook",
    status: "pending",
    version: 1,
    title: "本机功能更新交付",
    scope: "project",
    trigger: "发布桌面新版",
    purpose: "让用户能打开并验证实际新版",
    steps: [{ order: 1, action: "打包后运行 smoke", validation: "portable smoke PASS", sources: [{ evidenceId: "u1", quote: "以后功能更新必须更新版本。", role: "user" }] }],
  }],
};

test("pending knowledge is durable but never enters a mission packet", () => {
  const { state, project, task } = fixture();
  machine.recordKnowledgeCandidates(state, project.id, task.id, knowledge);
  assert.equal(project.knowledgeCandidates.length, 2);
  assert.equal(project.ruleCards.length, 0);
  const packet = machine.buildMissionPacket(project, task, { cursor: project.revision });
  assert.doesNotMatch(packet, /功能更新交付前必须递增程序版本/);
  assert.doesNotMatch(packet, /本机功能更新交付/);
});

test("explicit acceptance versions knowledge and injects only accepted rules and playbooks", () => {
  const { state, project, task } = fixture();
  machine.recordKnowledgeCandidates(state, project.id, task.id, knowledge);
  const beforeContract = project.contractRevision;
  machine.acceptKnowledgeCandidate(state, project.id, "rule-release-version");
  machine.acceptKnowledgeCandidate(state, project.id, "playbook-release");
  assert.equal(project.ruleCards.length, 1);
  assert.equal(project.playbooks.length, 1);
  assert.equal(project.knowledgeCandidates.every((item) => item.status === "accepted"), true);
  assert.equal(project.contractRevision, beforeContract + 2);
  const packet = machine.buildMissionPacket(project, task, { cursor: project.revision });
  assert.match(packet, /APPLICABLE_USER_RULES:/);
  assert.match(packet, /功能更新交付前必须递增程序版本/);
  assert.match(packet, /APPLICABLE_PLAYBOOKS:/);
  assert.match(packet, /本机功能更新交付/);
  assert.match(packet, /打包后运行 smoke/);
});

test("rejected knowledge keeps provenance and cannot be accepted later", () => {
  const { state, project, task } = fixture();
  machine.recordKnowledgeCandidates(state, project.id, task.id, knowledge);
  machine.rejectKnowledgeCandidate(state, project.id, "rule-release-version", "只适用于一次临时任务");
  const rejected = project.knowledgeCandidates.find((item) => item.id === "rule-release-version");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, "只适用于一次临时任务");
  assert.throws(() => machine.acceptKnowledgeCandidate(state, project.id, "rule-release-version"), /KNOWLEDGE_CANDIDATE_NOT_PENDING/);
});

test("recording the same knowledge candidate twice is idempotent", () => {
  const { state, project, task } = fixture();
  machine.recordKnowledgeCandidates(state, project.id, task.id, knowledge);
  machine.recordKnowledgeCandidates(state, project.id, task.id, knowledge);
  assert.equal(project.knowledgeCandidates.length, 2);
});

test("a reviewed import records knowledge separately without accepting it", () => {
  const state = machine.createEmptyState();
  const requested = machine.requestCodexProjectImport(state, {
    codexProjectId: "selection:knowledge",
    bindCodexProject: false,
    sourceKind: "thread-selection",
    selectedThreadIds: ["thread-1"],
    name: "Imported knowledge",
    path: "C:\\work\\imported-knowledge",
  });
  machine.dispatchTask(state, requested.project.id, requested.task.id);
  const candidate = {
    version: 1,
    type: "harness-import",
    generatedAt: "2026-09-28T00:00:00.000Z",
    source: { agent: "codex", codexProjectId: "selection:knowledge", threadIds: ["thread-1"] },
    project: { name: "Imported knowledge", path: requested.project.path },
    tasks: [], sections: [], checkpoints: [], decisions: [],
    knowledge,
  };
  machine.recordCodexImportCandidate(state, requested.project.id, requested.task.id, candidate);
  assert.equal(requested.project.knowledgeCandidates.length, 2);
  assert.equal(requested.project.ruleCards.length, 0);
  assert.equal(requested.project.playbooks.length, 0);
});

test("legacy projects migrate empty knowledge collections without inventing accepted rules", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-knowledge-migrate-"));
  const statePath = path.join(root, "state.json");
  const state = machine.createEmptyState();
  const project = machine.createBlankProject(state, { name: "Legacy", path: path.join(root, "repo") });
  delete project.knowledgeCandidates;
  delete project.ruleCards;
  delete project.playbooks;
  fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
  try {
    const store = new HarnessStore(statePath, project.path, { contextRoot: root, persistJournal: false, initialStateMode: "empty" });
    assert.deepEqual(store.state.projects[0].knowledgeCandidates, []);
    assert.deepEqual(store.state.projects[0].ruleCards, []);
    assert.deepEqual(store.state.projects[0].playbooks, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
