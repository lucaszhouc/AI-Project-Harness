import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { resolveCommandInvocation } = require("../electron/command-runtime.cjs");
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const electronCommand = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);

function launch(executable, args, options = {}) {
  const invocation = resolveCommandInvocation(executable, args, { environment: options.env || process.env });
  return spawn(invocation.executable, invocation.args, {
    ...options,
    env: invocation.env,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

const vite = launch(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "4173"], {
  cwd: projectRoot,
  stdio: "inherit",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173");
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not become ready on port 4173");
}

let electron;
try {
  await waitForServer();
  electron = launch(electronCommand, ["."], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:4173" },
  });
  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
} catch (error) {
  vite.kill();
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    electron?.kill();
    vite.kill();
  });
}
