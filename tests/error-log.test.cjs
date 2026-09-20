const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createErrorLog } = require("../electron/error-log.cjs");

test("error log persists a traceable JSONL record with an error id and stack", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-error-log-"));
  const filePath = path.join(root, "logs", "harness-errors.jsonl");
  try {
    const errorLog = createErrorLog({
      filePath,
      appVersion: "0.0.7-test",
      platform: "win32",
      now: () => new Date("2026-09-02T04:00:00.000Z"),
      randomId: () => "abc123",
    });

    const record = errorLog.capture(new Error("fetch failed"), {
      operation: "project:add-by-name",
      stage: "discovering_project",
      context: { queryLength: 10 },
    });
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8").trim());

    assert.equal(record.id, "APH-20260902-040000-abc123");
    assert.equal(persisted.id, record.id);
    assert.equal(persisted.at, "2026-09-02T04:00:00.000Z");
    assert.equal(persisted.operation, "project:add-by-name");
    assert.equal(persisted.stage, "discovering_project");
    assert.equal(persisted.message, "fetch failed");
    assert.match(persisted.stack, /Error: fetch failed/);
    assert.equal(persisted.appVersion, "0.0.7-test");
    assert.equal(persisted.platform, "win32");
    assert.deepEqual(persisted.context, { queryLength: 10 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("error log rotates before it grows past the configured budget", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-error-log-"));
  const filePath = path.join(root, "logs", "harness-errors.jsonl");
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${"x".repeat(220)}\n`, "utf8");
    const errorLog = createErrorLog({
      filePath,
      maxBytes: 256,
      maxArchives: 2,
      now: () => new Date("2026-09-02T04:00:00.000Z"),
      randomId: () => "rotate",
    });

    errorLog.capture(new Error("new failure"), { operation: "test", stage: "write" });

    assert.equal(fs.existsSync(`${filePath}.1`), true);
    assert.match(fs.readFileSync(`${filePath}.1`, "utf8"), /^x+/);
    assert.match(fs.readFileSync(filePath, "utf8"), /new failure/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("error log never crashes while normalizing a circular rejection value", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-error-log-"));
  const filePath = path.join(root, "harness-errors.jsonl");
  try {
    const circular = { reason: "rejected object" };
    circular.self = circular;
    const errorLog = createErrorLog({ filePath });

    assert.doesNotThrow(() => errorLog.capture(circular, { operation: "main-process", stage: "unhandledRejection" }));
    const record = JSON.parse(fs.readFileSync(filePath, "utf8").trim());
    assert.match(record.message, /rejected object|object/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
