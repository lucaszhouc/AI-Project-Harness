#!/usr/bin/env node
/**
 * Release packaging is forbidden until the real manual-selection chain has
 * been verified in the official Codex Desktop sidebar.  App-server facts and
 * Harness-side smoke are necessary but deliberately insufficient here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Validate the one piece of evidence that is allowed to unlock packaging.
 * This is deliberately a pure function so the gate itself has regression
 * coverage and cannot silently be bypassed by a renderer or a local smoke.
 */
export function validateReleaseEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("RELEASE_BLOCKED: 发布验收证据必须是 JSON 对象");
  }
  if (evidence.pass !== true || evidence.sidebarVisible !== true) {
    throw new Error("RELEASE_BLOCKED: 侧栏验收证据必须同时包含 pass=true 和 sidebarVisible=true；当前仍只能报 PARTIAL");
  }
  if (evidence.fullChainStatus !== "PASS" || evidence.chainPass !== true || evidence.taskWritebackPass !== true) {
    throw new Error("RELEASE_BLOCKED: Desktop 原生任务闭环与回写证据未通过；源码测试或后台记录不能替代真实链路");
  }
  if (!String(evidence.verifiedAt || "").trim()) {
    throw new Error("RELEASE_BLOCKED: 发布验收证据缺少 verifiedAt，无法确认它不是旧快照");
  }
  if (!String(evidence.officialProjectId || "").trim() || !String(evidence.importThreadId || "").trim()) {
    throw new Error("RELEASE_BLOCKED: 侧栏验收证据缺少官方 Project ID 或导入 thread ID");
  }
  if (!String(evidence.trustedRoot || "").trim() || !String(evidence.projectPath || "").trim()) {
    throw new Error("RELEASE_BLOCKED: 侧栏验收证据缺少程序受信任根或项目目录");
  }
  const expectedParent = path.resolve(String(evidence.trustedRoot), "harness-projects").toLowerCase();
  const actualParent = path.dirname(path.resolve(String(evidence.projectPath))).toLowerCase();
  if (actualParent !== expectedParent) throw new Error("RELEASE_BLOCKED: 项目目录必须位于程序目录下的 harness-projects");
  const controls = Array.isArray(evidence.controlThreadIds) ? evidence.controlThreadIds.filter(Boolean) : [];
  if (controls.length < 2) throw new Error("RELEASE_BLOCKED: 侧栏验收证据缺少 CTO/Review 两个 control thread");
  return evidence;
}

export function readReleaseEvidence(evidencePath) {
  const resolvedPath = String(evidencePath || "").trim();
  if (!resolvedPath) {
    throw new Error("RELEASE_BLOCKED: 未提供 Desktop 侧栏冷重启验收证据；先设置 APH_RELEASE_SIDEBAR_EVIDENCE，再运行打包命令");
  }
  if (!fs.existsSync(resolvedPath)) throw new Error(`RELEASE_BLOCKED: 侧栏验收证据不存在：${resolvedPath}`);
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`RELEASE_BLOCKED: 侧栏验收证据不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  return { path: resolvedPath, evidence: validateReleaseEvidence(evidence) };
}

export function validateDesktopOnlySource(root) {
  const rootPath = path.resolve(String(root || process.cwd()));
  const files = ["electron/main.cjs", "electron/codex-adapter.cjs", "electron/command-runtime.cjs"];
  const forbidden = [/node:child_process/, /spawn\s*\(/, /execFile/, /createCodexThread/, /launchHarnessTask/, /launchHarnessImport/, /createCodexControlThread/, /app-server/, /Codex CLI/, /APH_DISABLE_/];
  for (const relative of files) {
    const filePath = path.join(rootPath, relative);
    const source = fs.readFileSync(filePath, "utf8");
    const hit = forbidden.find((pattern) => pattern.test(source));
    if (hit) throw new Error(`RELEASE_BLOCKED: Desktop-only 源码闸门命中 ${relative} / ${hit}`);
  }
  return true;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  validateDesktopOnlySource(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const { path: evidencePath } = readReleaseEvidence(process.env.APH_RELEASE_SIDEBAR_EVIDENCE);
  process.stdout.write(`PREPACKAGE_GATE_PASS: ${evidencePath}\n`);
}
