const { beginOperation, completeOperation } = require("./guide-state.cjs");

function createGuideActionExecutor({ state, persist, handlers = {} }) {
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
      if (typeof handler !== "function") throw new Error(`Guide action is not registered: ${operation.actionId}`);
      // The ledger write is intentionally before the first side effect.
      save(state);
      const pending = (async () => {
        try {
          const result = await handler(input.payload || {}, operation);
          completeOperation(state, operation.operationId, { status: "completed", result });
          save(state);
          return { status: "completed", result, reused: false };
        } catch (error) {
          completeOperation(state, operation.operationId, { status: "failed", errorCode: String(error?.code || "ACTION_FAILED"), error: String(error?.message || error).slice(0, 1000) });
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

module.exports = { createGuideActionExecutor };
