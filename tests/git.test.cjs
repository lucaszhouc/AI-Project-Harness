const test = require("node:test");
const assert = require("node:assert/strict");
const { readGitStatus, setGitRemote, validateRemoteUrl } = require("../electron/git.cjs");
const { parseRemote, readGitHubStatus } = require("../electron/github.cjs");

test("Git and GitHub external CLI surfaces are disabled", async () => {
  const git = await readGitStatus("C:\\fixture");
  const github = await readGitHubStatus("C:\\fixture");
  assert.equal(git.available, false);
  assert.equal(git.code, "CLI_DISABLED");
  assert.equal(github.available, false);
  assert.equal(github.code, "CLI_DISABLED");
  await assert.rejects(() => setGitRemote("C:\\fixture", "https://github.com/acme/demo.git"), (error) => error.code === "CLI_DISABLED");
});

test("remote validation and parsing stay local and side-effect free", () => {
  assert.equal(validateRemoteUrl("git@github.com:acme/demo.git"), "git@github.com:acme/demo.git");
  assert.deepEqual(parseRemote("git@github.com:acme/demo.git"), { owner: "acme", name: "demo", nameWithOwner: "acme/demo", url: "https://github.com/acme/demo" });
});
