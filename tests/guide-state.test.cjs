const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  GUIDE_SCHEMA_VERSION,
  createGuideState,
  advanceGuideSequence,
  beginOperation,
  completeOperation,
  recoverOperation,
  GuideStateStore,
} = require("../electron/guide-state.cjs");

test("guide state has a versioned session, probes and durable operation ledger", () => {
  const state = createGuideState({ locale: "zh-CN" });
  assert.equal(state.schemaVersion, GUIDE_SCHEMA_VERSION);
  assert.equal(state.locale, "zh-CN");
  assert.equal(state.dismissed, false);
  assert.deepEqual(state.probes, {});
  assert.deepEqual(state.operations, {});
  assert.ok(state.sessionId);
});

test("sequence rejects stale events without moving state backward", () => {
  const state = createGuideState();
  assert.equal(advanceGuideSequence(state, 4), true);
  assert.equal(advanceGuideSequence(state, 3), false);
  assert.equal(state.sequence, 4);
  assert.equal(state.diagnostics.at(-1).code, "STALE_SEQUENCE");
});

test("operation id is stable across duplicate clicks, retry and recovery", () => {
  const state = createGuideState();
  const first = beginOperation(state, { actionId: "project.create-blank", operationId: "op-1", targetFingerprint: "blank:alpha", confirmedAt: "2026-09-20T00:00:00.000Z" });
  const duplicate = beginOperation(state, { actionId: "project.create-blank", operationId: "op-1", targetFingerprint: "blank:alpha" });
  assert.equal(first.status, "running");
  assert.equal(duplicate.reused, true);
  assert.equal(Object.keys(state.operations).length, 1);

  completeOperation(state, "op-1", { status: "completed", result: { projectId: "project-1" } });
  assert.deepEqual(recoverOperation(state, "op-1").result, { projectId: "project-1" });
  assert.throws(() => beginOperation(state, { actionId: "project.create-blank", operationId: "op-1", targetFingerprint: "blank:other" }), /fingerprint/i);
});

test("corrupt guide state is backed up and rebuilt unknown, never completed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-guide-state-"));
  const file = path.join(root, "guide-state.json");
  fs.writeFileSync(file, "{broken", "utf8");
  const store = new GuideStateStore(file);
  assert.equal(store.state.schemaVersion, GUIDE_SCHEMA_VERSION);
  assert.equal(store.state.steps.welcome.status, "idle");
  assert.ok(fs.readdirSync(root).some((name) => name.startsWith("guide-state.json.corrupt-")));
});

test("guide store keeps object identity for long-lived action executors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-guide-identity-"));
  const store = new GuideStateStore(path.join(root, "guide-state.json"));
  const reference = store.state;
  store.update((state) => { state.dismissed = true; });
  assert.equal(store.state, reference);
  assert.equal(reference.dismissed, true);
});
