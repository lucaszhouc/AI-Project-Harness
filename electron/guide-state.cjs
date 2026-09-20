const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const GUIDE_SCHEMA_VERSION = 1;
const GUIDE_STEP_IDS = Object.freeze(["welcome", "codex", "project", "task", "review", "restart"]);
const GUIDE_STEP_STATUSES = new Set(["idle", "guiding", "waiting_user", "running", "verifying", "blocked", "completed", "dismissed"]);

function nowIso() { return new Date().toISOString(); }

function createGuideState(input = {}) {
  const createdAt = input.createdAt || nowIso();
  return {
    schemaVersion: GUIDE_SCHEMA_VERSION,
    copyVersion: 1,
    sessionId: input.sessionId || randomUUID(),
    locale: input.locale === "en" ? "en" : "zh-CN",
    dismissed: Boolean(input.dismissed),
    sequence: Math.max(0, Number(input.sequence) || 0),
    activeProjectId: input.activeProjectId,
    steps: Object.fromEntries(GUIDE_STEP_IDS.map((id) => [id, { id, status: "idle", updatedAt: createdAt }])),
    probes: {},
    operations: {},
    completionEvidence: [],
    diagnostics: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeGuideState(value) {
  const state = value && typeof value === "object" ? value : createGuideState();
  const normalized = createGuideState({
    sessionId: typeof state.sessionId === "string" ? state.sessionId : undefined,
    locale: state.locale,
    dismissed: state.dismissed,
    sequence: state.sequence,
    activeProjectId: state.activeProjectId,
    createdAt: state.createdAt,
  });
  normalized.steps = Object.fromEntries(GUIDE_STEP_IDS.map((id) => {
    const source = state.steps?.[id] || {};
    return [id, { id, status: GUIDE_STEP_STATUSES.has(source.status) ? source.status : "idle", updatedAt: source.updatedAt || normalized.createdAt, ...source }];
  }));
  normalized.probes = state.probes && typeof state.probes === "object" ? state.probes : {};
  normalized.operations = state.operations && typeof state.operations === "object" ? state.operations : {};
  normalized.completionEvidence = Array.isArray(state.completionEvidence) ? state.completionEvidence.slice(-200) : [];
  normalized.diagnostics = Array.isArray(state.diagnostics) ? state.diagnostics.slice(-200) : [];
  normalized.updatedAt = state.updatedAt || normalized.createdAt;
  return normalized;
}

function advanceGuideSequence(state, incoming) {
  const sequence = Number(incoming);
  if (!Number.isFinite(sequence) || sequence <= Number(state.sequence || 0)) {
    state.diagnostics ||= [];
    state.diagnostics.push({ code: "STALE_SEQUENCE", incoming: sequence, current: Number(state.sequence || 0), at: nowIso() });
    state.diagnostics = state.diagnostics.slice(-200);
    return false;
  }
  state.sequence = sequence;
  state.updatedAt = nowIso();
  return true;
}

function beginOperation(state, input = {}) {
  const operationId = String(input.operationId || "").trim();
  const actionId = String(input.actionId || "").trim();
  const targetFingerprint = String(input.targetFingerprint || "").trim();
  if (!operationId || !actionId || !targetFingerprint) throw new Error("operationId, actionId and targetFingerprint are required");
  state.operations ||= {};
  const existing = state.operations[operationId];
  if (existing) {
    if (existing.actionId !== actionId || existing.targetFingerprint !== targetFingerprint) throw new Error("Operation fingerprint mismatch");
    return { ...existing, reused: true };
  }
  const operation = {
    operationId,
    actionId,
    targetFingerprint,
    confirmedAt: input.confirmedAt || nowIso(),
    status: "running",
    relatedIds: input.relatedIds || {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.operations[operationId] = operation;
  state.updatedAt = operation.updatedAt;
  return operation;
}

function completeOperation(state, operationId, output = {}) {
  const operation = state.operations?.[operationId];
  if (!operation) throw new Error("Operation not found");
  operation.status = ["completed", "failed", "unknown", "cancelled"].includes(output.status) ? output.status : "completed";
  operation.result = output.result;
  operation.errorCode = output.errorCode;
  operation.error = output.error;
  operation.relatedIds = { ...(operation.relatedIds || {}), ...(output.relatedIds || {}) };
  operation.updatedAt = nowIso();
  state.updatedAt = operation.updatedAt;
  return operation;
}

function recoverOperation(state, operationId) { return state.operations?.[operationId]; }

class GuideStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      const state = createGuideState();
      this.write(state);
      return state;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed.schemaVersion !== GUIDE_SCHEMA_VERSION) throw new Error("Unsupported guide schema");
      return normalizeGuideState(parsed);
    } catch {
      try { fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`); } catch {}
      const state = createGuideState();
      this.write(state);
      return state;
    }
  }

  write(next = this.state) {
    const normalized = normalizeGuideState(next);
    normalized.updatedAt = nowIso();
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, this.filePath);
    if (this.state && typeof this.state === "object") {
      for (const key of Object.keys(this.state)) delete this.state[key];
      Object.assign(this.state, normalized);
    } else this.state = normalized;
    return this.state;
  }

  update(mutator) {
    const result = mutator(this.state);
    this.write(this.state);
    return result;
  }
}

module.exports = {
  GUIDE_SCHEMA_VERSION,
  GUIDE_STEP_IDS,
  createGuideState,
  normalizeGuideState,
  advanceGuideSequence,
  beginOperation,
  completeOperation,
  recoverOperation,
  GuideStateStore,
};
