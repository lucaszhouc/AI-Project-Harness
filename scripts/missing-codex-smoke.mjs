import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright-core");
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const electronExecutable = path.resolve(process.env.APH_ELECTRON_EXECUTABLE || path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
));
const packagedExecutable = Boolean(process.env.APH_ELECTRON_EXECUTABLE);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aph-no-codex-profile-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-no-codex-data-"));
const reportPath = path.resolve(process.env.APH_MISSING_CODEX_REPORT || path.join(os.tmpdir(), "aph-missing-codex-report.json"));
const restrictedPath = process.platform === "win32"
  ? `${path.dirname(process.execPath)};C:\\Windows\\System32`
  : "/usr/bin:/bin";
const isolatedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !["path", "codex_executable"].includes(key.toLowerCase())),
);
const report = { executable: electronExecutable, packagedExecutable, userData, dataRoot };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = await electron.launch({
  executablePath: electronExecutable,
  args: packagedExecutable ? [] : [projectRoot],
  env: {
    ...isolatedEnvironment,
    PATH: restrictedPath,
    APH_USER_DATA: userData,
    APH_TEST_WINDOW_HIDDEN: "1",
    APH_DATA_ROOT: dataRoot,
    APH_DISABLE_DESKTOP_DEEPLINK: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".app-shell").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  const dialog = page.locator("#project-dialog");
  await dialog.getByRole("button", { name: "新建项目", exact: true }).first().click();
  await dialog.locator('input[name="blankName"]').fill("cold start fixture");
  await dialog.getByRole("button", { name: "新建项目", exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector("#project-dialog")?.hasAttribute("open"), null, { timeout: 10000 });
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "连接 Codex", exact: true }).click();
  await page.waitForFunction(() => {
    const toast = document.querySelector(".toast--error");
    return Boolean(toast && /未检测到 Codex/.test(toast.textContent || "") && getComputedStyle(toast).visibility !== "hidden");
  }, null, { timeout: 20000 });
  report.result = await page.evaluate(() => ({
    shellVisible: Boolean(document.querySelector(".app-shell")),
    localProjectVisible: Boolean(document.querySelector(".project-item")),
    error: document.querySelector(".toast--error")?.textContent?.trim()
      || "",
    busy: document.body.classList.contains("is-busy"),
  }));
  assert(report.result.shellVisible, "Application shell disappeared when Codex was unavailable");
  assert(report.result.localProjectVisible, "Local project was lost after the missing-Codex failure");
  assert(/未检测到 Codex/.test(report.result.error || ""), `Missing Codex message is not actionable: ${report.result.error}`);
  assert(!report.result.busy, "Onboarding remained in an infinite loading state");
  report.pass = true;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: ${reportPath}\n`);
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
  for (const target of [userData, dataRoot]) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
  }
}
