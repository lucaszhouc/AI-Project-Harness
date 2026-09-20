const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { detectCommand, resolveCommandInvocation } = require("./command-runtime.cjs");

const execFileAsync = promisify(execFile);

async function runCommand(executable, args, timeout = 2500) {
  const invocation = resolveCommandInvocation(executable, args);
  const result = await execFileAsync(invocation.executable, invocation.args, {
    encoding: "utf8", env: invocation.env, timeout, windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

function parseRemote(remote) {
  if (!remote) return null;
  const value = String(remote).trim().replace(/[?#].*$/, "").replace(/\.git(?:\/)?$/, "").replace(/\/$/, "");
  const match = value.match(/(?:github\.com[/:])([^/ :]+)\/([^/]+)$/i);
  return match ? { owner: match[1], name: match[2], nameWithOwner: `${match[1]}/${match[2]}`, url: `https://github.com/${match[1]}/${match[2]}` } : null;
}

async function readGitHubStatus(projectPath, { detect = detectCommand, run = runCommand, includeDetails = false } = {}) {
  const checkedAt = new Date().toISOString();
  const result = { available: true, checkedAt, remote: null, repository: null, pullRequests: [], issues: [], detailsLoaded: Boolean(includeDetails), gh: { available: false } };
  try {
    const git = await detect("git");
    if (!git.installed) throw Object.assign(new Error("Git executable not found"), { code: "ENOENT" });
    await run(git.path, ["-C", projectPath, "rev-parse", "--git-dir"]);
    let remote = "";
    let remoteName = "origin";
    try { remote = await run(git.path, ["-C", projectPath, "config", "--get", "remote.origin.url"]); } catch {
      remoteName = "upstream";
      try { remote = await run(git.path, ["-C", projectPath, "config", "--get", "remote.upstream.url"]); } catch { remote = ""; }
    }
    result.remote = parseRemote(remote);
    if (result.remote) result.remoteName = remoteName;
    if (!result.remote) return result;
  } catch (error) {
    return { available: false, error: error.code === "ENOENT" ? "Git executable not found" : "Unable to read Git remote", detail: String(error.message || error), checkedAt };
  }

  try {
    const gh = await detect("gh");
    if (!gh.installed) return result;
    result.gh.available = true;
    try { await run(gh.path, ["auth", "status"], 1500); result.gh.authenticated = true; } catch { result.gh.authenticated = false; }
    if (!result.gh.authenticated || !includeDetails) return result;
    const repo = result.remote.nameWithOwner;
    const readJson = async (args) => JSON.parse(await run(gh.path, args));
    try { result.repository = await readJson(["repo", "view", repo, "--json", "nameWithOwner,description,url,defaultBranchRef"]); } catch (error) { result.gh.repoError = String(error.message || error); }
    try { result.pullRequests = await readJson(["pr", "list", "--repo", repo, "--limit", "5", "--json", "number,title,state,url,updatedAt"]); } catch (error) { result.gh.pullRequestError = String(error.message || error); }
    try { result.issues = await readJson(["issue", "list", "--repo", repo, "--limit", "5", "--json", "number,title,state,url,updatedAt"]); } catch (error) { result.gh.issueError = String(error.message || error); }
  } catch (error) {
    result.gh.error = String(error.message || error);
  }
  return result;
}

module.exports = { parseRemote, readGitHubStatus, runCommand };
