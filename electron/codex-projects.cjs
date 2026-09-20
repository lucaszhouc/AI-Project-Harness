const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const UNIFIED_SIDEBAR_PROJECT_ORDER_KEY = "unified-sidebar-project-order-v1";

// The legacy global JSON is a compatibility cache owned by Codex Desktop,
// not the source of truth for modern app-server Projects. Keep writes
// explicitly opt-in so a long-lived Desktop process cannot lose newer state
// through a last-writer-wins atom flush.
function legacyStateSyncEnabled(env = process.env) {
  return String(env?.APH_ENABLE_CODEX_LEGACY_STATE_SYNC || "") === "1";
}

function projectFolderId(projectPath) {
  return `local-${createHash("sha1").update(path.resolve(projectPath).toLowerCase()).digest("hex").slice(0, 32)}`;
}

function defaultStatePath() {
  return path.join(os.homedir(), ".codex", ".codex-global-state.json");
}

function loadState(statePath, fileSystem = fs) {
  if (!fileSystem.existsSync(statePath)) return {};
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(statePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(statePath, state, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(statePath), { recursive: true });
  const backup = `${statePath}.bak`;
  if (fileSystem.existsSync(statePath) && !fileSystem.existsSync(backup)) fileSystem.copyFileSync(statePath, backup);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const temporary = `${statePath}.tmp-${process.pid}-${Date.now()}-${attempt}`;
    try {
      fileSystem.writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
      fileSystem.renameSync(temporary, statePath);
      return { written: true, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      try { fileSystem.rmSync?.(temporary, { force: true }); } catch {}
      const transient = ["EPERM", "EACCES", "EBUSY"].includes(error?.code);
      if (!transient) throw error;
    }
  }
  throw lastError || new Error("Codex global state write failed");
}

function resolveLegacyProjectId(state, projectId) {
  const requested = String(projectId || "").trim();
  if (!requested) return requested;
  if (state?.["local-projects"]?.[requested]) return requested;
  const mappings = state?.["app-server-project-id-by-legacy-project-id-by-host"] || {};
  for (const mapping of Object.values(mappings)) {
    for (const [legacyId, officialId] of Object.entries(mapping || {})) {
      if (String(officialId) === requested) return legacyId;
    }
  }
  return requested;
}

function ensureUnifiedSidebarProjectOrder(state, legacyProjectId) {
  if (!legacyProjectId) return;
  state["electron-persisted-atom-state"] ||= {};
  const current = state["electron-persisted-atom-state"][UNIFIED_SIDEBAR_PROJECT_ORDER_KEY];
  const order = Array.isArray(current) ? [...current] : [];
  const key = `codex:project:${legacyProjectId}`;
  if (!order.includes(key)) order.push(key);
  state["electron-persisted-atom-state"][UNIFIED_SIDEBAR_PROJECT_ORDER_KEY] = order;
}

function ensureCodexProjectFolder({ projectPath, projectName, threadIds = [], officialProjectId, statePath = defaultStatePath(), fileSystem = fs, enabled = legacyStateSyncEnabled() } = {}) {
  if (!projectPath) throw new Error("projectPath is required");
  const resolvedPath = path.resolve(projectPath);
  const name = String(projectName || path.basename(resolvedPath)).trim() || path.basename(resolvedPath);
  const id = projectFolderId(resolvedPath);
  if (!enabled) {
    return { projectId: id, legacyProjectId: id, name, path: resolvedPath, statePath, skipped: "legacy-sync-disabled" };
  }
  const state = loadState(statePath, fileSystem);
  state["local-projects"] ||= {};
  state["project-order"] ||= [];
  state["sidebar-project-thread-orders"] ||= {};
  const existing = state["local-projects"][id];
  const rootPaths = [...new Set([...(existing?.rootPaths || []), resolvedPath])];
  const desiredProject = {
    ...(existing || { id, createdAt: Date.now() }),
    id,
    name,
    rootPaths,
    updatedAt: existing && existing.name === name && JSON.stringify(existing.rootPaths || []) === JSON.stringify(rootPaths)
      ? existing.updatedAt
      : Date.now(),
  };
  let changed = JSON.stringify(existing || null) !== JSON.stringify(desiredProject);
  if (changed) state["local-projects"][id] = desiredProject;
  if (!state["project-order"].includes(id)) {
    state["project-order"].push(id);
    changed = true;
  }
  const official = String(officialProjectId || "").trim();
  if (official) {
    const identity = `local:${path.dirname(statePath)}`;
    state["app-server-project-id-by-legacy-project-id-by-host"] ||= {};
    state["app-server-project-id-by-legacy-project-id-by-host"][identity] ||= {};
    if (state["app-server-project-id-by-legacy-project-id-by-host"][identity][id] !== official) {
      state["app-server-project-id-by-legacy-project-id-by-host"][identity][id] = official;
      changed = true;
    }
  }
  // Codex Desktop's current unified sidebar keeps a separate persisted order
  // for legacy local-project identities. Append only; never disturb the
  // user's existing order or pinned entries.
  const beforeUnified = JSON.stringify(state["electron-persisted-atom-state"]?.[UNIFIED_SIDEBAR_PROJECT_ORDER_KEY] || null);
  ensureUnifiedSidebarProjectOrder(state, id);
  if (beforeUnified !== JSON.stringify(state["electron-persisted-atom-state"]?.[UNIFIED_SIDEBAR_PROJECT_ORDER_KEY] || null)) changed = true;
  if (!state["sidebar-project-thread-orders"][id]) {
    state["sidebar-project-thread-orders"][id] = { threadIds: [] };
    changed = true;
  }
  state["thread-project-assignments"] ||= {};
  const uniqueThreadIds = [...new Set((threadIds || []).map((threadId) => String(threadId || "").trim()).filter(Boolean))];
  if (uniqueThreadIds.length) {
    const order = state["sidebar-project-thread-orders"][id];
    const nextThreadIds = [
      ...uniqueThreadIds,
      ...(order.threadIds || []).filter((threadId) => !uniqueThreadIds.includes(String(threadId))),
    ];
    if (JSON.stringify(order.threadIds || []) !== JSON.stringify(nextThreadIds)) {
      order.threadIds = nextThreadIds;
      changed = true;
    }
    for (const threadId of uniqueThreadIds) {
      const assignment = { projectKind: "local", projectId: id };
      if (JSON.stringify(state["thread-project-assignments"][threadId] || null) !== JSON.stringify(assignment)) {
        state["thread-project-assignments"][threadId] = assignment;
        changed = true;
      }
    }
  }
  if (changed) writeState(statePath, state, fileSystem);
  return {
    projectId: id,
    legacyProjectId: id,
    ...(official ? { officialProjectId: official } : {}),
    name,
    path: resolvedPath,
    statePath,
  };
}

function assignCodexThreadToProjectFolder({ threadId, projectId, statePath = defaultStatePath(), fileSystem = fs, enabled = legacyStateSyncEnabled() } = {}) {
  if (!threadId || !projectId) throw new Error("threadId and projectId are required");
  if (!enabled) {
    const requestedProjectId = String(projectId);
    return { threadId: String(threadId), projectId: requestedProjectId, legacyProjectId: requestedProjectId, requestedProjectId, statePath, skipped: "legacy-sync-disabled" };
  }
  const state = loadState(statePath, fileSystem);
  const legacyProjectId = resolveLegacyProjectId(state, projectId);
  state["thread-project-assignments"] ||= {};
  state["sidebar-project-thread-orders"] ||= {};
  state["thread-project-assignments"][String(threadId)] = { projectKind: "local", projectId: legacyProjectId };
  const order = state["sidebar-project-thread-orders"][legacyProjectId] ||= { threadIds: [] };
  order.threadIds = [String(threadId), ...(order.threadIds || []).filter((id) => id !== String(threadId))];
  ensureUnifiedSidebarProjectOrder(state, legacyProjectId);
  writeState(statePath, state, fileSystem);
  return { threadId: String(threadId), projectId: legacyProjectId, legacyProjectId, requestedProjectId: String(projectId), statePath };
}

module.exports = {
  projectFolderId,
  resolveLegacyProjectId,
  ensureUnifiedSidebarProjectOrder,
  ensureCodexProjectFolder,
  assignCodexThreadToProjectFolder,
  legacyStateSyncEnabled,
  defaultStatePath,
};
