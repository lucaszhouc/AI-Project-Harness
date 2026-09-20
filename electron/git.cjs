const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { detectCommand, resolveCommandInvocation } = require("./command-runtime.cjs");

const execFileAsync = promisify(execFile);

async function git(executable, projectPath, args) {
  const invocation = resolveCommandInvocation(executable, ["-C", projectPath, ...args]);
  const { stdout } = await execFileAsync(invocation.executable, invocation.args, {
    encoding: "utf8",
    env: invocation.env,
    timeout: 5000,
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout.trim();
}

async function readGitStatus(projectPath) {
  try {
    const detected = await detectCommand("git");
    if (!detected.installed) {
      const error = new Error("Git executable not found");
      error.code = "ENOENT";
      throw error;
    }
    const root = await git(detected.path, projectPath, ["rev-parse", "--show-toplevel"]);
    const statusText = await git(detected.path, projectPath, ["status", "--porcelain=v2", "--branch"]);
    const lines = statusText.split(/\r?\n/).filter(Boolean);
    let branch = "DETACHED";
    let upstream = "";
    let ahead = 0;
    let behind = 0;
    const changes = [];

    for (const line of lines) {
      if (line.startsWith("# branch.head ")) branch = line.slice(14).trim();
      else if (line.startsWith("# branch.upstream ")) upstream = line.slice(18).trim();
      else if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      } else if (!line.startsWith("#")) {
        const parts = line.split(" ");
        const code = parts[0] === "?" ? "??" : parts[1] || "??";
        const file = parts[0] === "?" ? parts.slice(1).join(" ") : parts.slice(8).join(" ");
        changes.push({ code, file: file || line });
      }
    }

    let commits = [];
    try {
      const logText = await git(detected.path, projectPath, ["log", "-5", "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI"]);
      commits = logText
        ? logText.split(/\r?\n/).map((line) => {
            const [hash, shortHash, subject, author, date] = line.split("\x1f");
            return { hash, shortHash, subject, author, date };
          })
        : [];
    } catch {
      commits = [];
    }

    let branches = [];
    let tags = [];
    try {
      const branchText = await git(detected.path, projectPath, ["for-each-ref", "--format=%(refname:short)%00%(HEAD)", "refs/heads"]);
      branches = branchText ? branchText.split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, head] = line.split("\0");
        return { name, current: head === "*" };
      }) : [];
      if (!branches.length && branch && branch !== "DETACHED") branches = [{ name: branch, current: true }];
    } catch {}
    try {
      const tagText = await git(detected.path, projectPath, ["tag", "--sort=-creatordate", "-l"]);
      tags = tagText ? tagText.split(/\r?\n/).filter(Boolean).slice(0, 20) : [];
    } catch {}

    return {
      available: true,
      root,
      branch,
      upstream,
      ahead,
      behind,
      dirty: changes.length > 0,
      changes: changes.slice(0, 20),
      changeCount: changes.length,
      commits,
      branches,
      tags,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      available: false,
      error: error.code === "ENOENT" ? "Git executable not found" : "Not a readable Git repository",
      detail: String(error.message || error),
      checkedAt: new Date().toISOString(),
    };
  }
}

function validateRemoteUrl(value) {
  const url = String(value || "").trim();
  if (!url || /[\r\n\0]/.test(url)) throw new Error("远端地址不能为空且不能包含换行");
  if (!/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(url)) throw new Error("只支持 HTTPS、SSH 或 git@ 远端地址");
  if (/^https?:\/\/[^/]*@/i.test(url)) throw new Error("远端地址不能包含账号或令牌");
  return url;
}

async function setGitRemote(projectPath, remoteUrl, { name = "origin" } = {}) {
  const url = validateRemoteUrl(remoteUrl);
  const remoteName = String(name || "origin").trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) throw new Error("远端名称无效");
  const detected = await detectCommand("git");
  if (!detected.installed) throw new Error("Git executable not found");
  let exists = true;
  try { await git(detected.path, projectPath, ["remote", "get-url", remoteName]); } catch { exists = false; }
  if (exists) await git(detected.path, projectPath, ["remote", "set-url", remoteName, url]);
  else await git(detected.path, projectPath, ["remote", "add", remoteName, url]);
  return { name: remoteName, url };
}

module.exports = { readGitStatus, setGitRemote, validateRemoteUrl };
