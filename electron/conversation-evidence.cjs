const fs = require("node:fs");
const readline = require("node:readline");
const { createHash } = require("node:crypto");

const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

function clip(value, max = 12000) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function redact(value, max = 4000) {
  return clip(value, max).replace(SECRET_PATTERN, "[已脱敏]");
}

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u0000")).digest("hex").slice(0, 24)}`;
}

function messageText(content) {
  return (Array.isArray(content) ? content : [])
    .filter((item) => item && ["input_text", "output_text", "text"].includes(String(item.type || "")))
    .map((item) => String(item.text ?? item.value ?? ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function ensureEpisode(map, order, turnId) {
  const key = String(turnId || "unbound");
  if (!map.has(key)) {
    const episode = { id: stableId("episode", key), turnId: key, userEvidenceIds: [], agentEvidenceIds: [], actionEvidenceIds: [] };
    map.set(key, episode);
    order.push(episode);
  }
  return map.get(key);
}

async function extractConversationEvidence(filePath, { threadId = "", maxMessages = 2000, maxActions = 1000, fileSystem = fs } = {}) {
  if (!filePath || !fileSystem.existsSync(filePath)) throw new Error(`CONVERSATION_EVIDENCE_MISSING: ${filePath || "unknown"}`);
  const messages = [];
  const actions = [];
  const actionsByCall = new Map();
  const episodesByTurn = new Map();
  const episodes = [];
  let currentTurnId = "unbound";
  let lineNumber = 0;
  const stream = fileSystem.createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    lineNumber += 1;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload;
    if (row?.type === "session_meta" && !threadId) threadId = String(payload?.id || payload?.session_id || "");
    if (row?.type === "turn_context") {
      currentTurnId = String(payload?.turn_id || payload?.root_turn_id || currentTurnId || "unbound");
      ensureEpisode(episodesByTurn, episodes, currentTurnId);
      continue;
    }
    if (row?.type !== "response_item" || !payload || typeof payload !== "object") continue;
    if (payload.type === "message" && ["user", "assistant"].includes(String(payload.role)) && messages.length < maxMessages) {
      const quote = messageText(payload.content);
      if (!quote) continue;
      const role = String(payload.role);
      const id = stableId("evidence", threadId, currentTurnId, payload.id || lineNumber, role, quote);
      const evidence = { id, role, threadId: String(threadId || ""), turnId: currentTurnId, messageId: String(payload.id || ""), at: row.timestamp, line: lineNumber, quote: clip(quote) };
      messages.push(evidence);
      const episode = ensureEpisode(episodesByTurn, episodes, currentTurnId);
      (role === "user" ? episode.userEvidenceIds : episode.agentEvidenceIds).push(id);
      continue;
    }
    if (["custom_tool_call", "function_call"].includes(String(payload.type)) && actions.length < maxActions) {
      const callId = String(payload.call_id || payload.id || `${currentTurnId}:${lineNumber}`);
      const name = String(payload.name || "tool");
      const input = clip(payload.input ?? payload.arguments ?? "", 6000);
      const action = { id: stableId("action", threadId, currentTurnId, callId, name, input), threadId: String(threadId || ""), turnId: currentTurnId, callId, at: row.timestamp, line: lineNumber, name, input, result: "" };
      actions.push(action);
      actionsByCall.set(callId, action);
      ensureEpisode(episodesByTurn, episodes, currentTurnId).actionEvidenceIds.push(action.id);
      continue;
    }
    if (["custom_tool_call_output", "function_call_output"].includes(String(payload.type))) {
      const action = actionsByCall.get(String(payload.call_id || ""));
      if (action) action.result = clip(payload.output ?? payload.result ?? "", 6000);
    }
  }
  return { version: 1, threadId: String(threadId || ""), sourcePath: String(filePath), messages, actions, episodes: episodes.filter((episode) => episode.userEvidenceIds.length || episode.agentEvidenceIds.length || episode.actionEvidenceIds.length) };
}

function userSignalScore(item) {
  const text = String(item?.quote || "");
  const patterns = [
    /不是|不对|纠正|问题是|但是|而是/g,
    /必须|一定|不要|不能|别|禁止|只要|只需要|以后|每次|永远|从来/g,
    /因为|所以|原因|为什么|目的|核心/g,
    /验收|测试|截图|版本|流程|工作流|SOP|回滚|恢复|交付/g,
    /\b(?:must|never|always|do not|don't|because|workflow|rollback|accept|reject)\b/gi,
  ];
  return patterns.reduce((score, pattern, index) => score + (text.match(pattern)?.length || 0) * (patterns.length - index + 1), 0)
    + Math.min(4, Math.floor(text.length / 120));
}

function buildKnowledgeEvidencePacket(indexes, { maxUserMessages = 60, maxAgentMessages = 40, maxActions = 40 } = {}) {
  const allMessages = (Array.isArray(indexes) ? indexes : []).flatMap((index) => (index.messages || []).map((item) => ({ ...item, threadId: item.threadId || index.threadId })));
  const selectedUsers = allMessages.filter((item) => item.role === "user")
    .sort((left, right) => userSignalScore(right) - userSignalScore(left) || Date.parse(String(right.at || 0)) - Date.parse(String(left.at || 0)))
    .slice(0, Math.max(1, Number(maxUserMessages) || 60));
  const selectedTurnIds = new Set(selectedUsers.map((item) => `${item.threadId}:${item.turnId}`));
  const agentEvidence = allMessages.filter((item) => item.role === "assistant" && selectedTurnIds.has(`${item.threadId}:${item.turnId}`)).slice(0, Math.max(0, Number(maxAgentMessages) || 40));
  const actions = (Array.isArray(indexes) ? indexes : []).flatMap((index) => (index.actions || []).map((item) => ({ ...item, threadId: item.threadId || index.threadId })))
    .filter((item) => selectedTurnIds.has(`${item.threadId}:${item.turnId}`)).slice(0, Math.max(0, Number(maxActions) || 40));
  const selectedIds = new Set([...selectedUsers, ...agentEvidence].map((item) => item.id));
  const actionIds = new Set(actions.map((item) => item.id));
  const episodes = (Array.isArray(indexes) ? indexes : []).flatMap((index) => (index.episodes || []).map((episode) => ({
    ...episode,
    threadId: index.threadId,
    userEvidenceIds: (episode.userEvidenceIds || []).filter((id) => selectedIds.has(id)),
    agentEvidenceIds: (episode.agentEvidenceIds || []).filter((id) => selectedIds.has(id)),
    actionEvidenceIds: (episode.actionEvidenceIds || []).filter((id) => actionIds.has(id)),
  }))).filter((episode) => episode.userEvidenceIds.length);
  const publicMessage = (item) => ({ id: item.id, role: item.role, threadId: item.threadId, turnId: item.turnId, at: item.at, quote: redact(item.quote) });
  return {
    version: 1,
    userEvidence: selectedUsers.map(publicMessage),
    agentEvidence: agentEvidence.map(publicMessage),
    actions: actions.map((item) => ({ id: item.id, threadId: item.threadId, turnId: item.turnId, at: item.at, name: redact(item.name, 160), input: redact(item.input, 1200), result: redact(item.result, 1200) })),
    episodes,
  };
}

async function collectConversationEvidence(threads, { maxThreads = 20, packetOptions = {}, onError = () => {} } = {}) {
  const indexes = [];
  const failures = [];
  const bounded = (Array.isArray(threads) ? threads : []).slice(0, Math.max(1, Math.min(100, Number(maxThreads) || 20)));
  for (const thread of bounded) {
    try {
      indexes.push(await extractConversationEvidence(thread?.path, { threadId: thread?.id }));
    } catch (error) {
      const failure = { threadId: String(thread?.id || ""), error: redact(error instanceof Error ? error.message : error, 500) };
      failures.push(failure);
      try { onError(error, thread); } catch {}
    }
  }
  return { indexes, failures, packet: buildKnowledgeEvidencePacket(indexes, packetOptions) };
}

module.exports = { buildKnowledgeEvidencePacket, collectConversationEvidence, extractConversationEvidence, redact, stableId, userSignalScore };
