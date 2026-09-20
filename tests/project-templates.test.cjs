const test = require("node:test");
const assert = require("node:assert/strict");
const sm = require("../electron/state-machine.cjs");
const { listTemplates, applyProjectTemplate } = require("../electron/project-templates.cjs");

test("built-in templates are explicit and idempotent", () => {
  const state = sm.createInitialState("C:\\work\\template");
  const project = state.projects[0];
  project.tasks = [];
  assert.ok(listTemplates().some((item) => item.id === "web"));
  applyProjectTemplate(state, project.id, "web");
  const count = project.tasks.length;
  applyProjectTemplate(state, project.id, "web");
  assert.equal(project.tasks.length, count);
  assert.equal(project.templateId, "web");
  assert.ok(project.techStack.includes("TypeScript"));
});
