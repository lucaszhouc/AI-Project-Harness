const path = require("node:path");

const DEFAULT_DATA_ROOT = "E:\\_Codex数据\\AI-Project-Harness";

function resolveAppServerCwd({ isPackaged, resourcesPath, appPath }) {
  return path.resolve(isPackaged ? resourcesPath : appPath);
}

function resolveBundledSkillPath({ isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  return path.join(runtimeRoot, "integrations", "codex", "skills", "ai-project-harness", "SKILL.md");
}

function resolveBundledAgentSkillPath({ agent = "codex", isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  const normalized = ["codex", "claude", "hermes"].includes(agent) ? agent : "codex";
  return path.join(runtimeRoot, "integrations", normalized, "skills", "ai-project-harness", "SKILL.md");
}

function resolveBundledProtocolPath({ fileName = "harness-import.schema.json", isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  const safeName = path.basename(String(fileName || "harness-import.schema.json"));
  return path.join(runtimeRoot, "protocol", safeName);
}

function resolveHarnessCliPath({ isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  return path.join(runtimeRoot, isPackaged ? "harness-runtime" : "scripts", isPackaged ? "scripts" : "", "harness-cli.mjs");
}

function resolveHarnessMcpPath({ isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  return path.join(runtimeRoot, isPackaged ? "harness-runtime" : "scripts", isPackaged ? "scripts" : "", "harness-mcp.mjs");
}

/**
 * Resolve the durable data directory. APH_DATA_ROOT is intentionally explicit
 * for portable installs; otherwise the Windows E: data disk is preferred and
 * the Electron userData directory remains a safe fallback on other machines.
 */
function resolveDataRoot({ envValue = process.env.APH_DATA_ROOT, userDataPath, platform = process.platform, fileSystem = require("node:fs") } = {}) {
  const configured = String(envValue || "").trim();
  if (configured) return path.resolve(configured);
  // Test/portable harness launches set APH_USER_DATA to an isolated profile;
  // keep those runs hermetic instead of touching the user's E: data store.
  if (process.env.APH_USER_DATA && userDataPath) return path.resolve(userDataPath);
  if (platform === "win32" && fileSystem.existsSync("E:\\")) return path.resolve(DEFAULT_DATA_ROOT);
  return path.resolve(userDataPath || path.join(process.cwd(), ".aph-data"));
}

function resolveStatePath(options = {}) {
  return path.join(resolveDataRoot(options), "harness-state.json");
}

function resolveJournalPath(options = {}) {
  return path.join(resolveDataRoot(options), "harness-state.jsonl");
}

module.exports = { DEFAULT_DATA_ROOT, resolveAppServerCwd, resolveBundledSkillPath, resolveBundledAgentSkillPath, resolveBundledProtocolPath, resolveHarnessCliPath, resolveHarnessMcpPath, resolveDataRoot, resolveStatePath, resolveJournalPath };
