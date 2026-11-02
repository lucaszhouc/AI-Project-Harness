const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeKnowledgePayload } = require("../electron/knowledge-compiler.cjs");

const evidence = {
  userEvidence: [
    { id: "u1", role: "user", threadId: "thread-1", turnId: "turn-1", quote: "以后功能更新必须更新版本，因为桌面不能再打开旧版。" },
    { id: "u2", role: "user", threadId: "thread-1", turnId: "turn-2", quote: "截图和测试结果也必须交付。" },
  ],
  agentEvidence: [
    { id: "a1", role: "assistant", threadId: "thread-1", turnId: "turn-1", quote: "我建议更新版本。" },
  ],
  actions: [{ id: "x1", threadId: "thread-1", turnId: "turn-1", name: "exec_command", input: "npm test", result: "pass" }],
};

test("knowledge compiler accepts traceable user rules and playbook steps", () => {
  const result = normalizeKnowledgePayload({
    rules: [{
      title: "更新必须递增版本",
      scope: "project",
      kind: "must",
      statement: "完成功能更新后递增程序版本。",
      rationale: "桌面入口不能继续指向旧构建。",
      sources: [{ evidenceId: "u1", quote: evidence.userEvidence[0].quote }],
    }],
    playbooks: [{
      title: "本机功能更新交付",
      scope: "project",
      trigger: "完成一个交给用户使用的功能更新",
      purpose: "让用户能够打开并验证实际新版",
      steps: [
        { action: "更新版本并重新打包", validation: "EXE 版本与目标版本一致", sources: [{ evidenceId: "u1", quote: evidence.userEvidence[0].quote }] },
        { action: "展示截图和自动测试结果", validation: "用户可看到截图和 PASS 数量", sources: [{ evidenceId: "u2", quote: evidence.userEvidence[1].quote }] },
      ],
    }],
  }, evidence);

  assert.equal(result.rules.length, 1);
  assert.equal(result.playbooks.length, 1);
  assert.equal(result.rules[0].status, "pending");
  assert.equal(result.playbooks[0].version, 1);
  assert.ok(result.rules[0].id.startsWith("rule-"));
  assert.ok(result.playbooks[0].id.startsWith("playbook-"));
});

test("knowledge compiler rejects unknown, mismatched, and non-user normative sources", () => {
  const base = {
    rules: [{ title: "Rule", scope: "project", kind: "must", statement: "必须更新版本", sources: [{ evidenceId: "missing", quote: "x" }] }],
    playbooks: [],
  };
  assert.throws(() => normalizeKnowledgePayload(base, evidence), /KNOWLEDGE_SOURCE_UNKNOWN/);
  assert.throws(() => normalizeKnowledgePayload({ ...base, rules: [{ ...base.rules[0], sources: [{ evidenceId: "u1", quote: "被改写的原话" }] }] }, evidence), /KNOWLEDGE_QUOTE_MISMATCH/);
  assert.throws(() => normalizeKnowledgePayload({ ...base, rules: [{ ...base.rules[0], sources: [{ evidenceId: "a1", quote: evidence.agentEvidence[0].quote }] }] }, evidence), /KNOWLEDGE_USER_SOURCE_REQUIRED/);
});

test("knowledge compiler never promotes an Agent-only procedure into a mandatory rule", () => {
  assert.throws(() => normalizeKnowledgePayload({
    rules: [{ title: "Agent suggestion", scope: "global", kind: "must", statement: "必须更新版本", sources: [{ evidenceId: "a1", quote: evidence.agentEvidence[0].quote }] }],
    playbooks: [],
  }, evidence), /KNOWLEDGE_USER_SOURCE_REQUIRED/);
});
