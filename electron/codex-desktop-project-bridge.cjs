const fs = require("node:fs");
const path = require("node:path");
const LIVE_PROJECT_REMOVAL_UNAVAILABLE = "LIVE_PROJECT_REMOVAL_UNAVAILABLE";
const LIVE_PROJECT_REMOVAL_UNVERIFIED = "LIVE_PROJECT_REMOVAL_UNVERIFIED";
const LIVE_PROJECT_VISIBILITY_UNAVAILABLE = "LIVE_PROJECT_VISIBILITY_UNAVAILABLE";
const LIVE_PROJECT_VISIBILITY_UNVERIFIED = "LIVE_PROJECT_VISIBILITY_UNVERIFIED";

function normalize(value) {
  return path.resolve(String(value || "")).replace(/\\/g, "/").toLowerCase();
}

function readLegacyLocalProjects({ filePath, fileSystem = fs } = {}) {
  // Desktop owns its live project registry. Compatibility files are never
  // read as project identities.
  void filePath;
  void fileSystem;
  return [];
}

function createDesktopProjectBridge({ removeLocal, listLocalProjects, now = () => Date.now() } = {}) {
  return {
    available: typeof removeLocal === "function" || typeof listLocalProjects === "function",
    /**
     * Verify a local Project through the live Desktop ProjectsManager bridge.\n     * Compatibility files are intentionally not accepted here; they may be stale\n     * or invisible to the renderer currently running the sidebar.
     */
    async verifyLocalProject({ projectId, project, timeoutMs = 15_000 } = {}) {
      const id = String(projectId || "").trim();
      if (!id) throw new TypeError("projectId is required");
      if (typeof listLocalProjects !== "function") {
        const error = new Error("Codex Desktop 未提供实时 ProjectsManager.listLocalProjects 控制面");
        error.code = LIVE_PROJECT_VISIBILITY_UNAVAILABLE;
        throw error;
      }
      const startedAt = now();
      const rows = await Promise.race([
        Promise.resolve().then(() => listLocalProjects()),
        new Promise((_, reject) => setTimeout(() => {
          const error = new Error(`Codex Desktop 实时项目可见性核对超过 ${timeoutMs}ms`);
          error.code = "LIVE_PROJECT_VISIBILITY_TIMEOUT";
          reject(error);
        }, Math.max(100, Number(timeoutMs) || 15_000))),
      ]);
      const list = Array.isArray(rows) ? rows : [];
      const match = list.find((item) => String(item?.id || item?.projectId || "") === id);
      if (!match) {
        const error = new Error(`Codex Desktop 侧栏未返回 local project ${id}`);
        error.code = LIVE_PROJECT_VISIBILITY_UNVERIFIED;
        error.projectId = id;
        throw error;
      }
      return { projectId: id, visible: true, verified: true, startedAt, finishedAt: now(), project: match };
    },
    async removeLocalProject({ projectId, project, timeoutMs = 15_000 } = {}) {
      const id = String(projectId || "").trim();
      if (!id) throw new TypeError("projectId is required");
      if (typeof removeLocal !== "function") {
        const error = new Error("Codex Desktop 未提供实时 ProjectsManager.removeLocal 控制面");
        error.code = LIVE_PROJECT_REMOVAL_UNAVAILABLE;
        throw error;
      }
      const startedAt = now();
      const result = await Promise.race([
        Promise.resolve().then(() => removeLocal(id, project)),
        new Promise((_, reject) => setTimeout(() => {
          const error = new Error(`Codex Desktop 实时项目删除超过 ${timeoutMs}ms`);
          error.code = "LIVE_PROJECT_REMOVAL_TIMEOUT";
          reject(error);
        }, Math.max(100, Number(timeoutMs) || 15_000))),
      ]);
      if (typeof listLocalProjects === "function") {
        const remaining = await listLocalProjects();
        const stillPresent = Array.isArray(remaining)
          ? remaining.some((item) => String(item?.id || item?.projectId || "") === id)
          : false;
        if (stillPresent) {
          const error = new Error(`Codex Desktop 删除后仍返回 local project ${id}`);
          error.code = LIVE_PROJECT_REMOVAL_UNVERIFIED;
          throw error;
        }
      }
      return {
        projectId: id,
        removed: true,
        verified: typeof listLocalProjects === "function",
        startedAt,
        finishedAt: now(),
        result,
      };
    },
  };
}

async function removeLocalProjectLive({ bridge, projectId, project, timeoutMs } = {}) {
  if (!bridge || typeof bridge.removeLocalProject !== "function") {
    const error = new Error("缺少 Codex Desktop 实时项目删除桥接");
    error.code = LIVE_PROJECT_REMOVAL_UNAVAILABLE;
    throw error;
  }
  const result = await bridge.removeLocalProject({ projectId, project, timeoutMs });
  if (result?.removed !== true || result?.verified === false) {
    const error = new Error("Codex Desktop 项目删除没有返回可验证的实时结果");
    error.code = LIVE_PROJECT_REMOVAL_UNVERIFIED;
    throw error;
  }
  return result;
}

async function verifyLocalProjectLive({ bridge, projectId, project, timeoutMs } = {}) {
  if (!bridge || typeof bridge.verifyLocalProject !== "function") {
    const error = new Error("缺少 Codex Desktop 实时项目可见性桥接");
    error.code = LIVE_PROJECT_VISIBILITY_UNAVAILABLE;
    throw error;
  }
  const result = await bridge.verifyLocalProject({ projectId, project, timeoutMs });
  if (result?.visible !== true || result?.verified !== true) {
    const error = new Error("Codex Desktop 项目可见性核对没有返回可验证的实时结果");
    error.code = LIVE_PROJECT_VISIBILITY_UNVERIFIED;
    throw error;
  }
  return result;
}

module.exports = {
  LIVE_PROJECT_REMOVAL_UNAVAILABLE,
  LIVE_PROJECT_REMOVAL_UNVERIFIED,
  LIVE_PROJECT_VISIBILITY_UNAVAILABLE,
  LIVE_PROJECT_VISIBILITY_UNVERIFIED,
  readLegacyLocalProjects,
  createDesktopProjectBridge,
  removeLocalProjectLive,
  verifyLocalProjectLive,
};
