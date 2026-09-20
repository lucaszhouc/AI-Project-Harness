const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { inspect } = require("node:util");

function formatErrorId(date, suffix) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `APH-${stamp}-${suffix}`;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      message: String(error.message || error.name || "Unknown error").slice(0, 4000),
      stack: String(error.stack || `${error.name}: ${error.message}`).slice(0, 20000),
    };
  }
  const message = typeof error === "string"
    ? error
    : error && typeof error.message === "string"
      ? error.message
      : inspect(error, { depth: 3, breakLength: Infinity });
  return {
    message: String(message || "Unknown error").slice(0, 4000),
    stack: String(error?.stack || message || "Unknown error").slice(0, 20000),
  };
}

function createErrorLog({
  filePath,
  appVersion = "unknown",
  platform = process.platform,
  maxBytes = 1024 * 1024,
  maxArchives = 3,
  now = () => new Date(),
  randomId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 6),
} = {}) {
  if (!filePath) throw new Error("error log filePath is required");

  function ensureFile() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf8");
    return filePath;
  }

  function rotateIfNeeded(incomingBytes) {
    ensureFile();
    const currentBytes = fs.statSync(filePath).size;
    if (currentBytes === 0 || currentBytes + incomingBytes <= maxBytes) return;

    for (let index = maxArchives; index >= 1; index -= 1) {
      const archived = `${filePath}.${index}`;
      if (!fs.existsSync(archived)) continue;
      if (index === maxArchives) fs.unlinkSync(archived);
      else fs.renameSync(archived, `${filePath}.${index + 1}`);
    }
    fs.renameSync(filePath, `${filePath}.1`);
  }

  function capture(error, { operation = "unknown", stage = "unknown", context } = {}) {
    const occurredAt = now();
    const normalized = normalizeError(error);
    const record = {
      at: occurredAt.toISOString(),
      id: formatErrorId(occurredAt, randomId()),
      operation,
      stage,
      message: normalized.message,
      stack: normalized.stack,
      appVersion,
      platform,
      ...(context && Object.keys(context).length ? { context } : {}),
    };
    const line = `${JSON.stringify(record)}\n`;
    rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(filePath, line, "utf8");
    return record;
  }

  return { filePath, ensureFile, capture };
}

module.exports = { createErrorLog, formatErrorId, normalizeError };
