const test = require("node:test");
const assert = require("node:assert/strict");
const { platformCapabilities } = require("../electron/platform.cjs");

test("platform adapter makes Windows first-class and keeps macOS explicit", () => {
  assert.equal(platformCapabilities("win32").status, "首发");
  assert.equal(platformCapabilities("win32").commandShim, true);
  assert.equal(platformCapabilities("darwin").status, "适配中");
  assert.equal(platformCapabilities("linux").status, "未承诺");
});
