const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { persistKnowledgeEvidence } = require("../electron/knowledge-evidence-store.cjs");

test("knowledge evidence persists as an atomic project sidecar with a verifiable hash", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-knowledge-store-"));
  const packet = {
    version: 1,
    userEvidence: [{ id: "u1", role: "user", threadId: "t1", turnId: "r1", quote: "必须先测试。" }],
    agentEvidence: [],
    actions: [],
    episodes: [],
  };
  try {
    const first = persistKnowledgeEvidence(root, "project-1", packet);
    const second = persistKnowledgeEvidence(root, "project-1", packet);
    assert.equal(first.path, path.join(root, "projects", "project-1", "knowledge", "evidence-index.json"));
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.userEvidenceCount, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(first.path, "utf8")), packet);
    assert.equal(fs.readdirSync(path.dirname(first.path)).some((name) => name.includes(".tmp-")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
