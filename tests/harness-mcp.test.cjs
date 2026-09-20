const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const machine = require("../electron/state-machine.cjs");
const { HarnessStore } = require("../electron/store.cjs");

test("local MCP bridge answers initialize, tools/list and bounded project context", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-"));
  const child = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "harness-mcp.mjs")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, APH_DATA_ROOT: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const responses = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { responses.push(JSON.parse(line)); } catch {}
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  child.kill();
  assert.equal(responses.find((item) => item.id === 1)?.result?.serverInfo?.name, "ai-project-harness");
  assert.ok(responses.find((item) => item.id === 2)?.result?.tools?.some((item) => item.name === "get_project_context"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("MCP list endpoints keep long project collections bounded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-bounds-"));
  try {
    const store = new HarnessStore(path.join(root, "harness-state.json"), root, { contextRoot: root });
    const project = store.state.projects[0];
    project.tasks = [];
    for (let index = 0; index < 135; index += 1) {
      machine.createTask(store.state, project.id, { title: `任务 ${index}`, criteria: "x".repeat(2000) });
    }
    store.write();
    const child = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "harness-mcp.mjs")], {
      cwd: path.join(__dirname, ".."), env: { ...process.env, APH_DATA_ROOT: root }, stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    const responses = new Map();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try { const value = JSON.parse(line); if (value.id !== undefined) responses.set(value.id, value); } catch {}
      }
    });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_tasks", arguments: { projectId: project.id } } });
    const deadline = Date.now() + 3000;
    while (!responses.has(2) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(responses.has(2), "MCP list_tasks response did not arrive");
    const payload = JSON.parse(responses.get(2).result.content[0].text);
    assert.equal(payload.length, 100);
    assert.ok(payload.every((task) => task.criteria.every((item) => item.length <= 600)));
    child.kill();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
