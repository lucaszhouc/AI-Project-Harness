const { randomUUID } = require("node:crypto");

const PROBE_STATUSES = Object.freeze(["unknown", "checking", "ok", "missing", "unauth", "unsupported", "error", "stale"]);
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function safeErrorCode(error) {
  const code = String(error?.code || "PROBE_ERROR").replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80);
  return code || "PROBE_ERROR";
}

function normalizeProbeError(subject, error, checkedAt = new Date()) {
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
    const at = checkedAt.toISOString();
    return { id: randomUUID(), subject, status: "unknown", checkedAt: at, safeSummary: `${subject} check was cancelled`, errorCode: "PROBE_CANCELLED", remediationActionIds: ["probe.recheck"] };
  }
  const missing = ["ENOENT", "COMMAND_NOT_FOUND"].includes(String(error?.code || "").toUpperCase());
  const unsupported = /unsupported|unknown (?:method|variant)|not implemented/i.test(String(error?.message || error || ""));
  const status = missing ? "missing" : unsupported ? "unsupported" : "error";
  const at = checkedAt.toISOString();
  return {
    id: randomUUID(), subject, status, checkedAt: at,
    expiresAt: new Date(checkedAt.getTime() + DEFAULT_TTL_MS).toISOString(),
    safeSummary: status === "missing" ? `${subject} was not found` : status === "unsupported" ? `${subject} is unsupported by this version` : `${subject} check failed`,
    errorCode: safeErrorCode(error), remediationActionIds: ["probe.recheck"],
  };
}

function isProbeStale(probe, at = new Date(), environmentFingerprint) {
  if (!probe || probe.status === "unknown" || probe.status === "checking") return false;
  if (environmentFingerprint && probe.environmentFingerprint && environmentFingerprint !== probe.environmentFingerprint) return true;
  const expiresAt = Date.parse(String(probe.expiresAt || ""));
  return Number.isFinite(expiresAt) && at.getTime() >= expiresAt;
}

function createProbeRunner({ detectors = {}, now = () => new Date(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const inFlight = new Map();
  const controllers = new Map();
  const cache = new Map();
  return {
    get(subject, environmentFingerprint) {
      const probe = cache.get(subject);
      return isProbeStale(probe, now(), environmentFingerprint) ? { ...probe, status: "stale" } : probe;
    },
    run(subject, options = {}) {
      if (inFlight.has(subject)) return inFlight.get(subject);
      const detector = detectors[subject];
      if (typeof detector !== "function") {
        return Promise.resolve({ id: randomUUID(), subject, status: "unsupported", checkedAt: now().toISOString(), safeSummary: `${subject} probe is unavailable`, remediationActionIds: [] });
      }
      const controller = new AbortController();
      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      controllers.set(subject, controller);
      const promise = (async () => {
        const startedAt = now();
        try {
          const detected = await detector({ signal: controller.signal });
          const checkedAt = now();
          const status = PROBE_STATUSES.includes(detected?.status) ? detected.status : "error";
          const probe = {
            id: randomUUID(), subject, ...detected, status,
            checkedAt: checkedAt.toISOString(),
            expiresAt: detected?.expiresAt || new Date(checkedAt.getTime() + ttlMs).toISOString(),
            safeSummary: String(detected?.safeSummary || `${subject}: ${status}`).slice(0, 500),
            remediationActionIds: Array.isArray(detected?.remediationActionIds) ? detected.remediationActionIds.slice(0, 10) : ["probe.recheck"],
            environmentFingerprint: options.environmentFingerprint,
            durationMs: Math.max(0, checkedAt.getTime() - startedAt.getTime()),
          };
          cache.set(subject, probe);
          return probe;
        } catch (error) {
          const probe = normalizeProbeError(subject, error, now());
          cache.set(subject, probe);
          return probe;
        } finally {
          inFlight.delete(subject);
          controllers.delete(subject);
        }
      })();
      inFlight.set(subject, promise);
      return promise;
    },
    cancel(subject) {
      // Cancellation is intentionally limited to the detector's own signal;
      // it never knows about Task runs and therefore cannot stop one.
      const controller = controllers.get(subject);
      if (controller) controller.abort();
      return { subject, cancelled: Boolean(controller) };
    },
  };
}

module.exports = { PROBE_STATUSES, DEFAULT_TTL_MS, normalizeProbeError, isProbeStale, createProbeRunner };
