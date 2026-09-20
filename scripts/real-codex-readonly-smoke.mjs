import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const packagedAsar = process.env.APH_PACKAGED_ASAR ? path.resolve(process.env.APH_PACKAGED_ASAR) : null;
const adapterPath = packagedAsar
  ? path.join(packagedAsar, "electron", "codex-adapter.cjs")
  : path.join(projectRoot, "electron", "codex-adapter.cjs");
const { listRecentCodexCwds } = require(adapterPath);
const { resolveAppServerCwd } = require("../electron/runtime-paths.cjs");

function resolveCodexExecutable() {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const matches = execFileSync(locator, ["codex"], { encoding: "utf8", windowsHide: true })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (process.env.APH_FORCE_WINDOWS_SHIM === "1") {
    const shim = matches.find((entry) => entry.toLowerCase().endsWith(".cmd"));
    if (shim) return shim;
  }
  return matches.find((entry) => entry.toLowerCase().endsWith(".exe"))
    || matches.find((entry) => entry.toLowerCase().endsWith(".cmd"))
    || matches[0];
}

const resourcesPath = path.resolve(process.env.APH_PACKAGED_RESOURCES || projectRoot);
const appPath = path.join(resourcesPath, "app.asar");
const cwd = resolveAppServerCwd({ isPackaged: true, resourcesPath, appPath });
if (cwd !== resourcesPath) {
  throw new Error(`Packaged app-server cwd is not the real resources directory: ${cwd}`);
}

const executable = resolveCodexExecutable();
const recentCwds = await listRecentCodexCwds({ executable, cwd });
const report = {
  initialized: true,
  operation: "thread/list",
  adapterSource: packagedAsar ? "app.asar" : "source",
  executableKind: path.extname(executable).toLowerCase() || "extensionless",
  cwd,
  recentCwdCount: recentCwds.length,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: ${packagedAsar ? "packaged-codex" : "codex-readonly"}\n`);
