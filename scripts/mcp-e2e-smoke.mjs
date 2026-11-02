import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { callMcpControl } = require(path.join(root, "electron", "mcp-control.cjs"));
const electronExecutable = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-e2e-"));
const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aph-mcp-trusted-"));
const app = await electron.launch({
  executablePath: electronExecutable,
  args: [root],
  env: {
    ...process.env,
    APH_USER_DATA: userData,
    APH_HARNESS_TRUSTED_ROOT: trustedRoot,
    APH_TEST_WINDOW_HIDDEN: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  },
});

async function malformedRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.socket);
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("malformed request timed out")); }, 1_000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(Buffer.from("{bad-json}\n", "utf8")));
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
}

try {
  const page = await app.firstWindow();
  await app.evaluate(({ shell }) => {
    globalThis.aphTestDeepLinks = [];
    shell.openExternal = async uri => { globalThis.aphTestDeepLinks.push(uri); };
  });

  await page.locator(".app-shell").waitFor({ timeout: 15_000 });
  const endpointPath = path.join(userData, "mcp-control.json");
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(endpointPath) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!fs.existsSync(endpointPath)) throw new Error("MCP endpoint file was not created");
  const endpoint = JSON.parse(fs.readFileSync(endpointPath, "utf8"));
  const channels = await callMcpControl(endpoint, { id: "channels", method: "channels/list", params: {} });
  const blocked = channels.filter((channel) => channel.status === "blocked").map((channel) => channel.channel);
  const initial = await callMcpControl(endpoint, { id: "snapshot", method: "snapshot", params: {} });
  const created = await callMcpControl(endpoint, {
    id: "create",
    method: "channel/call",
    params: { channel: "project:create-blank", args: [{ name: "MCP Isolated E2E", goal: "MCP round trip" }] },
  });
  const projectId = created.projectId;
  const call = (channel, ...args) => callMcpControl(endpoint, {
    id: `case-${channel}`, method: 'channel/call', params: { channel, args },
  });
  const readLinks = () => app.evaluate(() => globalThis.aphTestDeepLinks);
  const initialLinks = await readLinks();
  assert.equal(initialLinks.filter(uri => new URL(uri).searchParams.get('prompt')?.includes('SESSION_ROLE:')).length, 2);
  await call('project:attach-control-thread', projectId, 'review', { threadId: 'isolated-review', externalProjectId: 'isolated-desktop-project' });
  const attached = await call('project:attach-control-thread', projectId, 'review', { threadId: 'isolated-review', externalProjectId: 'isolated-desktop-project' });
  assert.equal(attached.verified, false);
  assert.equal(attached.snapshot.state.projects.find(p => p.id === projectId).sessions.find(s => s.role === 'review').externalThreadStatus, 'bound');
  await assert.rejects(() => call('project:attach-control-thread', projectId, 'review', { threadId: 'isolated-review', externalProjectId: 'wrong-project' }), /PROJECT_MISMATCH/);
  await assert.rejects(() => call('project:attach-control-thread', projectId, 'cto', {}), /threadId/);
  await call('project:sync-codex', projectId);
  assert.ok((await readLinks()).some(uri => uri === 'codex://threads/isolated-review'));

  // Exercise the actual create/connect -> initialize -> writeback -> Accept -> controls handlers.
  const existingPath = path.join(trustedRoot, 'existing-workspace');
  fs.mkdirSync(existingPath); fs.writeFileSync(path.join(existingPath, 'README.md'), 'existing workspace');
  const beforeInitLinks = (await readLinks()).length;
  const existing = await call('project:create-connected', { name: 'Existing fixture', path: existingPath });
  assert.equal(existing.initializationRequired, true);
  let initializedProject = existing.snapshot.state.projects.find(p => p.id === existing.projectId);
  const initialization = initializedProject.tasks.find(t => t.workstream === 'project-onboarding');
  assert.equal(initialization.run.status, 'awaiting_user');
  const initializationId = initialization.run.id;
  assert.ok(initialization.run.userPrompt.includes(initializationId));
  assert.ok(!(await readLinks()).slice(beforeInitLinks).some(uri => new URL(uri).searchParams.get('prompt')?.includes('SESSION_ROLE:')));
  const retry = await call('project:connect-codex', existing.projectId, {});
  initializedProject = retry.snapshot.state.projects.find(p => p.id === existing.projectId);
  assert.equal(initializedProject.tasks.length, 1);
  assert.equal(initializedProject.tasks[0].run.id, initializationId);
  await call('task:submit-result', existing.projectId, initialization.id, {
    summary: 'Isolated initialization result', completed: ['Read fixture README'], remaining: [], nextStep: 'Open control drafts',
    evidence: [{ type: 'file', value: path.join(existingPath, 'README.md') }],
  });
  const beforeAccept = (await readLinks()).length;
  const accepted = await call('task:accept', existing.projectId, initialization.id);
  assert.equal(accepted.standardControls.opened.length, 2);
  assert.ok(accepted.standardControls.opened.every(item => item.requested && !item.verified));
  const afterAcceptLinks = (await readLinks()).slice(beforeAccept);
  assert.match(new URL(afterAcceptLinks[0]).searchParams.get('prompt'), /SESSION_ROLE: review/);
  assert.match(new URL(afterAcceptLinks[1]).searchParams.get('prompt'), /SESSION_ROLE: cto/);
  initializedProject = accepted.state.projects.find(p => p.id === existing.projectId);
  assert.match(fs.readFileSync(initializedProject.contextPackets.cto.path, 'utf8'), /Isolated initialization result/);
  await call('project:remove', existing.projectId, 'Isolated onboarding cleanup');
  const updated = await callMcpControl(endpoint, {
    id: "update",
    method: "channel/call",
    params: { channel: "project:update-contract", args: [projectId, { goal: "MCP round trip updated" }] },
  });
  const afterMutation = await callMcpControl(endpoint, { id: "snapshot2", method: "snapshot", params: {} });
  const activity = await callMcpControl(endpoint, {
    id: "activity",
    method: "channel/call",
    params: { channel: "project:activity", args: [projectId, 20] },
  });
  const blockedImport = await callMcpControl(endpoint, {
    id: "blocked-import",
    method: "channel/call",
    params: { channel: "project:import-codex", args: [{ name: "blocked" }] },
  }).then(() => "unexpected-success").catch((error) => String(error.message));
  const badToken = await callMcpControl({ ...endpoint, token: "bad" }, { id: "bad-token", method: "channels/list", params: {} })
    .then(() => "unexpected-success").catch((error) => String(error.message));
  const malformed = await malformedRequest(endpoint);
  await callMcpControl(endpoint, { id: "remove", method: "channel/call", params: { channel: "project:remove", args: [projectId, "MCP E2E cleanup"] } });
  const finalSnapshot = await callMcpControl(endpoint, { id: "final", method: "snapshot", params: {} });
  const report = {
    desktopBoundary: "intercepted; no live Desktop creation verified",
    channelCount: channels.length,
    exercised: ['blank control drafts', 'attach and duplicate attach', 'wrong project', 'empty thread id', 'sync bound thread', 'nonempty initialization', 'retry same run', 'result and Accept', 'persisted context before role drafts'],
    blocked,
    initialProjectCount: initial.state?.projects?.length || 0,
    createdProjectId: projectId,
    updateRevision: updated?.snapshot?.state?.projects?.find((project) => project.id === projectId)?.revision,
    afterMutationProjectCount: afterMutation.state?.projects?.length || 0,
    activityCount: Array.isArray(activity) ? activity.length : undefined,
    blockedImport,
    badToken,
    malformed,
    finalProjectCount: finalSnapshot.state?.projects?.length || 0,
    isolatedWorkspace: trustedRoot,
  };
  if (!blocked.includes("project:import-codex") || !/Desktop 原生接口/.test(blockedImport) || !/token/i.test(badToken) || malformed.error !== "Invalid JSON request") {
    throw new Error(`MCP E2E assertions failed: ${JSON.stringify(report)}`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: mcp-e2e\n`);
} finally {
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(trustedRoot, { recursive: true, force: true });
}
