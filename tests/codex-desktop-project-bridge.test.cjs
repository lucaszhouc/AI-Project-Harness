const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  LIVE_PROJECT_REMOVAL_UNAVAILABLE,
  LIVE_PROJECT_REMOVAL_UNVERIFIED,
  LIVE_PROJECT_VISIBILITY_UNAVAILABLE,
  LIVE_PROJECT_VISIBILITY_UNVERIFIED,
  createDesktopProjectBridge,
  removeLocalProjectLive,
  verifyLocalProjectLive,
  readLegacyLocalProjects,
} = require("../electron/codex-desktop-project-bridge.cjs");

test("live local project removal requires an injected Desktop control plane", async () => {
  await assert.rejects(
    () => removeLocalProjectLive({ projectId: "smoke-project" }),
    (error) => error.code === LIVE_PROJECT_REMOVAL_UNAVAILABLE,
  );
});

test("live local project removal verifies the in-memory project list after mutation", async () => {
  const calls = [];
  const bridge = createDesktopProjectBridge({
    removeLocal: async (projectId) => { calls.push(projectId); return { previousMemberships: [] }; },
    listLocalProjects: async () => [],
  });
  const result = await removeLocalProjectLive({ bridge, projectId: "smoke-project" });
  assert.equal(result.removed, true);
  assert.equal(result.verified, true);
  assert.deepEqual(calls, ["smoke-project"]);
});

test("live local project removal rejects a stale Desktop list", async () => {
  const bridge = createDesktopProjectBridge({
    removeLocal: async () => ({ previousMemberships: [] }),
    listLocalProjects: async () => [{ id: "smoke-project" }],
  });
  await assert.rejects(
    () => removeLocalProjectLive({ bridge, projectId: "smoke-project" }),
    (error) => error.code === LIVE_PROJECT_REMOVAL_UNVERIFIED,
  );
});

test("live project visibility requires an injected Desktop list, never compatibility JSON", async () => {
  const bridge = createDesktopProjectBridge({
    listLocalProjects: async () => [{ id: "live-project", name: "APH/Smoke" }],
  });
  const result = await verifyLocalProjectLive({ bridge, projectId: "live-project" });
  assert.equal(result.visible, true);
  assert.equal(result.verified, true);
  await assert.rejects(
    () => verifyLocalProjectLive({ bridge, projectId: "missing-project" }),
    (error) => error.code === LIVE_PROJECT_VISIBILITY_UNVERIFIED,
  );
});

test("project visibility reports unavailable when Desktop has no live control plane", async () => {
  const bridge = createDesktopProjectBridge();
  await assert.rejects(
    () => verifyLocalProjectLive({ bridge, projectId: "smoke-project" }),
    (error) => error.code === LIVE_PROJECT_VISIBILITY_UNAVAILABLE,
  );
});

test("legacy local project discovery is disabled and never reads compatibility JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-live-project-bridge-"));
  try {
    const statePath = path.join(root, ".codex-global-state.json");
    fs.writeFileSync(statePath, JSON.stringify({
      "local-projects": {
        smoke: { id: "smoke", name: "APH smoke", rootPaths: [path.join(root, "aph-real-smoke")] },
        formal: { id: "formal", name: "formal-project", rootPaths: ["C:\\fixture\\formal-project"] },
      },
    }));
    const projects = readLegacyLocalProjects({ filePath: statePath });
    assert.deepEqual(projects, []);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8"))["local-projects"].smoke.name, "APH smoke");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
