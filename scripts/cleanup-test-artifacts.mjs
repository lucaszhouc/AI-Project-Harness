/**
 * Desktop-only smoke cleanup.
 *
 * External provider commands, global-state edits, and filesystem guesses are
 * intentionally unavailable. A caller must provide a live
 * Desktop ProjectsManager-equivalent bridge and verify the result itself.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const blocked = (detail) => ({ pass: false, status: "SMOKE_BLOCKED", detail, repoRoot });

export async function cleanupTestArtifacts({ liveProjectBridge } = {}) {
  if (!liveProjectBridge || typeof liveProjectBridge.removeLocalProject !== "function") {
    return blocked("Codex Desktop 原生 removeLocalProject bridge 缺失；外部命令和文件删除路径已禁用");
  }
  return blocked("Desktop 原生清理桥必须由运行中的 Electron 控制面调用；独立脚本不再执行任何清理");
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  const report = await cleanupTestArtifacts();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_BLOCKED: desktop-native-cleanup-required\n`);
  process.exitCode = 1;
}
