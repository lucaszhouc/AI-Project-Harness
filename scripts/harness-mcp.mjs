#!/usr/bin/env node
/* Minimal local MCP bridge. It deliberately speaks JSON-RPC over stdio and
 * keeps all transcript payloads on disk; only bounded JSON summaries cross the
 * agent boundary. */
import readline from "node:readline";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HarnessStore } = require("../electron/store.cjs");
const machine = require("../electron/state-machine.cjs");
const protocol = require("../electron/harness-protocol.cjs");
const archive = require("../electron/archive.cjs");

const root = path.resolve(process.env.APH_DATA_ROOT || (process.env.APH_USER_DATA ? process.env.APH_USER_DATA : "E:\\_Codex数据\\AI-Project-Harness"));
const store = new HarnessStore(path.join(root, "harness-state.json"), process.cwd(), { journalPath: path.join(root, "harness-state.jsonl"), contextRoot: root });

const MCP_LIST_LIMITS = { projects: 200, tasks: 100, sections: 50, archives: 100 };
function clip(value, max = 1000) {
  const text = String(value ?? "").replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function boundedTask(task) {
  return {
    id: clip(task?.id, 120), title: clip(task?.title, 600), status: clip(task?.status, 60),
    sectionId: clip(task?.sectionId, 120) || undefined, agent: clip(task?.agent, 60),
    workstream: clip(task?.workstream, 180),
    criteria: (Array.isArray(task?.criteria) ? task.criteria : []).slice(0, 12).map((item) => clip(item, 600)),
    dependsOn: (Array.isArray(task?.dependsOn) ? task.dependsOn : []).slice(0, 20).map((item) => clip(item, 120)),
  };
}

const tools = [
  { name: "list_projects", description: "列出 Harness 项目及其状态", inputSchema: { type: "object", properties: {} } },
  { name: "get_project_context", description: "读取有界项目上下文", inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "get_project_ledger", description: "返回动态项目白皮书路径与有界内容", inputSchema: { type: "object", properties: { projectId: { type: "string" }, maxChars: { type: "integer" } }, required: ["projectId"] } },
  { name: "list_archives", description: "列出项目 transcript 归档 manifest，不返回原文", inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "get_project_activity", description: "读取最近项目事件与 checkpoint", inputSchema: { type: "object", properties: { projectId: { type: "string" }, limit: { type: "integer" } }, required: ["projectId"] } },
  { name: "list_tasks", description: "列出项目未完成任务", inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "list_sections", description: "列出项目 Section 及其生命周期", inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "create_section", description: "创建可复用或一次性 Section", inputSchema: { type: "object", properties: { projectId: { type: "string" }, section: { type: "object" } }, required: ["projectId", "section"] } },
  { name: "assign_task", description: "把任务分配给指定 Section", inputSchema: { type: "object", properties: { projectId: { type: "string" }, taskId: { type: "string" }, sectionId: { type: "string" } }, required: ["projectId", "taskId", "sectionId"] } },
  { name: "set_project_status", description: "暂停、恢复或归档项目", inputSchema: { type: "object", properties: { projectId: { type: "string" }, status: { type: "string" } }, required: ["projectId", "status"] } },
  { name: "submit_task_result", description: "提交候选 Task Result，等待用户审核", inputSchema: { type: "object", properties: { projectId: { type: "string" }, taskId: { type: "string" }, result: { type: "object" } }, required: ["projectId", "taskId", "result"] } },
  { name: "record_agent_event", description: "写入一个有界 Agent 运行事件", inputSchema: { type: "object", properties: { projectId: { type: "string" }, taskId: { type: "string" }, event: { type: "object" } }, required: ["projectId", "taskId", "event"] } },
  { name: "propose_decision", description: "提出项目决策候选，不直接替用户拍板", inputSchema: { type: "object", properties: { projectId: { type: "string" }, decision: { type: "object" } }, required: ["projectId", "decision"] } },
  { name: "import_transcript", description: "将本地 transcript 内容寻址归档，不把全文返回给 Agent", inputSchema: { type: "object", properties: { projectId: { type: "string" }, filePath: { type: "string" } }, required: ["projectId", "filePath"] } },
];

function project(projectId) { return machine.getProject(store.state, String(projectId || store.state.selectedProjectId)); }
function response(id, result) { return { jsonrpc: "2.0", id, result }; }
function errorResponse(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

async function callTool(name, input = {}) {
  // MCP is a long-lived process. Refresh the in-memory view before every
  // request so UI/CLI writes made between calls are not hidden behind a stale
  // snapshot; mutating operations below use HarnessStore.update's lock-held
  // transaction path.
  store.reloadExternal();
  if (name === "list_projects") return store.state.projects.slice(0, MCP_LIST_LIMITS.projects).map((item) => ({ id: clip(item.id, 120), name: clip(item.name, 240), status: clip(item.status, 60), revision: Number(item.revision || 0) }));
  const projectId = String(input.projectId || store.state.selectedProjectId);
  const current = project(projectId);
  if (name === "get_project_context") return protocol.buildProjectContext(current);
  if (name === "get_project_ledger") {
    const ledgerPath = current.ledger?.path || path.join(root, "projects", current.id, "PROJECT-LEDGER.md");
    let content = "";
    try { content = require("node:fs").readFileSync(ledgerPath, "utf8").slice(0, Math.max(1000, Math.min(24000, Number(input.maxChars) || 12000))); } catch {}
    return { path: ledgerPath, content };
  }
  if (name === "list_archives") return archive.listArchiveManifests(root, { projectId: current.id }).slice(0, MCP_LIST_LIMITS.archives).map((item) => ({ id: clip(item.id, 120), sha256: clip(item.sha256, 80), bytes: Number(item.bytes || 0), format: clip(item.format, 40), importedAt: clip(item.importedAt, 80), objectPath: clip(item.objectPath, 800) }));
  if (name === "get_project_activity") return machine.getProjectActivity(current, { limit: input.limit });
  if (name === "list_tasks") return (Array.isArray(current.tasks) ? current.tasks : []).filter((task) => task.status !== "accepted").slice(0, MCP_LIST_LIMITS.tasks).map(boundedTask);
  if (name === "list_sections") return (Array.isArray(current.sections) ? current.sections : []).slice(0, MCP_LIST_LIMITS.sections).map((section) => ({ id: clip(section.id, 120), name: clip(section.name, 300), kind: clip(section.kind, 60), status: clip(section.status, 60), taskIds: (Array.isArray(section.taskIds) ? section.taskIds : []).slice(0, 30).map((item) => clip(item, 120)), useCount: Number(section.useCount || 0) }));
  if (name === "create_section") {
    let value;
    store.update((state) => { value = machine.createSection(state, projectId, input.section || {}); });
    return value;
  }
  if (name === "assign_task") {
    let value;
    store.update((state) => { value = machine.assignTaskToSection(state, projectId, input.taskId, input.sectionId); });
    return { taskId: value.id, sectionId: value.sectionId };
  }
  if (name === "set_project_status") {
    let value;
    store.update((state) => { value = machine.setProjectStatus(state, projectId, input.status); });
    return { projectId: value.id, status: value.status };
  }
  if (name === "submit_task_result") {
    let value;
    store.update((state) => { value = protocol.applyHarnessResult(state, projectId, input.taskId, input.result || {}); });
    return { taskId: value.id, status: value.status, review: value.review };
  }
  if (name === "record_agent_event") {
    let value;
    store.update((state) => { value = protocol.applyHarnessEvent(state, projectId, input.taskId, input.event || {}); });
    return { taskId: value.id, status: value.status, run: value.run };
  }
  if (name === "propose_decision") {
    let value;
    store.update((state) => { value = protocol.applyDecisionProposal(state, projectId, input.decision || {}); });
    return value;
  }
  if (name === "import_transcript") {
    const value = await archive.importTranscript(input.filePath, root, { projectId: current.id, maxBytes: Number(process.env.APH_MAX_TRANSCRIPT_BYTES || 0) });
    store.update((state) => {
      const target = machine.getProject(state, projectId);
      target.archiveManifests ||= [];
      if (!target.archiveManifests.some((item) => item.sha256 === value.manifest.sha256)) target.archiveManifests.unshift({ ...value.manifest, manifestPath: value.manifestPath });
      target.updatedAt = value.manifest.importedAt;
    });
    return { id: value.manifest.id, sha256: value.manifest.sha256, bytes: value.manifest.bytes, deduplicated: value.deduplicated };
  }
  throw new Error(`Unknown tool: ${name}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
input.on("line", (line) => { queue = queue.then(() => handleLine(line)).catch(() => {}); });

async function handleLine(line) {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const id = message.id;
  try {
    if (message.method === "initialize") process.stdout.write(`${JSON.stringify(response(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ai-project-harness", version: "1" } }))}\n`);
    else if (message.method === "notifications/initialized") return;
    else if (message.method === "tools/list") process.stdout.write(`${JSON.stringify(response(id, { tools }))}\n`);
    else if (message.method === "tools/call") {
      const value = await callTool(message.params?.name, message.params?.arguments || {});
      process.stdout.write(`${JSON.stringify(response(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }))}\n`);
    } else if (id !== undefined) process.stdout.write(`${JSON.stringify(errorResponse(id, -32601, `Method not found: ${message.method}`))}\n`);
  } catch (error) {
    if (id !== undefined) process.stdout.write(`${JSON.stringify(errorResponse(id, -32000, error instanceof Error ? error.message : String(error)))}\n`);
  }
}
