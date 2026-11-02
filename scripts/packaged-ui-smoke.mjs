import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const executable = path.join(projectRoot, "release", "win-unpacked", "AI Project Harness.exe");
if (!fs.existsSync(executable)) throw new Error(`Unpacked executable missing: ${executable}`);

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not reserve a local packaged UI smoke port");
  return port;
}

const port = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aph-packaged-ui-profile-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-packaged-ui-data-"));
fs.writeFileSync(path.join(dataRoot, "guide-state.json"), JSON.stringify({
  schemaVersion: 1,
  copyVersion: 1,
  sessionId: "legacy-english-state",
  locale: "en",
  dismissed: false,
  sequence: 1,
  steps: {},
  probes: {},
  operations: {},
  completionEvidence: [],
  diagnostics: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: projectRoot,
  env: {
    ...process.env,
    APH_USER_DATA: userData,
    APH_TEST_WINDOW_HIDDEN: "1",
    APH_DATA_ROOT: dataRoot,
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  },
  windowsHide: true,
  stdio: "ignore",
});

async function waitForEndpoint(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Packaged Chromium may take a few seconds to bind its debugging port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Packaged Electron remote debugging endpoint did not start");
}

try {
  await waitForEndpoint();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error("Packaged Electron did not expose a renderer page");
  await page.locator(".app-shell").waitFor({ timeout: 15000 });
  const firstRun = await page.evaluate(() => ({
    revision: document.querySelector(".project-context b")?.textContent?.trim(),
    hasAddProject: Boolean(document.querySelector('[data-action="add-project"]')),
    hasGuidePanel: Boolean(document.querySelector(".getting-started")),
    hasGuideAction: Boolean(document.querySelector('[data-action^="guide-"]')),
    chineseFirstRun: document.body.innerText.includes("新建项目"),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (firstRun.revision || !firstRun.hasAddProject || firstRun.hasGuidePanel || firstRun.hasGuideAction || !firstRun.chineseFirstRun || firstRun.overflow) {
    throw new Error(`Packaged first-run contract failed: ${JSON.stringify(firstRun)}`);
  }
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  const projectDialog = page.locator("#project-dialog");
  await projectDialog.waitFor({ state: "visible", timeout: 3000 });
  await projectDialog.locator('[data-action="select-project-mode"][data-mode="blank"]').click();
  await projectDialog.locator('input[name="blankName"]').fill("Packaged UI smoke project");
  await projectDialog.locator('textarea[name="blankGoal"]').fill("Verify packaged first-run UI");
  await projectDialog.getByRole("button", { name: "新建项目", exact: true }).last().click();
  await page.waitForFunction(() => /^HEAD R\d+$/.test(document.querySelector(".project-context b")?.textContent || ""), null, { timeout: 10000 });
  const progressDialog = page.locator("#project-progress-dialog");
  if (await progressDialog.isVisible().catch(() => false)) await progressDialog.locator('[data-close]').click();
  if (await projectDialog.isVisible().catch(() => false)) await projectDialog.locator('[data-close]').first().click();
  const result = await page.evaluate(() => ({
    title: document.title,
    revision: document.querySelector(".project-context b")?.textContent?.trim(),
    hasCtoEntry: Boolean(document.querySelector('[data-action="open-cto"]')),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (result.title !== "AI Project Harness" || !/^HEAD R\d+$/.test(result.revision) || !result.hasCtoEntry || result.overflow) {
    throw new Error(`Packaged UI contract failed: ${JSON.stringify(result)}`);
  }
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const taskDialog = page.locator("#task-dialog");
  await taskDialog.waitFor({ state: "visible" });
  const taskContract = await taskDialog.evaluate((element) => ({
    hasHermes: Boolean(element.querySelector('select[name="agent"] option[value="hermes"]')),
    hasDependencies: Boolean(element.querySelector('select[name="dependsOn"]')),
    scrollPolicy: getComputedStyle(element).maxHeight !== "none" && ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
  }));
  if (!taskContract.hasHermes || !taskContract.hasDependencies || !taskContract.scrollPolicy) {
    throw new Error(`Packaged task dialog contract failed: ${JSON.stringify(taskContract)}`);
  }
  await taskDialog.locator('[data-close]').first().click();
  const statePath = path.join(dataRoot, "harness-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const project = state.projects.find((item) => item.id === state.selectedProjectId);
  if (!project?.contextPackets?.cto?.path || !fs.existsSync(project.contextPackets.cto.path)) {
    throw new Error("Packaged UI did not persist the CTO context packet");
  }
  process.stdout.write(`${JSON.stringify({ ...result, statePath, ctoPacket: project.contextPackets.cto.path }, null, 2)}\nSMOKE_PASS: packaged-ui\n`);
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(bridgeDataRoot, { recursive: true, force: true }); } catch {}
}
