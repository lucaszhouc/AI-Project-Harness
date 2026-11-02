const CLI_DISABLED = "CLI_DISABLED";

function disabledError() {
  const error = new Error("Git CLI 已禁用；Harness 只使用 Desktop 原生接口");
  error.code = CLI_DISABLED;
  return error;
}

function validateRemoteUrl(value) {
  const url = String(value || "").trim();
  if (!url || /[\\r\\n\\0]/.test(url)) throw new Error("远端地址不能为空且不能包含换行");
  if (!/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(url)) throw new Error("只支持 HTTPS、SSH 或 git@ 远端地址");
  if (/^https?:\/\/[^/]*@/i.test(url)) throw new Error("远端地址不能包含账号或令牌");
  return url;
}

async function readGitStatus() {
  return { available: false, error: "Git CLI 已禁用；当前版本不通过外部命令读取 Git 状态", code: CLI_DISABLED, checkedAt: new Date().toISOString() };
}

async function setGitRemote() { throw disabledError(); }

module.exports = { CLI_DISABLED, readGitStatus, setGitRemote, validateRemoteUrl };
