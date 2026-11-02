const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperationExecutor } = require("../electron/operation-ledger.cjs");

test("operation ledger persists before side effects and deduplicates concurrent calls", async () => {
  const state = {};
  const writes = [];
  let calls = 0;
  const executor = createOperationExecutor({
    state,
    persist: () => writes.push(JSON.stringify(state)),
    handlers: {
      "project.create-blank": async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { projectId: "p1" };
      },
    },
  });
  const input = { operationId: "op-1", actionId: "project.create-blank", targetFingerprint: "blank:p1" };
  const [first, second] = await Promise.all([executor.execute(input), executor.execute(input)]);
  assert.equal(calls, 1);
  assert.equal(first.result.projectId, "p1");
  assert.equal(second.result.projectId, "p1");
  assert.equal(state.operations["op-1"].status, "completed");
  assert.ok(writes.length >= 2);
});

test("operation ledger rejects a reused id with a different fingerprint", async () => {
  const state = {};
  const executor = createOperationExecutor({ state, handlers: { noop: async () => ({}) } });
  await executor.execute({ operationId: "op-2", actionId: "noop", targetFingerprint: "a" });
  await assert.rejects(() => executor.execute({ operationId: "op-2", actionId: "noop", targetFingerprint: "b" }), /fingerprint/i);
});

test("operation ledger can explicitly retry a failed operation without changing its target", async () => {
  const state = {};
  let attempts = 0;
  const executor = createOperationExecutor({
    state,
    handlers: { flaky: async () => { attempts += 1; if (attempts === 1) throw new Error("temporary"); return { ok: true }; } },
  });
  await assert.rejects(() => executor.execute({ operationId: "retry-1", actionId: "flaky", targetFingerprint: "same" }), /temporary/);
  const retried = await executor.execute({ operationId: "retry-1", actionId: "flaky", targetFingerprint: "same", retry: true });
  assert.equal(retried.result.ok, true);
  assert.equal(state.operations["retry-1"].attempt, 2);
  assert.equal(state.operations["retry-1"].targetFingerprint, "same");
});
