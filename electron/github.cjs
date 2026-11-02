const { CLI_DISABLED } = require("./git.cjs");

function parseRemote(remote) {
  if (!remote) return null;
  const value = String(remote).trim().replace(/[?#].*$/, "").replace(/\.git(?:\/)?$/, "").replace(/\/$/, "");
  const match = value.match(/(?:github\.com[/:])([^/ :]+)\/([^/]+)$/i);
  return match ? { owner: match[1], name: match[2], nameWithOwner: `${match[1]}/${match[2]}`, url: `https://github.com/${match[1]}/${match[2]}` } : null;
}

async function readGitHubStatus() {
  return { available: false, error: "GitHub CLI 已禁用；当前版本不通过外部命令读取远端状态", code: CLI_DISABLED, checkedAt: new Date().toISOString(), remote: null, repository: null, pullRequests: [], issues: [], detailsLoaded: false, gh: { available: false } };
}

async function runCommand() { throw Object.assign(new Error("GitHub CLI 已禁用；请使用 Desktop 原生接口"), { code: CLI_DISABLED }); }

module.exports = { parseRemote, readGitHubStatus, runCommand };
