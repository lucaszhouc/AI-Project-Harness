const test = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotCoordinator } = require("../electron/snapshot-coordinator.cjs");

test("64 concurrent snapshot requests share one projection", async () => {
  let builds = 0;
  const snapshot = createSnapshotCoordinator(async () => { builds += 1; await new Promise(resolve => setTimeout(resolve, 15)); return { sequence: builds }; });
  const results = await Promise.all(Array.from({ length: 64 }, () => snapshot()));
  assert.equal(builds, 1);
  assert.ok(results.every(result => result === results[0]));
  assert.equal((await snapshot()).sequence, 2);
});

test("a failed projection releases the queue", async () => {
  let builds = 0;
  const snapshot = createSnapshotCoordinator(async () => { if (++builds === 1) throw new Error("unavailable"); return "recovered"; });
  await assert.rejects(snapshot(), /unavailable/);
  assert.equal(await snapshot(), "recovered");
});

test("forced refreshes merge into one follow-up without losing either flag", async () => {
  const optionsSeen = [];
  const snapshot = createSnapshotCoordinator(async options => { optionsSeen.push(options); await new Promise(resolve => setTimeout(resolve, 15)); return options; });
  const normal = snapshot();
  const forced = Array.from({ length: 12 }, (_, index) => snapshot(index % 2 ? { forceGit: true } : { forceGithub: true }));
  await Promise.all([normal, ...forced]);
  assert.equal(optionsSeen.length, 2);
  assert.equal(optionsSeen[1].forceGit, true);
  assert.equal(optionsSeen[1].forceGithub, true);
});
