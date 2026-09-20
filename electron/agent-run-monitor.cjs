const machine = require("./state-machine.cjs");
const { parseHarnessImport } = require("./codex-import.cjs");

const RESULT_BLOCK = /```harness-result\s*([\s\S]*?)```/gi;
const ORDINARY_OUTPUT_MAX_CHARS = 50_000;
// Import candidates can legitimately contain a bounded inventory of hundreds
// of tasks/checkpoints. Keep their JSON envelope intact while retaining a
// finite process-memory ceiling distinct from ordinary task output.
const IMPORT_OUTPUT_MAX_CHARS = 1024 * 1024;

function normalizeCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = String(value.summary || "").trim();
  if (!summary) return null;
  const list = (input) => Array.isArray(input)
    ? input.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const acceptance = Array.isArray(value.acceptance)
    ? value.acceptance
      .filter((item) => item && typeof item === "object")
      .map((item) => ({ criterion: String(item.criterion || "").trim(), status: String(item.status || "pending").trim() || "pending" }))
      .filter((item) => item.criterion)
    : [];
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
      .filter((item) => item && typeof item === "object")
      .map((item) => ({ type: String(item.type || "note").trim() || "note", value: String(item.value || "").trim() }))
      .filter((item) => item.value)
    : [];
  return {
    summary,
    completed: list(value.completed),
    remaining: list(value.remaining),
    nextStep: String(value.nextStep || "").trim(),
    acceptance,
    evidence,
  };
}

function parseHarnessResult(text) {
  const source = String(text || "");
  RESULT_BLOCK.lastIndex = 0;
  let match;
  while ((match = RESULT_BLOCK.exec(source))) {
    try {
      const parsed = normalizeCandidate(JSON.parse(match[1].trim()));
      if (parsed) return parsed;
    } catch {
      // Keep scanning: an agent may have emitted an incomplete block before the final one.
    }
  }
  return null;
}

function collectText(value, depth = 0, seen = new Set(), maxStringChars = 12000) {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return value.length > 1 ? [value.slice(0, maxStringChars)] : [];
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const values = [];
  for (const [key, child] of Object.entries(value)) {
    if (["text", "delta", "message", "content", "output", "summary", "detail"].includes(key)) {
      values.push(...collectText(child, depth + 1, seen, maxStringChars));
    } else if (depth < 2 && ["item", "turn", "result", "error"].includes(key)) {
      values.push(...collectText(child, depth + 1, seen, maxStringChars));
    }
  }
  return values;
}

function eventForNotification(message) {
  const method = String(message?.method || "agent/event");
  const params = message?.params || {};
  const item = params.item || {};
  const itemType = String(item.type || item.itemType || "").toLowerCase();
  const turn = params.turn || {};
  const status = String(turn.status || params.status || "").toLowerCase();
  const text = collectText(params).join("\n");
  if (method === "turn/completed") {
    if (["failed", "error", "cancelled", "canceled", "interrupted"].includes(status) || turn.error || params.error) {
      return { kind: "failed", type: method, detail: text || turn.error?.message || params.error?.message || "Agent 任务失败" };
    }
    return { kind: "completed", type: method, progress: 100, phase: "completed", detail: text || "Agent 任务已结束" };
  }
  if (method === "error" || method === "turn/failed") {
    return { kind: "failed", type: method, detail: text || params.error?.message || "Agent 运行失败" };
  }
  if (method === "turn/started") return { kind: "progress", type: method, progress: 12, phase: "thinking", detail: text || "Agent 已开始" };
  if (method === "turn/updated") {
    const rawProgress = Number(params.progress ?? turn.progress ?? turn.percentage);
    const progress = Number.isFinite(rawProgress) ? (rawProgress > 0 && rawProgress <= 1 ? rawProgress * 100 : rawProgress) : 45;
    return { kind: "progress", type: method, progress, phase: "working", detail: text || "Agent 正在工作" };
  }
  if (method.startsWith("item/")) {
    const complete = method.endsWith("completed");
    const phase = itemType.includes("command") ? "executing_command"
      : itemType.includes("file") ? "updating_files"
        : itemType.includes("message") ? "reporting"
          : "working";
    return { kind: "progress", type: method, progress: complete ? 78 : 35, phase, detail: text || `${itemType || "Agent"} ${complete ? "已完成" : "已开始"}` };
  }
  return { kind: "progress", type: method, progress: 40, phase: "working", detail: text || method };
}

