const { nowIso } = (() => {
  const nowIso = () => new Date().toISOString();
  return { nowIso };
})();

function beginOperation(state, input = {}) {
  const operationId = String(input.operationId || "").trim();
  const actionId = String(input.actionId || "").trim();
  const targetFingerprint = String(input.targetFingerprint || "").trim();
  if (!operationId || !actionId || !targetFingerprint) {
    throw new Error("operationId, actionId and targetFingerprint are required");
  }
  state.operations ||= {};
  const existing = state.operations[operationId];
  if (existing) {
    if (existing.actionId !== actionId || existing.targetFingerprint !== targetFingerprint) {
      throw new Error("Operation fingerprint mismatch");
    }
    if (input.retry === true && ["failed", "unknown", "cancelled"].includes(existing.status)) {
      existing.status = "running";
      existing.attempt = Number(existing.attempt || 1) + 1;
      existing.updatedAt = nowIso();
      delete existing.result;
      delete existing.error;
      delete existing.errorCode;
      state.updatedAt = existing.updatedAt;
      return { ...existing, reused: true, retried: true };
    }
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
  operation.status = ["completed", "failed", "unknown", "cancelled"].includes(output.status)
    ? output.status
    : "completed";
  operation.result = output.result;
  operation.errorCode = output.errorCode;
  operation.error = output.error;
  operation.relatedIds = { ...(operation.relatedIds || {}), ...(output.relatedIds || {}) };
  operation.updatedAt = nowIso();
  state.updatedAt = operation.updatedAt;
  return operation;
}

function createOperationExecutor({ state, persist, handlers = {} }) {
  const inFlight = new Map();
  const save = typeof persist === "function" ? persist : () => {};
  return {
    async execute(input = {}) {
      const operation = beginOperation(state, input);
      if (operation.status === "completed") return { status: "completed", result: operation.result, reused: true };
      if (inFlight.has(operation.operationId)) {
        const shared = await inFlight.get(operation.operationId);
        return { ...shared, reused: true };
      }
      const handler = handlers[operation.actionId];
      if (typeof handler !== "function") throw new Error(`Operation is not registered: ${operation.actionId}`);
      save(state);
      const pending = (async () => {
        try {
          const result = await handler(input.payload || {}, operation);
          completeOperation(state, operation.operationId, { status: "completed", result });
          save(state);
          return { status: "completed", result, reused: false };
        } catch (error) {
          completeOperation(state, operation.operationId, {
            status: "failed",
            errorCode: String(error?.code || "ACTION_FAILED"),
            error: String(error?.message || error).slice(0, 1000),
          });
          save(state);
          throw error;
        } finally {
          inFlight.delete(operation.operationId);
        }
      })();
      inFlight.set(operation.operationId, pending);
      return pending;
    },
    lookup(operationId) {
      const operation = state.operations?.[operationId];
      return operation ? { ...operation, inFlight: inFlight.has(operationId) } : undefined;
    },
  };
}

module.exports = { beginOperation, completeOperation, createOperationExecutor };
