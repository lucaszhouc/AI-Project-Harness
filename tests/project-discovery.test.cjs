const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCodexProjectByName, selectCodexProjectRoot } = require("../electron/project-discovery.cjs");

const projects = [
  { id: "codex-aph-1", name: "AI Project Harness", roots: [{ path: "C:\\work\\AI-Project-Harness" }] },
  { id: "codex-local-2", name: "iva-local-chat", roots: [{ path: "C:\\work\\iva-local-chat" }] },
  { id: "codex-portfolio-3", name: "portfolio-layered-hero-2026-08-31", roots: [{ path: "E:\\site\\portfolio-layered-hero-2026-08-31" }] },
];

test("Codex project resolver uses only official project records and returns root", () => {
  const result = resolveCodexProjectByName({ name: "AI Projec Harnes", projects });
  assert.equal(result.project.id, "codex-aph-1");
  assert.equal(result.root.path, "C:\\work\\AI-Project-Harness");
  assert.equal(result.match.kind, "fuzzy");
  assert.ok(result.match.score >= 0.68);
});

test("Codex project resolver supports omitted separators, acronyms and Chinese names", () => {
  assert.equal(resolveCodexProjectByName({ name: "APH", projects }).project.id, "codex-aph-1");
  assert.equal(resolveCodexProjectByName({ name: "个人网站", projects }).project.id, "codex-portfolio-3");
  assert.equal(resolveCodexProjectByName({ name: "aiva local chat", projects }).project.id, "codex-local-2");
});

test("Codex project resolver rejects ambiguous near matches", () => {
  assert.throws(() => resolveCodexProjectByName({
    name: "demo project",
    projects: [
      { id: "demo-a", name: "Demo Project A", roots: [{ path: "C:\\a" }] },
      { id: "demo-b", name: "Demo Project B", roots: [{ path: "C:\\b" }] },
    ],
  }), /多个近似 Codex Project/);
});

test("Codex project resolver rejects low-confidence and empty indexes", () => {
  assert.throws(() => resolveCodexProjectByName({ name: "unrelated", projects }), /未能可靠定位 Codex Project/);
  assert.throws(() => resolveCodexProjectByName({ name: "anything", projects: [] }), /未找到 Codex Project/);
});

test("Codex project resolver does not require roots", () => {
  const result = resolveCodexProjectByName({ name: "No Root", projects: [{ id: "no-root", name: "No Root" }] });
  assert.equal(result.project.id, "no-root");
  assert.equal(result.root, null);
});

test("Codex root selection uses an exact semantic root and refuses unresolved multi-root Projects", () => {
  const multi = {
    id: "legacy-chat",
    name: "聊天",
    roots: [{ path: "E:\\_Codex项目\\聊天" }, { path: "E:\\Cloudflare\\my-workflow" }, { path: "E:\\_Codex项目\\账号运营" }],
  };
  assert.equal(selectCodexProjectRoot({ project: multi, query: "聊天", matchedName: "聊天" }), "E:\\_Codex项目\\聊天");
  assert.throws(() => selectCodexProjectRoot({
    project: { id: "amb", name: "Shared", roots: [{ path: "C:\\one" }, { path: "C:\\two" }] },
    query: "Shared",
    matchedName: "Shared",
  }), /多个根目录/);
  assert.throws(() => selectCodexProjectRoot({ project: multi, requestedPath: "C:\\wrong" }), /避免串库/);
});