function createAgentRunMonitor({ state, projectId, taskId, readGit = async () => undefined, onUpdate = () => {}, onRawMessage = () => {}, autoReview = false, importMode = false, onImportCandidate = () => {} }) {
  let output = "";
  let terminal = false;
  let candidateSubmitted = false;
  const outputMaxChars = importMode ? IMPORT_OUTPUT_MAX_CHARS : ORDINARY_OUTPUT_MAX_CHARS;
  const project = machine.getProject(state, projectId);
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found");

  async function publish(event) {
    if (["completed", "failed"].includes(event?.kind)) {
      const immediate = { project: machine.getProject(state, projectId), task: machine.getProject(state, projectId).tasks.find((item) => item.id === taskId), event, git: project.gitSnapshot };
      await onUpdate(immediate);
      void readGit(project.path).then(async (git) => {
        if (!git) return;
        machine.recordGitSnapshot(state, projectId, git);
        await onUpdate({ project: machine.getProject(state, projectId), task: machine.getProject(state, projectId).tasks.find((item) => item.id === taskId), event: { ...event, type: `${event.type || "agent/terminal"}:git-refreshed` }, git });
      }).catch(() => undefined);
      return immediate;
    }
    const git = await readGit(project.path).catch(() => undefined);
    if (git) machine.recordGitSnapshot(state, projectId, git);
    const update = { project: machine.getProject(state, projectId), task: machine.getProject(state, projectId).tasks.find((item) => item.id === taskId), event, git };
    await onUpdate(update);
    return update;
  }

  async function handleNotification(message) {
    try { await onRawMessage(message); } catch { /* raw archival is best effort; state updates must continue */ }
    const params = message?.params || {};
    const threadId = params.threadId || params.thread?.id;
    const turnId = params.turnId || params.turn?.id;
    if (threadId && task.run?.externalThreadId && String(threadId) !== String(task.run.externalThreadId)) return null;
    if (turnId && task.run?.externalTurnId && String(turnId) !== String(task.run.externalTurnId)) return null;
    const event = eventForNotification(message);
    const text = collectText(params, 0, new Set(), importMode ? IMPORT_OUTPUT_MAX_CHARS : 12000).join("\n");
    if (text) output = `${output}\n${text}`.slice(-outputMaxChars);
    machine.recordAgentEvent(state, projectId, taskId, event);
    const candidate = importMode ? (() => { try { return parseHarnessImport(output); } catch { return null; } })() : parseHarnessResult(output);
    if (importMode && candidate && !candidateSubmitted && ["in_progress", "awaiting_result"].includes(task.status)) {
      await onImportCandidate(candidate, { projectId, taskId, threadId, turnId });
      candidateSubmitted = true;
    } else if (candidate && !candidateSubmitted && ["in_progress", "awaiting_result"].includes(task.status)) {
      machine.submitTaskResult(state, projectId, taskId, { ...candidate, source: "agent-auto" });
      candidateSubmitted = true;
      if (autoReview) machine.autoReviewTaskResult(state, projectId, taskId);
    }
    if (event.kind === "failed") {
      machine.markRunFailed(state, projectId, taskId, event.detail);
      terminal = true;
    } else if (event.kind === "completed") {
      machine.markRunCompleted(state, projectId, taskId, event.detail);
      terminal = true;
    }
    return publish(event);
  }

  async function refresh() {
    return publish({ type: "git/refresh", kind: "refresh", phase: task.run?.phase || "working", progress: task.run?.progress });
  }

  return {
    handleNotification,
    refresh,
    isTerminal: () => terminal,
    getOutput: () => output,
  };
}

module.exports = { ORDINARY_OUTPUT_MAX_CHARS, IMPORT_OUTPUT_MAX_CHARS, parseHarnessResult, normalizeCandidate, collectText, eventForNotification, createAgentRunMonitor };
