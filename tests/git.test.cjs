const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readGitStatus, setGitRemote, validateRemoteUrl } = require("../electron/git.cjs");
const { parseRemote, readGitHubStatus } = require("../electron/github.cjs");

test("GitHub remote parser supports HTTPS and SSH remotes", () => {
  assert.deepEqual(parseRemote("https://github.com/acme/harness.git").nameWithOwner, "acme/harness");
  assert.deepEqual(parseRemote("git@github.com:acme/harness.git").url, "https://github.com/acme/harness");
  assert.deepEqual(parseRemote("ssh://git@github.com/acme/harness.git/").nameWithOwner, "acme/harness");
  assert.equal(parseRemote("https://gitlab.com/acme/harness"), null);
});

test("GitHub reader exposes remote and remains usable without gh authentication", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-gh-"));
  execFileSync("git", ["-C", tempRoot, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", tempRoot, "remote", "add", "origin", "git@github.com:acme/harness.git"], { stdio: "ignore" });
  const status = await readGitHubStatus(tempRoot);
  assert.equal(status.available, true);
  assert.equal(status.remote.nameWithOwner, "acme/harness");
  assert.equal(typeof status.gh.available, "boolean");
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("GitHub reader loads repository, PR and issue summaries only on explicit detail refresh", async () => {
  const calls = [];
  const detect = async (name) => ({ installed: true, path: name });
  const run = async (executable, args) => {
    calls.push([executable, args]);
    if (executable === "git") return "https://github.com/acme/demo.git";
    if (args[0] === "auth") return "authenticated";
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "acme/demo", description: "demo" });
    if (args[0] === "pr") return JSON.stringify([{ number: 1, title: "Fix", state: "OPEN" }]);
    if (args[0] === "issue") return JSON.stringify([{ number: 2, title: "Bug", state: "OPEN" }]);
    return "";
  };
  const light = await readGitHubStatus("C:\\demo", { detect, run });
  assert.equal(light.detailsLoaded, false);
  assert.equal(light.pullRequests.length, 0);
  const full = await readGitHubStatus("C:\\demo", { detect, run, includeDetails: true });
  assert.equal(full.detailsLoaded, true);
  assert.equal(full.pullRequests[0].number, 1);
  assert.equal(full.issues[0].number, 2);
  assert.ok(calls.some(([, args]) => args[0] === "pr"));
});

test("GitHub reader distinguishes a valid non-GitHub repository from a non-repository", async () => {
  const detect = async () => ({ installed: true, path: "git" });
  const valid = await readGitHubStatus("C:\\repo", { detect, run: async (_exe, args) => {
    if (args.includes("rev-parse")) return ".git";
    throw new Error("no remote");
  } });
  assert.equal(valid.available, true);
  assert.equal(valid.remote, null);
  const invalid = await readGitHubStatus("C:\\missing", { detect, run: async () => { throw new Error("not a repo"); } });
  assert.equal(invalid.available, false);
});

test("Git remote connector validates and persists an origin without shell interpolation", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-remote-"));
  execFileSync("git", ["-C", tempRoot, "init", "-b", "main"], { stdio: "ignore" });
  assert.equal(validateRemoteUrl("git@github.com:acme/demo.git"), "git@github.com:acme/demo.git");
  await setGitRemote(tempRoot, "https://github.com/acme/demo.git");
  await setGitRemote(tempRoot, "git@github.com:acme/demo.git");
  assert.equal(execFileSync("git", ["-C", tempRoot, "remote", "get-url", "origin"], { encoding: "utf8" }).trim(), "git@github.com:acme/demo.git");
  assert.throws(() => validateRemoteUrl("https://example.com/a\n--upload-pack=bad"), /换行/);
  assert.throws(() => validateRemoteUrl("https://token@github.com/acme/demo.git"), /令牌/);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("non-git directory reports an explicit unavailable state", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-no-git-"));
  const status = await readGitStatus(tempRoot);
  assert.equal(status.available, false);
  assert.equal(status.error, "Not a readable Git repository");
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("git reader reports a real dirty worktree", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-git-"));
  execFileSync("git", ["-C", tempRoot, "init", "-b", "codex/test-fixture"], { stdio: "ignore" });
  fs.writeFileSync(path.join(tempRoot, "proof.txt"), "evidence\n", "utf8");
  const status = await readGitStatus(tempRoot);
  assert.equal(status.available, true);
  assert.equal(status.branch, "codex/test-fixture");
  assert.equal(status.dirty, true);
  assert.ok(Array.isArray(status.branches));
  assert.ok(status.changeCount >= 1);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("git reader supports a Windows cmd shim when no git.exe is on PATH", {
  skip: process.platform !== "win32",
}, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-git-cmd-"));
  const projectRoot = path.join(tempRoot, "project %&! (alpha)");
  const fakeGit = path.join(tempRoot, "fake-git.cjs");
  const shim = path.join(tempRoot, "git.cmd");
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(fakeGit, [
    "const args = process.argv.slice(2);",
    "const operation = args[2];",
    "if (operation === 'rev-parse') process.stdout.write(process.env.APH_FAKE_GIT_ROOT);",
    "else if (operation === 'status') process.stdout.write('# branch.head shim-main\\n');",
    "else if (operation === 'log') process.stdout.write('');",
    "else process.exitCode = 2;",
  ].join("\n"));
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0fake-git.cjs" %*\r\n`);

  const previousPath = process.env.Path;
  const previousFakeRoot = process.env.APH_FAKE_GIT_ROOT;
  process.env.Path = `${tempRoot};${process.env.SystemRoot}\\System32`;
  process.env.APH_FAKE_GIT_ROOT = projectRoot;
  try {
    const status = await readGitStatus(projectRoot);
    assert.equal(status.available, true);
    assert.equal(status.root, projectRoot);
    assert.equal(status.branch, "shim-main");
  } finally {
    process.env.Path = previousPath;
    if (previousFakeRoot === undefined) delete process.env.APH_FAKE_GIT_ROOT;
    else process.env.APH_FAKE_GIT_ROOT = previousFakeRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
