const { createHash } = require("node:crypto");

const SCOPES = new Set(["task", "project", "domain", "global"]);
const RULE_KINDS = new Set(["must", "must_not", "prefer", "exception"]);

function clip(value, max = 2000) {
  const text = String(value ?? "").replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function idFor(prefix, value) {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function evidenceMap(evidence) {
  const rows = [
    ...(Array.isArray(evidence?.userEvidence) ? evidence.userEvidence : []),
    ...(Array.isArray(evidence?.agentEvidence) ? evidence.agentEvidence : []),
    ...(Array.isArray(evidence?.actions) ? evidence.actions : []),
  ];
  return new Map(rows.map((item) => [String(item.id || ""), item]));
}

function normalizeSources(sources, available, { requireUser = false } = {}) {
  const normalized = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const evidenceId = clip(source?.evidenceId, 120);
    const match = available.get(evidenceId);
    if (!match) throw new Error(`KNOWLEDGE_SOURCE_UNKNOWN: ${evidenceId || "missing"}`);
    const quote = clip(source?.quote, 4000);
    if (quote !== clip(match.quote, 4000)) throw new Error(`KNOWLEDGE_QUOTE_MISMATCH: ${evidenceId}`);
    normalized.push({ evidenceId, quote, threadId: clip(match.threadId, 160), turnId: clip(match.turnId, 160), role: match.role || (match.name ? "action" : "unknown") });
  }
  if (!normalized.length) throw new Error("KNOWLEDGE_SOURCE_REQUIRED");
  if (requireUser && !normalized.some((source) => source.role === "user")) throw new Error("KNOWLEDGE_USER_SOURCE_REQUIRED");
  return normalized;
}

function normalizeKnowledgePayload(input = {}, evidence = {}) {
  const available = evidenceMap(evidence);
  const rules = (Array.isArray(input.rules) ? input.rules : []).slice(0, 100).map((rule) => {
    const value = {
      title: clip(rule?.title, 240),
      scope: SCOPES.has(String(rule?.scope)) ? String(rule.scope) : "project",
      kind: RULE_KINDS.has(String(rule?.kind)) ? String(rule.kind) : "prefer",
      statement: clip(rule?.statement, 1600),
      rationale: clip(rule?.rationale, 2000) || undefined,
      trigger: clip(rule?.trigger, 1000) || undefined,
      exceptions: (Array.isArray(rule?.exceptions) ? rule.exceptions : []).slice(0, 20).map((item) => clip(item, 800)).filter(Boolean),
      confidence: ["low", "medium", "high"].includes(String(rule?.confidence)) ? String(rule.confidence) : "medium",
      sources: normalizeSources(rule?.sources, available, { requireUser: true }),
    };
    if (!value.title || !value.statement) throw new Error("KNOWLEDGE_RULE_REQUIRED_FIELDS");
    return { id: idFor("rule", value), type: "rule", status: "pending", ...value };
  });
  const playbooks = (Array.isArray(input.playbooks) ? input.playbooks : []).slice(0, 40).map((playbook) => {
    const steps = (Array.isArray(playbook?.steps) ? playbook.steps : []).slice(0, 40).map((step, index) => ({
      order: index + 1,
      action: clip(step?.action, 1600),
      validation: clip(step?.validation, 1200) || undefined,
      failure: clip(step?.failure, 1200) || undefined,
      sources: normalizeSources(step?.sources, available, { requireUser: false }),
    })).filter((step) => step.action);
    const sources = steps.flatMap((step) => step.sources);
    if (!sources.some((source) => source.role === "user")) throw new Error("KNOWLEDGE_USER_SOURCE_REQUIRED");
    const value = {
      title: clip(playbook?.title, 240),
      scope: SCOPES.has(String(playbook?.scope)) ? String(playbook.scope) : "project",
      trigger: clip(playbook?.trigger, 1200),
      purpose: clip(playbook?.purpose, 2000),
      prerequisites: (Array.isArray(playbook?.prerequisites) ? playbook.prerequisites : []).slice(0, 20).map((item) => clip(item, 800)).filter(Boolean),
      prohibitions: (Array.isArray(playbook?.prohibitions) ? playbook.prohibitions : []).slice(0, 20).map((item) => clip(item, 800)).filter(Boolean),
      exceptions: (Array.isArray(playbook?.exceptions) ? playbook.exceptions : []).slice(0, 20).map((item) => clip(item, 800)).filter(Boolean),
      steps,
      confidence: ["low", "medium", "high"].includes(String(playbook?.confidence)) ? String(playbook.confidence) : "medium",
    };
    if (!value.title || !value.trigger || !value.purpose || !steps.length) throw new Error("KNOWLEDGE_PLAYBOOK_REQUIRED_FIELDS");
    return { id: idFor("playbook", value), type: "playbook", status: "pending", version: 1, ...value };
  });
  return { version: 1, rules, playbooks, notes: (Array.isArray(input.notes) ? input.notes : []).slice(0, 40).map((item) => clip(item, 1000)).filter(Boolean) };
}

module.exports = { normalizeKnowledgePayload };
