const path = require("node:path");
const fs = require("node:fs");

const DEFAULT_DATA_ROOT = "E:\\_Codex数据\\AI-Project-Harness";

/**
 * The parent folder trusted during first Harness setup. All subsequently
 * generated project workspaces live below this root, so Codex never needs to
 * ask the user to trust each generated child folder separately.
 */
function resolveHarnessTrustedRoot({ isPackaged, resourcesPath, appPath, executablePath = process.execPath, portableExecutablePath = process.env.PORTABLE_EXECUTABLE_FILE, portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR, envValue = process.env.APH_HARNESS_TRUSTED_ROOT } = {}) {
  const configured = String(envValue || "").trim();
  if (configured) return path.resolve(configured);
  if (!isPackaged) return path.resolve(appPath);

  // The portable build keeps the executable under `<repo>\release`, while
  // the user's trusted Harness root and generated `harness-projects` folder
  // live beside that release directory.  Resolving the root to `release`
  // caused Codex to see every generated child as a new, untrusted tree.  Use
  // the project root when the packaged layout is recognizable; other installs
  // continue to use the executable directory as their self-contained root.
  const resourcesRoot = path.resolve(path.dirname(resourcesPath || executablePath || appPath));
  // electron-builder runs process.execPath from a disposable extraction
  // directory. Its portable environment points back to the real launcher.
  const executableRoot = portableExecutablePath
    ? path.dirname(path.resolve(portableExecutablePath))
    : portableExecutableDir ? path.resolve(portableExecutableDir)
      : path.resolve(path.dirname(executablePath || resourcesRoot));
  // Local candidates may be nested under release/rcN-win-unpacked. Find the
  // same repository boundary for all those layouts, without traversing an
  // arbitrary install outside a release tree.
  let candidate = executableRoot;
  for (let depth = 0; depth < 5; depth += 1) {
    if (path.basename(candidate).toLowerCase() === "release") {
      const parentRoot = path.dirname(candidate);
      if (fs.existsSync(path.join(parentRoot, "package.json"))
        && fs.existsSync(path.join(parentRoot, "harness-projects"))) return parentRoot;
      break;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return executableRoot;
}

function resolveBundledSkillPath({ isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  return path.join(runtimeRoot, "integrations", "codex", "skills", "ai-project-harness", "SKILL.md");
}

function resolveBundledWritebackSkillPath({ isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = isPackaged ? resourcesPath : appPath;
  return path.join(runtimeRoot, "integrations", "codex", "skills", "ai-project-harness-writeback", "SKILL.md");
}

/**
 * Resolve the files that form the Harness/Codex handoff protocol.  These are
 * shipped with Harness and are referenced by path in a turn prompt; they are
 * deliberately not injected as Desktop 原生控制面 `type: skill` input items.
 */
function resolveBundledHarnessProtocolPaths({ isPackaged, resourcesPath, appPath }) {
  const runtimeRoot = path.resolve(isPackaged ? resourcesPath : appPath);
  return Object.freeze({
    runtimeRoot,
    taskSkillPath: path.join(runtimeRoot, "integrations", "codex", "skills", "ai-project-harness", "SKILL.md"),
    writebackSkillPath: path.join(runtimeRoot, "integrations", "codex", "skills", "ai-project-harness-writeback", "SKILL.md"),
    taskStatusSchemaPath: path.join(runtimeRoot, "protocol", "harness-task-status.schema.json"),
    importSchemaPath: path.join(runtimeRoot, "protocol", "harness-import.schema.json"),
  });
}

function createHarnessProtocolPathProvider(options, { fileSystem = fs } = {}) {
  let cached;
  return function getProtocolPaths() {
    if (cached) return cached;
    const paths = resolveBundledHarnessProtocolPaths(typeof options === "function" ? options() : options);
    for (const [field, label] of Object.entries({ taskSkillPath: "任务协议", writebackSkillPath: "回写协议", taskStatusSchemaPath: "状态协议", importSchemaPath: "导入协议" })) {
      const target = paths[field];
      try { if (!fileSystem.statSync(target).isFile()) throw new Error("not a file"); fileSystem.accessSync(target, fs.constants.R_OK); }
      catch { throw new Error(`HARNESS_PROTOCOL_MISSING: Harness 内置${label}缺失或不可读：${target}`); }
    }
    cached = paths;
    return cached;
  };
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

module.exports = { DEFAULT_DATA_ROOT, resolveHarnessTrustedRoot, resolveBundledSkillPath, resolveBundledWritebackSkillPath, resolveBundledHarnessProtocolPaths, createHarnessProtocolPathProvider, resolveBundledAgentSkillPath, resolveBundledProtocolPath, resolveDataRoot, resolveStatePath, resolveJournalPath };
