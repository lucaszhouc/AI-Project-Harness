const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("getting-started guide has no FAQ or model-backed question surface", () => {
  const rendered = read("src/guide-view.mjs");
  const renderer = read("src/main.ts");
  const preload = read("electron/preload.cjs");
  const main = read("electron/main.cjs");

  for (const source of [rendered, renderer, preload, main]) {
    assert.doesNotMatch(source, /guide-faq|guideAsk|guide:ask|semanticOptIn|createSemanticAssistant|askCodexSemanticQuestion/);
  }
});

test("public help does not promise FAQ or semantic model access", () => {
  const publicDocs = [
    "README.md",
    "README.zh-CN.md",
    "docs/security-and-privacy.md",
    "docs/guide/troubleshooting.en.md",
    "docs/guide/troubleshooting.zh-CN.md",
  ].map(read).join("\n");

  assert.doesNotMatch(publicDocs, /\bFAQ\b|semantic help|semantic explanation|语义帮助|语义解释/i);
});
