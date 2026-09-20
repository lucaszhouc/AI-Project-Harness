const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("versioned protocol schemas are present and valid JSON", () => {
  for (const file of ["harness-result.schema.json", "harness-import.schema.json", "project-state-v1.schema.json"]) {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "protocol", file), "utf8"));
    assert.equal(parsed.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
});
