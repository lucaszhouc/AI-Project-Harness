const test = require("node:test");
const assert = require("node:assert/strict");

const { nextGuideRecommendation, reconcileGuideState } = require("../electron/guide-orchestrator.cjs");
const { createGuideState } = require("../electron/guide-state.cjs");

test("no project recommends local blank creation even when Codex is missing", () => {
  const result = nextGuideRecommendation({ projects: [], probes: { "codex-cli": { status: "missing" } } });
  assert.equal(result.stepId, "project");
  assert.equal(result.actionId, "project.create-blank");
  assert.equal(result.blocking, false);
});

test("guide completion evidence is derived from durable ids and current sequence", () => {
  const guide = createGuideState();
  const facts = { selectedProjectId: "p1", projects: [{ id: "p1", revision: 3, status: "active", tasks: [{ id: "t1", status: "ready", run: undefined }] }], sequence: 9 };
  reconcileGuideState(guide, facts);
  assert.equal(guide.sequence, 9);
  assert.ok(guide.completionEvidence.some((item) => item.stepId === "project" && item.projectId === "p1" && item.sequence === 9));
  assert.ok(guide.completionEvidence.some((item) => item.stepId === "task-created" && item.taskId === "t1"));
  assert.equal(guide.steps.project.status, "completed");
});

test("ready task is never treated as dispatched", () => {
  const result = nextGuideRecommendation({ projects: [{ id: "p1", status: "active", tasks: [{ id: "t1", status: "ready" }] }], selectedProjectId: "p1" });
  assert.equal(result.stepId, "task");
  assert.equal(result.actionId, "task.dispatch");
  assert.equal(result.completionEvidence, undefined);
});

test("review and archived project recommendations preserve human and restore gates", () => {
  const review = nextGuideRecommendation({ projects: [{ id: "p1", status: "active", tasks: [{ id: "t1", status: "review", reviewMode: "user" }] }], selectedProjectId: "p1" });
  assert.equal(review.actionId, "review.open");
  assert.match(review.reasonKey, /human/);
  const archived = nextGuideRecommendation({ projects: [{ id: "p1", status: "archived", tasks: [] }], selectedProjectId: "p1" });
  assert.equal(archived.actionId, "project.restore");
  assert.equal(archived.blocking, true);
});
