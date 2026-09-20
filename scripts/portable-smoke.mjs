import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const executable = path.join(projectRoot, "release", `AI-Project-Harness-${packageJson.version}-portable.exe`);
if (!fs.existsSync(executable)) throw new Error(`Portable executable missing: ${executable}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aph-portable-profile-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-portable-data-"));
const statePath = path.join(dataRoot, "harness-state.json");
const guideStatePath = path.join(dataRoot, "guide-state.json");
const child = spawn(executable, [], {
  cwd: projectRoot,
  env: {
    ...process.env,
    APH_USER_DATA: userData,
    APH_TEST_WINDOW_HIDDEN: "1",
    APH_DATA_ROOT: dataRoot,
    APH_DISABLE_AGENT_LAUNCH: "1",
    APH_DISABLE_CODEX_PROJECT_PROVISION: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  },
  windowsHide: true,
  stdio: "ignore",
});

try {
  const deadline = Date.now() + 60000;
  while ((!fs.existsSync(statePath) || !fs.existsSync(guideStatePath)) && Date.now() < deadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (child.exitCode !== null) throw new Error(`Portable process exited early with code ${child.exitCode}`);
  if (!fs.existsSync(statePath)) throw new Error("Portable process did not persist durable state");
  if (!fs.existsSync(guideStatePath)) throw new Error("Portable process did not persist guide state");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!Array.isArray(state.projects) || state.projects.length !== 0 || state.selectedProjectId) {
    throw new Error("Fresh portable profile did not start with an empty project list");
  }
  process.stdout.write(`${JSON.stringify({ executable, pid: child.pid, statePath, guideStatePath, emptyFirstRun: true }, null, 2)}\nSMOKE_PASS: portable-launch\n`);
} finally {
  try {
    if (process.platform === "win32" && child.pid) execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill();
  } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}
}
