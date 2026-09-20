const REMOTE_METHOD_PREFIX = /^Error invoking remote method\s+['"][^'"]+['"]:\s*/i;
const ERROR_ID_PATTERN = /(?:错误编号|error\s*id)\s*[：:]\s*(APH-\d{8}-\d{6}-[a-z0-9]+)/i;

export function userFacingErrorDetails(error) {
  let message = error instanceof Error ? error.message : String(error);
  const errorId = message.match(ERROR_ID_PATTERN)?.[1];
  message = message.replace(REMOTE_METHOD_PREFIX, "").replace(/^Error:\s*/i, "").trim();
  message = message.replace(ERROR_ID_PATTERN, "").trim();

  if (/\bspawn\s+EINVAL\b/i.test(message)) {
    message = "Codex 启动入口不兼容。请更新 Harness 后重试；若仍失败，请打开错误日志。";
  } else if (/\bspawn\b[\s\S]*\bENOENT\b/i.test(message)) {
    message = "无法启动 Codex。请确认 Codex Desktop 已安装并可正常打开。";
  } else if (/\bfetch failed\b/i.test(message)) {
    message = "无法连接 Codex 服务。请确认 Codex Desktop 正常运行后重试。";
  } else if (/^initialize timed out\b/i.test(message)) {
    message = "Codex 连接超时（初始化阶段）。请确认 Codex Desktop 正常运行后重试。";
  } else if (/Codex app-server is not writable/i.test(message)) {
    message = "Codex 连接已中断。请重新打开 Codex Desktop 后重试。";
  } else if (/Codex app-server exited/i.test(message)) {
    message = "Codex 后台服务意外退出。请重新打开 Codex Desktop 后重试。";
  } else if (/STALE_RESULT/i.test(message)) {
    message = "这个结果基于旧的项目版本，已安全拦截；请重新读取项目上下文后再提交。";
  } else if (/已归档项目|项目当前为/i.test(message)) {
    message = message;
  } else if (/Transcript file not found|Transcript path is not a file/i.test(message)) {
    message = "找不到可导入的会话文件，请选择本地 JSONL、JSON 或文本归档。";
  } else if (/GitHub/i.test(message)) {
    message = "GitHub 状态暂时不可用；本地项目和 Git 状态仍可继续使用。";
  } else if (/\btimed out(?: after \d+ms)?\b/i.test(message)) {
    const stage = message.match(/^([^:]+?)\s+timed out/i)?.[1]?.trim();
    message = stage
      ? `Codex 操作超时（${stage}）。请重试；若持续失败，请打开错误日志。`
      : "Codex 操作超时。请重试；若持续失败，请打开错误日志。";
  }

  return { message: message || "操作失败，请重试。", ...(errorId ? { errorId } : {}) };
}

export function userFacingErrorMessage(error) {
  const details = userFacingErrorDetails(error);
  return details.errorId ? `${details.message}（错误编号：${details.errorId}）` : details.message;
}
