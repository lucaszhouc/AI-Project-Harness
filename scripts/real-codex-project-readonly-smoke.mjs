#!/usr/bin/env node
/**
 * Read-only Project/rollout audit for a real Codex installation.
 *
 * This deliberately uses only project/list, thread/list and (when requested)
 * thread/turns/list. It never calls project/create, thread/start, turn/start
 * or thread/inject_items, so it cannot create a Project, a conversation or a
 * model run. The report distinguishes app-server/SQLite visibility from the
 * Desktop renderer sidebar, which is only verifiable after a cold Desktop
 * restart.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  inspectCodexThread,
  listCodexProjects,
  listRecentCodexThreads,
} = require("../electron/codex-adapter.cjs");
const { resolveAppServerCwd } = require("../electron/runtime-paths.cjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveExecutable() {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const matches = execFileSync(locator, ["codex"], { encoding: "utf8", windowsHide: true })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return matches.find((entry) => entry.toLowerCase().endsWith(".exe"))
    || matches.find((entry) => entry.toLowerCase().endsWith(".cmd"))
    || matches[0];
}

function normalize(value) {
  return String(value || "").replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function expectedRoots() {
  const raw = String(process.env.APH_EXPECT_PROJECT_ROOTS || "").trim();
  if (!raw) return [];
  return raw.split(";").map((entry) => entry.trim()).filter(Boolean);
}

const executable = resolveExecutable();
if (!executable) throw new Error("Codex executable not found");
const resourcesPath = path.resolve(process.env.APH_PACKAGED_RESOURCES || root);
const appPath = path.join(resourcesPath, "app.asar");
const cwd = resolveAppServerCwd({ isPackaged: true, resourcesPath, appPath });
const projects = await listCodexProjects({ executable, cwd });
const threads = await listRecentCodexThreads({ executable, cwd, limit: 500 });
const roots = projects.flatMap((project) => (project.roots || []).map((rootEntry) => ({
  projectId: project.id,
  name: project.name,
  path: rootEntry.path,
}))); 

const expected = expectedRoots();
const expectedChecks = expected.map((rootPath) => ({
  path: rootPath,
  project: roots.find((entry) => normalize(entry.path) === normalize(rootPath)) || null,
}));

const inspectIds = String(process.env.APH_INSPECT_THREAD_IDS || "")
  .split(/[;,\s]+/)
  .map((entry) => entry.trim())
  .filter(Boolean);
const threadChecks = [];
for (const threadId of inspectIds) {
  try {
    threadChecks.push({ threadId, ...(await inspectCodexThread({ executable, cwd, threadId })) });
  } catch (error) {
    threadChecks.push({ threadId, readable: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const report = {
  readOnly: true,
  executable,
  cwd,
  officialProjectCount: projects.length,
  officialProjects: projects.map((project) => ({ id: project.id, name: project.name, roots: project.roots || [] })),
  recentThreadCount: threads.length,
  expectedChecks,
  threadChecks,
  sidebarVisibility: "not-verified: requires a complete Codex Desktop cold restart",
};

if (expectedChecks.some((entry) => !entry.project)) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_FAIL: expected Project root missing\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: codex-project-readonly (app-server only; sidebar not claimed)\n`);
}
