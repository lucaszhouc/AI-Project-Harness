import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const electronExecutable = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const asarPath = path.resolve(
  process.env.APH_PACKAGED_ASAR
    || path.join(projectRoot, "release", "win-unpacked", "resources", "app.asar"),
);
const resourcesPath = path.dirname(asarPath);
const smokeScript = path.join(projectRoot, "scripts", "real-codex-readonly-smoke.mjs");

const child = spawn(electronExecutable, [smokeScript], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    APH_PACKAGED_ASAR: asarPath,
    APH_PACKAGED_RESOURCES: resourcesPath,
    APH_FORCE_WINDOWS_SHIM: process.platform === "win32" ? "1" : "0",
  },
  windowsHide: true,
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (signal) reject(new Error(`Packaged Codex smoke terminated by ${signal}`));
    else resolve(code ?? 1);
  });
});

if (exitCode !== 0) process.exit(exitCode);
