const test = require("node:test");
const assert = require("node:assert/strict");

const { COPY, getCopy, validateCopyParity, CONTROL_REGISTRY } = require("../src/guide-copy.mjs");

test("core first-run copy has complete bilingual parity", () => {
  assert.deepEqual(validateCopyParity(COPY), []);
  assert.equal(getCopy("zh-CN", "guide.createBlank"), "新建项目");
  assert.equal(getCopy("en", "guide.createBlank"), "Create blank project");
});

test("Chinese guide copy reads like product language instead of an implementation spec", () => {
  const chinese = Object.values(COPY).map((entry) => entry["zh-CN"]).join("\n");
  assert.doesNotMatch(chinese, /事务|持久状态|已登记|probe|turn/i);
});

test("control registry covers irreversible meaning and stable guide targets", () => {
  for (const id of ["project.create-blank", "project.import-registered", "project.connect", "task.dispatch", "review.accept", "review.reject"]) {
    const entry = CONTROL_REGISTRY[id];
    assert.ok(entry, id);
    assert.ok(entry.guideTarget);
    assert.ok(entry.labels["zh-CN"]);
    assert.ok(entry.labels.en);
    assert.ok(entry.successEvidence);
  }
});
