const test = require("node:test");
const assert = require("node:assert/strict");

const { createProbeRunner, isProbeStale, normalizeProbeError } = require("../electron/guide-probes.cjs");

test("read-only probe deduplicates concurrent checks and never invokes an Agent turn", async () => {
  let calls = 0;
  let turns = 0;
  const runner = createProbeRunner({
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    detectors: {
      "codex-cli": async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { status: "ok", capabilityVersion: "0.154.0", safeSummary: "Codex CLI available" }; },
    },
    startTurn: () => { turns += 1; },
  });
  const [first, second] = await Promise.all([runner.run("codex-cli"), runner.run("codex-cli")]);
  assert.equal(calls, 1);
  assert.equal(turns, 0);
  assert.equal(first.id, second.id);
  assert.equal(first.status, "ok");
});

test("probe errors are not mislabeled missing and expire to stale", () => {
  const probe = normalizeProbeError("codex-cli", Object.assign(new Error("spawn failed"), { code: "EACCES" }), new Date("2026-09-20T00:00:00.000Z"));
  assert.equal(probe.status, "error");
  assert.equal(isProbeStale({ ...probe, expiresAt: "2026-09-20T00:00:01.000Z" }, new Date("2026-09-20T00:00:02.000Z")), true);
});

test("cancel stops only the guide probe and returns unknown without a task stop hook", async () => {
  let taskStops = 0;
  const runner = createProbeRunner({ detectors: {
    "codex-login": ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true })),
  }, stopTask: () => { taskStops += 1; } });
  const pending = runner.run("codex-login");
  const cancelled = runner.cancel("codex-login");
  const result = await pending;
  assert.equal(cancelled.cancelled, true);
  assert.equal(result.status, "unknown");
  assert.equal(result.errorCode, "PROBE_CANCELLED");
  assert.equal(taskStops, 0);
});
