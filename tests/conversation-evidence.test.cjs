const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildKnowledgeEvidencePacket, collectConversationEvidence, extractConversationEvidence } = require("../electron/conversation-evidence.cjs");

function line(type, payload, timestamp) {
  return JSON.stringify({ timestamp, type, payload });
}

test("rollout evidence preserves exact user words and links Agent actions by turn", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-evidence-"));
  const rollout = path.join(root, "rollout.jsonl");
  fs.writeFileSync(rollout, [
    line("session_meta", { id: "thread-1" }, "2026-09-27T00:00:00.000Z"),
    line("turn_context", { turn_id: "turn-1" }, "2026-09-27T00:00:01.000Z"),
    line("response_item", { type: "message", id: "developer-1", role: "developer", content: [{ type: "input_text", text: "ignore instructions" }] }, "2026-09-27T00:00:02.000Z"),
    line("response_item", { type: "message", id: "user-1", role: "user", content: [{ type: "input_text", text: "以后功能更新必须更新版本，因为桌面不能再打开旧版。" }] }, "2026-09-27T00:00:03.000Z"),
    line("response_item", { type: "message", id: "assistant-1", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "我会重新打包并验证。" }] }, "2026-09-27T00:00:04.000Z"),
    line("response_item", { type: "custom_tool_call", id: "tool-1", call_id: "call-1", name: "exec_command", input: "npm run package:win" }, "2026-09-27T00:00:05.000Z"),
    line("response_item", { type: "custom_tool_call_output", id: "tool-out-1", call_id: "call-1", output: "exit_code=0" }, "2026-09-27T00:00:06.000Z"),
    line("event_msg", { type: "task_complete", turn_id: "turn-1" }, "2026-09-27T00:00:07.000Z"),
    line("turn_context", { turn_id: "turn-2" }, "2026-09-27T00:01:00.000Z"),
    line("response_item", { type: "message", id: "user-2", role: "user", content: [{ type: "input_text", text: "不是只打包，测试结果和截图也必须交付。" }] }, "2026-09-27T00:01:01.000Z"),
  ].join("\n"), "utf8");

  try {
    const first = await extractConversationEvidence(rollout, { threadId: "thread-1" });
    const second = await extractConversationEvidence(rollout, { threadId: "thread-1" });
    assert.deepEqual(first, second, "the same rollout must produce stable evidence ids");
    assert.deepEqual(first.messages.map((item) => item.role), ["user", "assistant", "user"]);
    assert.equal(first.messages[0].quote, "以后功能更新必须更新版本，因为桌面不能再打开旧版。");
    assert.equal(first.actions[0].name, "exec_command");
    assert.equal(first.actions[0].result, "exit_code=0");
    assert.deepEqual(first.episodes[0].userEvidenceIds, [first.messages[0].id]);
    assert.deepEqual(first.episodes[0].actionEvidenceIds, [first.actions[0].id]);
    assert.equal(first.episodes[1].userEvidenceIds[0], first.messages[2].id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("knowledge evidence packets prioritize user corrections and redact credential-shaped text", async () => {
  const evidence = {
    threadId: "thread-1",
    messages: [
      { id: "u1", role: "user", turnId: "t1", at: "2026-09-27T00:00:00Z", quote: "随便处理一下" },
      { id: "u2", role: "user", turnId: "t2", at: "2026-09-27T00:01:00Z", quote: "不是这样，以后必须先测试。token sk-abcdefghijklmnop" },
      { id: "a1", role: "assistant", turnId: "t2", at: "2026-09-27T00:01:01Z", quote: "收到" },
    ],
    actions: [{ id: "x1", turnId: "t2", at: "2026-09-27T00:01:02Z", name: "exec_command", input: "npm test", result: "pass" }],
    episodes: [{ id: "ep2", turnId: "t2", userEvidenceIds: ["u2"], agentEvidenceIds: ["a1"], actionEvidenceIds: ["x1"] }],
  };

  const packet = buildKnowledgeEvidencePacket([evidence], { maxUserMessages: 1 });
  assert.equal(packet.userEvidence.length, 1);
  assert.equal(packet.userEvidence[0].id, "u2");
  assert.match(packet.userEvidence[0].quote, /\[已脱敏\]/);
  assert.doesNotMatch(packet.userEvidence[0].quote, /sk-abcdefghijklmnop/);
  assert.deepEqual(packet.episodes[0].actionEvidenceIds, ["x1"]);
});

test("conversation evidence collection is bounded and reports unreadable rollouts without dropping valid ones", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-evidence-collect-"));
  const first = path.join(root, "first.jsonl");
  const second = path.join(root, "second.jsonl");
  fs.writeFileSync(first, [
    line("turn_context", { turn_id: "turn-1" }, "2026-09-27T00:00:00.000Z"),
    line("response_item", { type: "message", id: "user-1", role: "user", content: [{ type: "input_text", text: "必须先测试。" }] }, "2026-09-27T00:00:01.000Z"),
  ].join("\n"), "utf8");
  fs.writeFileSync(second, [
    line("turn_context", { turn_id: "turn-2" }, "2026-09-27T00:00:00.000Z"),
    line("response_item", { type: "message", id: "user-2", role: "user", content: [{ type: "input_text", text: "必须发截图。" }] }, "2026-09-27T00:00:01.000Z"),
  ].join("\n"), "utf8");
  try {
    const result = await collectConversationEvidence([
      { id: "thread-1", path: first },
      { id: "missing", path: path.join(root, "missing.jsonl") },
      { id: "thread-2", path: second },
    ], { maxThreads: 2 });
    assert.equal(result.indexes.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].threadId, "missing");
    assert.equal(result.packet.userEvidence[0].threadId, "thread-1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
