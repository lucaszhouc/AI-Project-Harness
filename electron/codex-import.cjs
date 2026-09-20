const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const protocol = require("./harness-protocol.cjs");
const machine = require("./state-machine.cjs");
const { scoreProjectName, foldProjectName } = require("./project-discovery.cjs");

const IMPORT_MAX_CHARS = 24000;
const IMPORT_CONTEXT_MAX_CHARS = 15000;
// Agents occasionally use the generic `json` fence even when the payload
// itself carries the protocol discriminator. Accept that harmless spelling
// while still requiring type=harness-import during validation below.
const IMPORT_BLOCK = /```(?:harness-import|json)\s*([\s\S]*?)```/gi;
const TASK_STATUSES = new Set(["backlog", "ready", "in_progress", "awaiting_result", "review", "changes_requested", "accepted", "failed"]);
const SECTION_KINDS = new Set(["main", "reusable", "one-shot"]);

function clip(value, max = 800) {
  const text = String(value ?? "")
    .replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]")
    .replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function list(value, max, itemMax = 800) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => clip(item, itemMax)).filter(Boolean);
}

function comparablePath(value) {
  return String(value || "").replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

/** Build a bounded, high-confidence index of existing Codex conversations
 * related to the selected official Project. The index uses app-server facts
 * (official projectId, root, conversation name/preview, updatedAt), never a
 * directory mtime. Raw rollout bytes are archived separately by the caller. */
function selectCodexProjectThreads(threads, { project, query, matchedName, limit = 100 } = {}) {
  const officialId = String(project?.id || "");
  const roots = (Array.isArray(project?.roots) ? project.roots : [])
    .map((entry) => typeof entry === "string" ? entry : entry?.path)
    .map(comparablePath)
    .filter(Boolean);
  const names = [...new Set([query, matchedName, project?.name].map((value) => String(value || "").trim()).filter(Boolean))];
  const ranked = [];
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (!thread || !thread.id || thread.ephemeral) continue;
    const cwd = comparablePath(thread.cwd);
    const projectIdMatch = Boolean(officialId && String(thread.projectId || "") === officialId);
    const rootMatch = Boolean(cwd && roots.some((root) => cwd === root || cwd.startsWith(`${root}/`)));
    const title = String(thread.name || "").trim();
    const preview = String(thread.preview || "").trim();
    if (/Harness\s+导入/i.test(title) || /#\s*AI Project Harness\s*·\s*IMPORT PACKET/i.test(preview)) continue;
    const titleScore = names.reduce((best, name) => Math.max(best, scoreProjectName(name, title).score), 0);
    const previewFolded = foldProjectName(preview.slice(0, 1200));
    const previewMatch = names.some((name) => {
      const folded = foldProjectName(name);
      return folded.length >= 3 && previewFolded.includes(folded);
    });
    const score = projectIdMatch ? 1 : rootMatch ? 0.99 : Math.max(titleScore, previewMatch ? 0.9 : 0);
    if (score < 0.88) continue;
    ranked.push({
      id: clip(thread.id, 160),
      name: clip(title || "未命名对话", 300),
      cwd: clip(thread.cwd, 800),
      path: clip(thread.path, 1000) || undefined,
      preview: clip(preview, 800),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      recencyAt: thread.recencyAt,
      projectId: clip(thread.projectId, 160) || undefined,
      gitInfo: thread.gitInfo && typeof thread.gitInfo === "object" ? {
        sha: clip(thread.gitInfo.sha, 80), branch: clip(thread.gitInfo.branch, 160), originUrl: clip(thread.gitInfo.originUrl, 600),
      } : undefined,
      match: projectIdMatch ? "official-project" : rootMatch ? "project-root" : titleScore >= 0.88 ? "conversation-name" : "preview",
      score: Number(score.toFixed(4)),
    });
  }
  return ranked.sort((left, right) => Number(right.updatedAt || right.recencyAt || 0) - Number(left.updatedAt || left.recencyAt || 0)
    || left.name.localeCompare(right.name, "en", { sensitivity: "base" })
    || left.id.localeCompare(right.id)).slice(0, Math.max(1, Math.min(5000, Number(limit) || 100)));
}

function importPrompt(project, { sourceProjectId, schemaPath, context } = {}) {
  if (!project) throw new Error("Project is required");
  const bounded = context || protocol.buildProjectContext(project, { maxTasks: 30, maxCheckpoints: 12, maxEvents: 30 });
  const serializedContext = JSON.stringify(bounded);
  const contextText = serializedContext.length <= IMPORT_CONTEXT_MAX_CHARS
    ? serializedContext
    : `${serializedContext.slice(0, IMPORT_CONTEXT_MAX_CHARS - 80)}…[索引已按上下文预算裁剪，原始归档仍完整]`;
  return [
    "# AI Project Harness · IMPORT PACKET",
    "MODE: IMPORT",
    `HARNESS_PROJECT_ID: ${clip(project.id, 120)}`,
    `HARNESS_PROJECT_PATH: ${clip(project.path, 800)}`,
    sourceProjectId ? `CODEX_PROJECT_ID: ${clip(sourceProjectId, 160)}` : "CODEX_PROJECT_ID: identify from the current Codex Project",
    schemaPath ? `HARNESS_IMPORT_SCHEMA: ${clip(schemaPath, 1000)}` : "HARNESS_IMPORT_SCHEMA: use the injected field contract",
    "",
    "这是一次只读项目拉取，不是新建项目，也不是普通任务。请以当前 Codex Project 的真实内容和最新时间戳为准，完整盘点后回填 Harness。",
    "先检查当前项目的所有可见对话/线程、最新进展、Git 状态和 GitHub 只读信息；不要根据文件名日期或旧摘要猜测最新进展。",
    "不得修改代码、不得修改 Harness 状态文件、不得启动实现任务。不要粘贴完整 transcript、token 或密钥。",
    "先用有界索引完成盘点；不要对 rolloutPath 使用 Get-Content -Raw，也不要把历史会话全文读入上下文。最多核对 8 条最新或最相关线程，使用 head/tail/rg 等定向读取最终消息、任务结果和时间戳；其余线程以索引事实和 notes 记录。Harness 已在上下文外无损归档全部关联 rollout。",
    "这是一次单轮、有限预算的回填：完成必要核对后立即输出候选，不要为了追求全文重放而继续递归扫描或启动实现任务。无法验证的字段留空并写入 notes。",
    "请输出且只输出一个 fenced harness-import JSON 对象，严格匹配 protocol/harness-import.schema.json。未知字段省略；无法验证的字段留空并写入 notes。",
    "任务、Section、checkpoint、决策、阻塞、CTO/Review 会话和 Git/GitHub 都应尽量完整返回；保留来源 ID 与原始 updatedAt。",
    "",
    "## 有界导入索引（用于定位，不等于完整 transcript）",
    contextText,
    "索引中的 sourceThreads 按官方 Project ID、Project 根目录或高置信对话名称匹配，并按 updatedAt 排序；优先核对最新条目。rolloutPath 指向原始只读会话，可用流式/定向搜索读取，不要把整份大文件载入上下文。原始 rollout 同时由 Harness 在模型上下文外单独无损归档。",
    "",
    "## 输出要求",
    "harness-import JSON 的 generatedAt 必须是本次盘点完成时的 ISO 时间；source.agent 固定为 codex；source.codexProjectId 必须等于 CODEX_PROJECT_ID；source.sourceRevision 填可确认的最新修订或留空。project.path 必须等于 HARNESS_PROJECT_PATH。",
    "完成后不要输出第二个 JSON 块，也不要声称已经修改 Harness；Harness 会在用户确认/协议校验后合并。",
  ].join("\n").slice(0, IMPORT_MAX_CHARS);
}

function parseHarnessImport(text) {
  IMPORT_BLOCK.lastIndex = 0;
  let match;
  let candidate;
  while ((match = IMPORT_BLOCK.exec(String(text || "")))) {
    try {
      const value = JSON.parse(match[1].trim());
      if (value && typeof value === "object" && !Array.isArray(value)) candidate = value;
    } catch {
      // Keep scanning; a later complete block is authoritative.
    }
  }
  if (!candidate) throw new Error("HARNESS_IMPORT_MISSING: 未找到有效 harness-import JSON");
  if (candidate.version !== 1 || candidate.type !== "harness-import") throw new Error("HARNESS_IMPORT_VERSION: 需要 version=1/type=harness-import");
  if (!String(candidate.generatedAt || "").trim() || !Number.isFinite(Date.parse(String(candidate.generatedAt)))) throw new Error("HARNESS_IMPORT_TIME_REQUIRED: generatedAt must be an ISO timestamp");
  if (!candidate.project || typeof candidate.project !== "object" || !String(candidate.project.name || "").trim()) throw new Error("HARNESS_IMPORT_PROJECT: project.name is required");
  if (!String(candidate.project.path || "").trim()) throw new Error("HARNESS_IMPORT_PATH_REQUIRED: project.path is required");
  if (!candidate.source || typeof candidate.source !== "object" || !String(candidate.source.codexProjectId || "").trim()) throw new Error("HARNESS_IMPORT_SOURCE_REQUIRED: source.codexProjectId is required");
  for (const key of ["tasks", "sections", "checkpoints", "decisions"]) if (!Array.isArray(candidate[key])) throw new Error(`HARNESS_IMPORT_${key.toUpperCase()}: array is required`);
  return normalizeImport(candidate);
}

function normalizeImport(input) {
  const project = input.project || {};
  const normalizeSnapshot = (value) => value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : undefined;
  const normalizeGit = (value) => {
    if (!value || typeof value !== "object") return undefined;
    return {
      available: Boolean(value.available), root: clip(value.root, 800) || undefined, branch: clip(value.branch, 160) || undefined,
      upstream: clip(value.upstream, 300) || undefined, ahead: Math.max(0, Number(value.ahead) || 0), behind: Math.max(0, Number(value.behind) || 0),
      dirty: Boolean(value.dirty), changeCount: Math.max(0, Number(value.changeCount) || 0),
      changes: (Array.isArray(value.changes) ? value.changes : []).slice(0, 100).map((item) => ({ code: clip(item?.code, 20), file: clip(item?.file, 500) })).filter((item) => item.code || item.file),
      commits: (Array.isArray(value.commits) ? value.commits : []).slice(0, 100).map((item) => ({ hash: clip(item?.hash, 80), shortHash: clip(item?.shortHash, 20), subject: clip(item?.subject, 500), author: clip(item?.author, 160), date: clip(item?.date, 80) })).filter((item) => item.hash || item.shortHash || item.subject).sort((left, right) => {
        const leftAt = Date.parse(String(left.date || ""));
        const rightAt = Date.parse(String(right.date || ""));
        return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
      }),
    };
  };
  const normalizeGithub = (value) => {
    if (!value || typeof value !== "object") return undefined;
    const item = (entry) => ({ number: Number.isFinite(Number(entry?.number)) ? Number(entry.number) : undefined, title: clip(entry?.title, 400), state: clip(entry?.state, 60), url: clip(entry?.url, 600), updatedAt: clip(entry?.updatedAt, 80) });
    return { available: Boolean(value.available), checkedAt: clip(value.checkedAt, 80) || undefined, remoteName: clip(value.remoteName, 80) || undefined, remote: value.remote && typeof value.remote === "object" ? { owner: clip(value.remote.owner, 120), name: clip(value.remote.name, 160), nameWithOwner: clip(value.remote.nameWithOwner, 300), url: clip(value.remote.url, 600) } : null, repository: value.repository && typeof value.repository === "object" ? { nameWithOwner: clip(value.repository.nameWithOwner, 300), description: clip(value.repository.description, 800), url: clip(value.repository.url, 600) } : null, pullRequests: (Array.isArray(value.pullRequests) ? value.pullRequests : []).slice(0, 100).map(item), issues: (Array.isArray(value.issues) ? value.issues : []).slice(0, 100).map(item) };
  };
  const tasks = (input.tasks || []).slice(0, 200).map((task) => ({
    id: clip(task.id, 160) || undefined,
    externalId: clip(task.externalId, 160) || undefined,
    title: clip(task.title, 600),
    workstream: clip(task.workstream, 180) || "general",
    status: TASK_STATUSES.has(task.status) ? task.status : "backlog",
    agent: clip(task.agent, 60) || "codex",
    priority: ["low", "normal", "high", "urgent"].includes(task.priority) ? task.priority : "normal",
    criteria: list(task.criteria, 30, 600),
    dependsOn: list(task.dependsOn, 30, 160),
    sectionId: clip(task.sectionId, 160) || undefined,
    section: clip(task.section, 240) || undefined,
    externalThreadId: clip(task.externalThreadId, 160) || undefined,
    createdAt: clip(task.createdAt, 80) || undefined,
    updatedAt: clip(task.updatedAt, 80) || undefined,
    summary: clip(task.summary, 2000) || undefined,
    nextStep: clip(task.nextStep, 1000) || undefined,
  })).filter((task) => task.title);
  const sections = (input.sections || []).slice(0, 40).map((section) => ({
    id: clip(section.id, 160) || undefined,
    name: clip(section.name, 300),
    kind: SECTION_KINDS.has(section.kind) ? section.kind : "reusable",
    role: clip(section.role, 80) || "worker",
    status: clip(section.status, 60) || "idle",
    agent: clip(section.agent, 60) || "codex",
    taskIds: list(section.taskIds, 100, 160),
    updatedAt: clip(section.updatedAt, 80) || undefined,
  })).filter((section) => section.name);
  const checkpoints = (input.checkpoints || []).slice(0, 200).map((checkpoint) => ({
    id: clip(checkpoint.id, 160) || undefined,
    revision: Number.isFinite(Number(checkpoint.revision)) ? Math.max(0, Number(checkpoint.revision)) : 0,
    summary: clip(checkpoint.summary, 2000),
    nextStep: clip(checkpoint.nextStep, 1000) || undefined,
    acceptedAt: clip(checkpoint.acceptedAt, 80) || undefined,
    source: checkpoint.source && typeof checkpoint.source === "object" ? { agent: clip(checkpoint.source.agent, 60) || "codex", sessionId: clip(checkpoint.source.sessionId, 160) || undefined, threadId: clip(checkpoint.source.threadId, 160) || undefined, turnId: clip(checkpoint.source.turnId, 160) || undefined } : undefined,
    evidence: (Array.isArray(checkpoint.evidence) ? checkpoint.evidence : []).slice(0, 20).map((item) => ({ type: clip(item?.type, 80), value: clip(item?.value, 1200) })).filter((item) => item.type && item.value),
  })).filter((checkpoint) => checkpoint.summary).sort((left, right) => {
    const leftAt = Date.parse(String(left.acceptedAt || ""));
    const rightAt = Date.parse(String(right.acceptedAt || ""));
    if (Number.isFinite(leftAt) || Number.isFinite(rightAt)) return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
    return Number(right.revision || 0) - Number(left.revision || 0);
  });
  const sessions = (input.sessions || []).slice(0, 100).map((session) => ({
    id: clip(session.id, 160) || undefined, role: clip(session.role, 80) || "conversation", title: clip(session.title, 300), status: clip(session.status, 60) || "warm", externalThreadId: clip(session.externalThreadId, 160) || undefined, updatedAt: clip(session.updatedAt, 80) || undefined,
  })).filter((session) => session.title);
  return {
    version: 1, type: "harness-import", generatedAt: clip(input.generatedAt, 80) || undefined,
    source: input.source && typeof input.source === "object" ? { agent: clip(input.source.agent, 60) || "codex", codexProjectId: clip(input.source.codexProjectId, 160) || undefined, projectPath: clip(input.source.projectPath, 800) || undefined, sourceRevision: Number.isFinite(Number(input.source.sourceRevision)) ? Number(input.source.sourceRevision) : undefined, threadIds: list(input.source.threadIds, 100, 160) } : { agent: "codex" },
    project: { name: clip(project.name, 240), path: clip(project.path, 800) || undefined, status: ["active", "paused", "blocked", "completed", "archived"].includes(project.status) ? project.status : undefined, goal: clip(project.goal, 4000) || undefined, objective: clip(project.objective, 1200) || undefined, techStack: list(project.techStack, 40, 300), constraints: list(project.constraints, 40, 500), blockers: list(project.blockers, 40, 1000), sourceRevision: Number.isFinite(Number(project.sourceRevision)) ? Number(project.sourceRevision) : undefined },
    tasks, sections, checkpoints,
    decisions: (input.decisions || []).slice(0, 200).map((item) => typeof item === "string" ? clip(item, 2000) : item && typeof item === "object" ? { id: clip(item.id, 160) || undefined, title: clip(item.title || item.summary || item.detail, 1200), status: clip(item.status, 80) || "imported", rationale: clip(item.rationale, 1600) || undefined, source: clip(item.source, 120) || "codex", createdAt: clip(item.createdAt, 80) || undefined } : "").filter(Boolean),
    sessions, git: normalizeGit(input.git), github: normalizeGithub(input.github), notes: list(input.notes, 40, 1000),
  };
}

function normalizedPath(value) { return path.resolve(String(value || "")).replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase(); }
function stableId(prefix, projectId, key) { return `${prefix}-import-${createHash("sha1").update(`${projectId}:${key}`).digest("hex").slice(0, 16)}`; }
function mergeByKey(items, imported, keyFn, shouldReplace = () => true) {
  const map = new Map(items.map((item) => [keyFn(item), item]));
  let added = 0;
  for (const item of imported) {
    const key = keyFn(item);
    const current = map.get(key);
    if (current) {
      if (shouldReplace(item, current)) Object.assign(current, item);
    } else {
      items.push(item);
      map.set(key, item);
      added += 1;
    }
  }
  return added;
}

function incomingIsAtLeastAsRecent(incoming, current, field = "updatedAt") {
  if (!current) return true;
  const incomingRevision = Number(incoming?.revision);
  const currentRevision = Number(current?.revision);
  if (Number.isFinite(incomingRevision) && Number.isFinite(currentRevision) && incomingRevision !== currentRevision) return incomingRevision > currentRevision;
  const incomingAt = String(incoming?.[field] || "");
  const currentAt = String(current?.[field] || "");
  if (!currentAt || !incomingAt) return true;
  return incomingAt >= currentAt;
}

function applyHarnessImport(state, projectId, rawInput, { now = () => new Date().toISOString() } = {}) {
  const project = machine.getProject(state, projectId);
  if (!rawInput || typeof rawInput !== "object" || rawInput.version !== 1 || rawInput.type !== "harness-import") throw new Error("HARNESS_IMPORT_VERSION: 需要 version=1/type=harness-import");
  const input = normalizeImport(rawInput);
  const expectedProjectId = String(project.codexImport?.codexProjectId || project.codexProjectId || "").trim();
  const sourceProjectId = String(input.source?.codexProjectId || "").trim();
  if (!expectedProjectId) throw new Error("HARNESS_IMPORT_SOURCE_UNBOUND: 目标 Harness 项目未绑定 Codex Project");
  if (!sourceProjectId) throw new Error("HARNESS_IMPORT_SOURCE_REQUIRED: 候选缺少 source.codexProjectId");
  if (sourceProjectId !== expectedProjectId) throw new Error("HARNESS_IMPORT_SOURCE_MISMATCH: 候选来源 Project 与目标不一致");
  if (!input.project.path) throw new Error("HARNESS_IMPORT_PATH_REQUIRED: 候选缺少 project.path");
  if (!project.path || normalizedPath(input.project.path) !== normalizedPath(project.path)) throw new Error(`HARNESS_IMPORT_PROJECT_MISMATCH: ${input.project.path}`);
  const incomingSourceRevision = Number(input.source?.sourceRevision ?? input.project.sourceRevision);
  const currentSourceRevision = Number(project.codexImport?.sourceRevision);
  if (Number.isFinite(currentSourceRevision) && !Number.isFinite(incomingSourceRevision)) {
    throw new Error(`HARNESS_IMPORT_STALE_SOURCE: 已记录来源 R${currentSourceRevision}，新候选缺少可比较的 sourceRevision`);
  }
  if (Number.isFinite(incomingSourceRevision) && Number.isFinite(currentSourceRevision) && incomingSourceRevision < currentSourceRevision) {
    throw new Error(`HARNESS_IMPORT_STALE_SOURCE: 候选来源 R${incomingSourceRevision} 早于已记录 R${currentSourceRevision}`);
  }
  const incomingGeneratedAt = Date.parse(String(input.generatedAt || ""));
  const currentGeneratedAt = Date.parse(String(project.codexImport?.sourceGeneratedAt || ""));
  if (!Number.isFinite(incomingGeneratedAt)) throw new Error("HARNESS_IMPORT_TIME_REQUIRED: 候选缺少有效 generatedAt");
  if (Number.isFinite(currentGeneratedAt) && (!Number.isFinite(incomingGeneratedAt) || incomingGeneratedAt < currentGeneratedAt)) {
    throw new Error("HARNESS_IMPORT_STALE_SOURCE: 候选 generatedAt 早于已记录的导入快照");
  }
  const timestamp = now();
  const imported = { tasks: 0, sections: 0, checkpoints: 0, decisions: 0, sessions: 0 };
  if (input.project.goal || input.project.objective || input.project.techStack.length || input.project.constraints.length || input.project.blockers.length) {
    machine.updateProjectContract(state, project.id, { goal: input.project.goal ?? project.goal, objectiveTitle: input.project.objective ?? project.objective?.title, techStack: input.project.techStack.length ? input.project.techStack : project.techStack, constraints: input.project.constraints.length ? input.project.constraints : project.constraints, blockers: input.project.blockers.length ? input.project.blockers : project.blockers });
  }
  if (input.project.status && input.project.status !== "archived") project.status = input.project.status;
  machine.ensureProjectSections(project);
  const sectionIds = new Map();
  for (const section of input.sections) {
    const existing = (section.kind === "main" && project.sections.find((item) => item.kind === "main")) || (section.id && project.sections.find((item) => item.id === section.id)) || project.sections.find((item) => item.name.toLowerCase() === section.name.toLowerCase());
    const target = existing || { id: section.id || stableId("section", project.id, section.name), name: section.name, kind: section.kind, role: section.role, agent: section.agent, status: section.status, reusable: section.kind === "reusable", taskIds: [], useCount: 0, createdAt: timestamp, updatedAt: timestamp };
    if (!existing) { project.sections.push(target); imported.sections += 1; }
    else Object.assign(target, { kind: section.kind, role: section.role, agent: section.agent, status: section.status, updatedAt: section.updatedAt || timestamp });
    sectionIds.set(section.id || section.name, target.id);
  }
  const importedTaskIds = new Map();
  for (const task of input.tasks) {
    const key = task.externalId || task.id || task.externalThreadId || task.title.toLowerCase();
    const externalKey = task.externalId || task.id;
    const existing = project.tasks.find((item) => item.externalId && item.externalId === externalKey);
    const localId = existing?.id || (task.id && !project.tasks.some((item) => item.id === task.id) ? task.id : stableId("task", project.id, key));
    importedTaskIds.set(task.id || task.externalId || key, localId);
    if (task.externalId) importedTaskIds.set(task.externalId, localId);
  }
  const importedTasks = input.tasks.map((task) => {
    const key = task.externalId || task.id || task.externalThreadId || task.title.toLowerCase();
    const id = importedTaskIds.get(task.id || task.externalId || key) || (task.id && !project.tasks.some((item) => item.id === task.id) ? task.id : stableId("task", project.id, key));
    const sectionId = sectionIds.get(task.sectionId) || sectionIds.get(task.section) || project.sections.find((item) => item.name.toLowerCase() === String(task.section || "").toLowerCase())?.id;
    const dependsOn = (task.dependsOn || []).map((dependency) => importedTaskIds.get(dependency) || dependency).slice(0, 30);
    return { id, externalId: task.externalId || task.id, title: task.title, workstream: task.workstream, status: task.status, agent: task.agent, priority: task.priority, criteria: task.criteria, dependsOn, sectionId, createdAt: task.createdAt || timestamp, updatedAt: task.updatedAt || timestamp, importedAt: timestamp, ...(task.externalThreadId ? { run: { id: stableId("run", project.id, key), externalThreadId: task.externalThreadId, externalAgent: "codex", status: task.status === "accepted" ? "completed" : "imported", phase: "imported", progress: task.status === "accepted" ? 100 : 0, baseRevision: project.revision, startedAt: task.createdAt || timestamp, importedAt: timestamp } } : {}), ...(task.summary ? { importedSummary: task.summary } : {}), ...(task.nextStep ? { importedNextStep: task.nextStep } : {}) };
  });
  imported.tasks = mergeByKey(project.tasks, importedTasks, (item) => item.externalId || item.id || item.title.toLowerCase(), (incoming, current) => incomingIsAtLeastAsRecent(incoming, current));
  for (const section of project.sections) section.taskIds = project.tasks.filter((task) => task.sectionId === section.id).map((task) => task.id);
  imported.checkpoints = mergeByKey(project.checkpoints ||= [], input.checkpoints.map((item) => ({ ...item, id: item.id || stableId("checkpoint", project.id, `${item.revision}:${item.summary}`), source: { ...(item.source || {}), agent: item.source?.agent || "codex", importedAt: timestamp } })), (item) => item.id || `${item.revision}:${item.summary}`, (incoming, current) => incomingIsAtLeastAsRecent(incoming, current, "acceptedAt"));
  imported.decisions = mergeByKey(project.decisions ||= [], input.decisions, (item) => typeof item === "string" ? item : item.id || item.title, (incoming, current) => incomingIsAtLeastAsRecent(incoming, current, "createdAt"));
  const importedSessions = input.sessions.map((session) => {
    // Bind imported CTO/Review records to the durable control-session slots
    // already created by Harness; otherwise an import would leave a second
    // hidden CTO and the UI would keep opening the empty placeholder.
    const control = ["cto", "review"].includes(String(session.role || "").toLowerCase())
      ? project.sessions.find((item) => item.role === String(session.role).toLowerCase())
      : undefined;
    return {
      ...session,
      id: control?.id || session.id || stableId("session", project.id, session.title),
      role: session.role || control?.role || "conversation",
      agent: "codex",
      type: "warm",
      taskIds: control?.taskIds || [],
      cursor: project.revision,
      createdAt: session.updatedAt || timestamp,
    };
  });
  imported.sessions = mergeByKey(project.sessions ||= [], importedSessions, (item) => item.id || item.externalThreadId || item.title, (incoming, current) => incomingIsAtLeastAsRecent(incoming, current));
  const sourceIsAtLeastAsRecent = !Number.isFinite(currentSourceRevision) || !Number.isFinite(incomingSourceRevision) || incomingSourceRevision >= currentSourceRevision;
  if (input.git && sourceIsAtLeastAsRecent) project.gitSnapshot = input.git;
  if (input.github && sourceIsAtLeastAsRecent) project.githubSnapshot = input.github;
  project.imports ||= [];
  const record = { id: randomUUID(), at: timestamp, agent: input.source?.agent || "codex", codexProjectId: input.source?.codexProjectId, sourceRevision: input.source?.sourceRevision ?? input.project.sourceRevision, generatedAt: input.generatedAt, latestCheckpointAt: input.checkpoints?.[0]?.acceptedAt, notes: input.notes, counts: imported };
  project.imports.unshift(record);
  project.codexImport = { ...(project.codexImport || {}), id: record.id, sourceRevision: record.sourceRevision, sourceGeneratedAt: record.generatedAt, sourceLatestAt: record.latestCheckpointAt, codexProjectId: record.codexProjectId || project.codexProjectId, importedAt: timestamp, completedAt: timestamp, status: "completed", detail: "Codex Project 数据已完成协议校验并回填。" };
  project.events ||= [];
  project.events.unshift({ id: randomUUID(), type: "codex.project.imported", at: timestamp, detail: `${input.project.name} · ${Object.values(imported).reduce((sum, value) => sum + value, 0)} fields` });
  project.updatedAt = timestamp;
  return { projectId: project.id, imported, sourceRevision: record.sourceRevision, importId: record.id };
}

module.exports = { IMPORT_MAX_CHARS, importPrompt, selectCodexProjectThreads, parseHarnessImport, normalizeImport, applyHarnessImport };
