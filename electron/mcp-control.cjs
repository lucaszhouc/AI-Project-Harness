const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");

function resolveControlEndpoint(dataRoot) {
  const root = path.resolve(String(dataRoot || ""));
  const hash = crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 20);
  const socket = process.platform === "win32"
    ? `\\\\.\\pipe\\ai-project-harness-mcp-${hash}`
    : path.join(root, "mcp-control.sock");
  return { root, socket, file: path.join(root, "mcp-control.json") };
}

function safeJson(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return { error: "MCP response is not JSON serializable" }; }
}

function isProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function createMcpControlServer({ dataRoot, handlers = new Map(), channelMeta = new Map(), snapshot = async () => undefined } = {}) {
  const endpoint = resolveControlEndpoint(dataRoot);
  const token = crypto.randomBytes(24).toString("hex");
  let server;
  const sockets = new Set();
  const writeEndpoint = () => {
    fs.mkdirSync(endpoint.root, { recursive: true });
    fs.writeFileSync(endpoint.file, `${JSON.stringify({
      version: 1,
      protocol: "ai-project-harness-control/1",
      socket: endpoint.socket,
      token,
      pid: process.pid,
      channels: [...channelMeta.entries()].map(([channel, meta]) => ({ channel, ...meta })),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
  };
  const cleanup = () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    try { server?.close(); } catch {}
    let ownsEndpoint = false;
    try {
      const current = JSON.parse(fs.readFileSync(endpoint.file, "utf8"));
      ownsEndpoint = current?.token === token && Number(current?.pid) === process.pid;
    } catch {}
    if (ownsEndpoint) {
      try { if (fs.existsSync(endpoint.file)) fs.rmSync(endpoint.file, { force: true }); } catch {}
      if (process.platform !== "win32") { try { fs.rmSync(endpoint.socket, { force: true }); } catch {} }
    }
  };
  const dispatch = async (request) => {
    if (!request || request.token !== token) throw new Error("MCP control token invalid");
    if (request.method === "snapshot") return snapshot();
    if (request.method !== "channels/list") {
      if (request.method !== "channel/call") throw new Error(`Unknown control method: ${request.method}`);
      const channel = String(request.params?.channel || "");
      const handler = handlers.get(channel);
      if (typeof handler !== "function") throw new Error(`IPC channel is unavailable: ${channel}`);
      const args = Array.isArray(request.params?.args) ? request.params.args : [];
      const sender = { isDestroyed: () => false, send: () => {} };
      return handler({ sender }, ...args);
    }
    return [...channelMeta.entries()].map(([channel, meta]) => ({ channel, ...meta }));
  };
  const writeResponse = (socket, response) => {
    if (socket.destroyed) return;
    try { socket.write(`${JSON.stringify(response)}\n`); } catch {}
  };
  server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let request;
        try { request = JSON.parse(line); }
        catch {
          writeResponse(socket, { id: null, error: "Invalid JSON request" });
          continue;
        }
        Promise.resolve().then(() => dispatch(request)).then((result) => {
          writeResponse(socket, { id: request.id, result: safeJson(result) });
        }).catch((error) => {
          writeResponse(socket, { id: request.id, error: String(error?.message || error) });
        });
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  return {
    endpoint,
    token,
    start() {
      const existing = readControlEndpoint(endpoint.root);
      if (existing?.socket === endpoint.socket) {
        return Promise.reject(new Error("Harness MCP control endpoint already active"));
      }
      writeEndpoint();
      return new Promise((resolve, reject) => {
        const onError = (error) => { cleanup(); reject(error); };
        server.once("error", onError);
        server.listen(endpoint.socket, () => { server.removeListener("error", onError); resolve(endpoint); });
      });
    },
    close() { cleanup(); },
  };
}

function readControlEndpoint(dataRoot) {
  const endpoint = resolveControlEndpoint(dataRoot);
  try {
    const value = JSON.parse(fs.readFileSync(endpoint.file, "utf8"));
    if (!value?.socket || !value?.token || !Number.isFinite(Number(value.pid)) || !isProcessAlive(value.pid)) return undefined;
    return value;
  } catch { return undefined; }
}

function callMcpControl(endpoint, request, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.socket);
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Harness MCP 实时控制连接超时")); }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...request, token: endpoint.token })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      clearTimeout(timer); socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, index));
        if (response.error) reject(new Error(response.error)); else resolve(response.result);
      } catch (error) { reject(error); }
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

module.exports = { resolveControlEndpoint, createMcpControlServer, readControlEndpoint, callMcpControl };
