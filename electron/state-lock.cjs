const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_STALE_MS = 30000;
const RETRY_MS = 15;

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, Math.max(1, milliseconds));
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwner(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function acquireStateLock(lockPath, { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS } = {}) {
  const resolved = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const token = `${process.pid}-${randomUUID()}`;
  const startedAt = Date.now();
  while (true) {
    let fd;
    try {
      fd = fs.openSync(resolved, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, startedAt }), "utf8");
      return { path: resolved, fd, token };
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {}
      }
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const stat = fs.statSync(resolved);
        const owner = readOwner(resolved);
        stale = Date.now() - stat.mtimeMs >= staleMs && owner.pid && Number(owner.pid) !== process.pid && !processIsAlive(owner.pid);
      } catch {
        // The owner may have released the lock between open/stat; retry.
      }
      if (stale) {
        try { fs.unlinkSync(resolved); } catch {}
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const timeout = new Error(`Harness state lock timeout: ${resolved}`);
        timeout.code = "STATE_LOCK_TIMEOUT";
        throw timeout;
      }
      sleepSync(RETRY_MS);
    }
  }
}

function releaseStateLock(lock) {
  if (!lock?.path) return;
  try { fs.closeSync(lock.fd); } catch {}
  try {
    const owner = readOwner(lock.path);
    if (owner.token === lock.token) fs.unlinkSync(lock.path);
  } catch {}
}

module.exports = { acquireStateLock, releaseStateLock, processIsAlive, DEFAULT_TIMEOUT_MS, DEFAULT_STALE_MS };
