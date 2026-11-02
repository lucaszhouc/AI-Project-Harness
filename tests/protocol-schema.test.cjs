const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("versioned protocol schemas are present and valid JSON", () => {
  for (const file of ["harness-result.schema.json", "harness-import.schema.json", "harness-task-status.schema.json", "project-state-v1.schema.json"]) {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "protocol", file), "utf8"));
    assert.equal(parsed.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
});

test("harness import protocol carries source-linked knowledge candidates", () => {
  const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "protocol", "harness-import.schema.json"), "utf8"));
  const knowledge = parsed.properties.knowledge;
  assert.equal(knowledge.type, "object");
  assert.deepEqual(knowledge.required, ["rules", "playbooks"]);
  assert.equal(knowledge.properties.rules.items.$ref, "#/$defs/knowledgeRule");
  assert.equal(knowledge.properties.playbooks.items.$ref, "#/$defs/playbook");
  assert.equal(parsed.$defs.knowledgeSource.required.includes("evidenceId"), true);
  assert.equal(parsed.$defs.knowledgeSource.required.includes("quote"), true);
});
