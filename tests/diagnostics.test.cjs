const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { createErrorLog } = require("../electron/error-log.cjs");
const { createDiagnostics, installProcessErrorLogging } = require("../electron/diagnostics.cjs");

test("diagnostics creates and reveals the persistent error log", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-diagnostics-"));
  const filePath = path.join(root, "logs", "harness-errors.jsonl");
  try {
    const revealed = [];
    const diagnostics = createDiagnostics({
      errorLog: createErrorLog({ filePath }),
      showItemInFolder: (target) => revealed.push(target),
    });

    const result = diagnostics.showErrorLog();

    assert.equal(fs.existsSync(filePath), true);
    assert.deepEqual(revealed, [filePath]);
    assert.deepEqual(result, { opened: true, path: filePath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostics records renderer failures without accepting arbitrary context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-diagnostics-"));
  const filePath = path.join(root, "logs", "harness-errors.jsonl");
  try {
    const diagnostics = createDiagnostics({
      errorLog: createErrorLog({
        filePath,
        now: () => new Date("2026-09-02T05:00:00.000Z"),
        randomId: () => "render",
      }),
      showItemInFolder: () => {},
    });

    const result = diagnostics.reportRendererError({
      message: "render failed",
      stack: "Error: render failed\n  at renderer:1:1",
      stage: "boot",
      arbitrarySecret: "must not persist",
    });
    const record = JSON.parse(fs.readFileSync(filePath, "utf8").trim());

    assert.equal(result.errorId, "APH-20260902-050000-render");
    assert.equal(record.operation, "renderer");
    assert.equal(record.stage, "boot");
    assert.equal(record.message, "render failed");
    assert.match(record.stack, /renderer:1:1/);
    assert.equal(record.context, undefined);
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /must not persist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostics captures uncaught main-process errors and unhandled rejections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-diagnostics-"));
  const filePath = path.join(root, "logs", "harness-errors.jsonl");
  try {
    const processRef = new EventEmitter();
    const errorLog = createErrorLog({ filePath, randomId: () => "global" });
    installProcessErrorLogging({ processRef, errorLog });

    processRef.emit("uncaughtExceptionMonitor", new Error("main exploded"), "uncaughtException");
    processRef.emit("unhandledRejection", new Error("promise exploded"));

    const records = fs.readFileSync(filePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(records.map((record) => record.operation), ["main-process", "main-process"]);
    assert.deepEqual(records.map((record) => record.stage), ["uncaughtException", "unhandledRejection"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("process error hooks do not recursively crash when the log cannot be written", () => {
  const processRef = new EventEmitter();
  installProcessErrorLogging({ processRef, errorLog: { capture: () => { throw new Error("disk full"); } } });

  assert.doesNotThrow(() => processRef.emit("uncaughtExceptionMonitor", new Error("main exploded"), "uncaughtException"));
  assert.doesNotThrow(() => processRef.emit("unhandledRejection", { circular: true }));
});
