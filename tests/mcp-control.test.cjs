const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMcpControlServer, readControlEndpoint, callMcpControl } = require("../electron/mcp-control.cjs");

test("MCP control server exposes authenticated channels and rejects a bad token", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-control-"));
  const server = createMcpControlServer({
    dataRoot: root,
    handlers: new Map([["harness:snapshot", async () => ({ revision: 4 })]]),
    channelMeta: new Map([["harness:snapshot", { permission: "read", description: "snapshot" }]]),
    snapshot: async () => ({ revision: 4 }),
  });
  try {
    await server.start();
    const endpoint = readControlEndpoint(root);
    assert.equal(endpoint.pid, process.pid);
    assert.deepEqual(await callMcpControl(endpoint, { id: "1", method: "channels/list", params: {} }), [{ channel: "harness:snapshot", permission: "read", description: "snapshot" }]);
    assert.deepEqual(await callMcpControl(endpoint, { id: "2", method: "channel/call", params: { channel: "harness:snapshot", args: [] } }), { revision: 4 });
    await assert.rejects(() => callMcpControl({ ...endpoint, token: "bad" }, { id: "3", method: "channels/list", params: {} }), /token/i);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP control server returns a protocol error for malformed JSON", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-malformed-"));
  const server = createMcpControlServer({ dataRoot: root });
  try {
    await server.start();
    const endpoint = readControlEndpoint(root);
    const response = await new Promise((resolve, reject) => {
      const socket = require("node:net").createConnection(endpoint.socket);
      let buffer = "";
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("malformed request timed out")); }, 1000);
      socket.setEncoding("utf8");
      socket.on("connect", () => socket.write("{bad-json}\n"));
      socket.on("data", (chunk) => {
        buffer += chunk;
        const index = buffer.indexOf("\n");
        if (index < 0) return;
        clearTimeout(timer);
        socket.destroy();
        resolve(JSON.parse(buffer.slice(0, index)));
      });
      socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    assert.equal(response.id, null);
    assert.match(response.error, /Invalid JSON/);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP discovery rejects stale endpoints and preserves a live owner", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-stale-"));
  const endpointPath = path.join(root, "mcp-control.json");
  fs.writeFileSync(endpointPath, JSON.stringify({ socket: "\\\\.\\pipe\\stale", token: "stale", pid: 999999 }), "utf8");
  assert.equal(readControlEndpoint(root), undefined);
  const first = createMcpControlServer({ dataRoot: root });
  const second = createMcpControlServer({ dataRoot: root });
  try {
    await first.start();
    await assert.rejects(() => second.start(), /already active/i);
    assert.equal(readControlEndpoint(root).pid, process.pid);
  } finally {
    first.close();
    second.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
