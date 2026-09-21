const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");

const now = () => new Date().toISOString();
const HISTORY_LIMITS = { events: 1000, checkpoints: 1000, decisions: 500, objectives: 100, sessions: 500 };
const CODEX_PROJECT_SYNC_STATES = ["not-created", "app-server-confirmed", "desktop-registered", "desktop-restart-required"];
const CODEX_PROJECT_RESTART_DETAIL = "官方 Project 已写入；Codex Desktop 不会热加载外部 Project，需完全退出后重新打开再核对侧栏。";

function normalizedImportPath(value) {
  return path.resolve(String(value || ""))
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

/** The import Agent must prove both the official Codex Project and its root.
 * This guard is repeated at candidate, apply and accept boundaries because a
 * pending state file can survive app restarts or be written by local tooling. */
function assertCodexImportCandidateIdentity(project, candidate) {
  const expectedProjectId = String(project?.codexImport?.codexProjectId || project?.codexProjectId || "").trim();
  const sourceProjectId = String(candidate?.source?.codexProjectId || "").trim();
  if (!expectedProjectId) throw new Error("HARNESS_IMPORT_SOURCE_UNBOUND: 目标 Harness 项目未绑定 Codex Project");
  if (!sourceProjectId) throw new Error("HARNESS_IMPORT_SOURCE_REQUIRED: 候选缺少 source.codexProjectId");
  if (sourceProjectId !== expectedProjectId) throw new Error("HARNESS_IMPORT_SOURCE_MISMATCH: 候选来源 Project 与目标不一致");
  const candidatePath = String(candidate?.project?.path || "").trim();
  if (!candidatePath) throw new Error("HARNESS_IMPORT_PATH_REQUIRED: 候选缺少 project.path");
  if (!project?.path || normalizedImportPath(candidatePath) !== normalizedImportPath(project.path)) {
    throw new Error("HARNESS_IMPORT_PROJECT_MISMATCH: 候选项目目录与目标不一致");
  }
}

function assertCodexImportIsNotStale(project, candidate) {
  const incoming = Number(candidate?.source?.sourceRevision ?? candidate?.project?.sourceRevision);
  const current = Number(project?.codexImport?.sourceRevision);
  if (Number.isFinite(current) && !Number.isFinite(incoming)) {
    throw new Error(`HARNESS_IMPORT_STALE_SOURCE: 已记录来源 R${current}，新候选缺少可比较的 sourceRevision`);
  }
  if (Number.isFinite(incoming) && Number.isFinite(current) && incoming < current) {
    throw new Error(`HARNESS_IMPORT_STALE_SOURCE: 候选来源 R${incoming} 早于已记录 R${current}`);
  }
  const incomingAt = Date.parse(String(candidate?.generatedAt || ""));
  const currentAt = Date.parse(String(project?.codexImport?.sourceGeneratedAt || ""));
  if (!Number.isFinite(incomingAt)) throw new Error("HARNESS_IMPORT_TIME_REQUIRED: 候选缺少有效 generatedAt");
  if (Number.isFinite(currentAt) && (!Number.isFinite(incomingAt) || incomingAt < currentAt)) {
    throw new Error("HARNESS_IMPORT_STALE_SOURCE: 候选 generatedAt 早于已记录的导入快照");
  }
}

function boundProjectHistory(project) {
  if (!project) return project;
  for (const [key, limit] of Object.entries(HISTORY_LIMITS)) {
    if (Array.isArray(project[key]) && project[key].length > limit) project[key] = project[key].slice(0, limit);
  }
  return project;
}

function projectIdFromPath(projectPath) {
  return `project-${createHash("sha1").update(projectPath.toLowerCase()).digest("hex").slice(0, 12)}`;
}

function controlSession(project, role, title) {
  const existing = project.sessions.find((session) => session.role === role);
  if (existing) return existing;
  const session = {
    id: `session-${role}-${project.id}`,
    role,
    title,
    agent: "codex",
    type: "warm",
    status: "warm",
    workstream: role === "cto" ? "project-core" : "project-review",
    cursor: project.revision,
    taskIds: [],
    createdAt: now(),
  };
  project.sessions.push(session);
  return session;
}

function ensureProjectControlSessions(project) {
  project.sessions ||= [];
  const cto = controlSession(project, "cto", "CTO · 项目核心");
  const review = controlSession(project, "review", "Review Agent · 项目审核");
  project.controlSessions = { ctoId: cto.id, reviewId: review.id };
  return { cto, review };
}

/**
 * Sections are the durable work containers that sit between a Project and a
 * Task.  The main section is deliberately a lightweight steward/router; it
 * never owns implementation tasks.  Reusable sections keep a warm context,
 * while one-shot sections retire after their task is accepted.
 */
function sectionId(projectId, kind, name = "") {
  const slug = String(name || kind).toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 32) || kind;
  return `section-${kind}-${projectId}-${slug}`;
}

function ensureProjectSections(project) {
  project.sections ||= [];
  const mainId = sectionId(project.id, "main", "steward");
  let main = project.sections.find((section) => section.kind === "main" || section.id === mainId);
  if (!main) {
    main = {
      id: mainId,
      name: "主控",
      kind: "main",
      role: "steward",
      agent: "codex",
      status: "idle",
      reusable: true,
      approvalMode: "user",
      maxTasks: 1000,
      maxContextChars: 12000,
      taskIds: [],
      useCount: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    project.sections.unshift(main);
  } else {
    main.kind = "main";
    main.role ||= "steward";
    main.reusable = true;
    main.taskIds ||= [];
    main.status ||= "idle";
  }
  const cto = project.sessions?.find((session) => session.role === "cto");
  if (cto) main.sessionId = cto.id;
  return main;
}

function getSection(project, sectionRef) {
  if (!sectionRef) return undefined;
  return (project.sections || []).find((section) => section.id === sectionRef || section.name === sectionRef);
}

function createSection(state, projectId, input = {}) {
  const project = getProject(state, projectId);
  ensureProjectSections(project);
  const name = String(input.name || input.title || "").trim();
  if (!name) throw new Error("Section name is required");
  const kind = ["main", "reusable", "one-shot"].includes(input.kind) ? input.kind : "reusable";
  if (kind === "main") return ensureProjectSections(project);
  const existing = project.sections.find((section) => String(section.name || "").toLowerCase() === name.toLowerCase() && !["closed", "archived"].includes(section.status));
  if (existing) return existing;
  const timestamp = now();
  const requestedId = String(input.id || sectionId(project.id, kind, `${name}-${timestamp}`));
  let uniqueId = requestedId;
  let idSuffix = 2;
  while (project.sections.some((section) => section.id === uniqueId)) uniqueId = `${requestedId}-${idSuffix++}`;
  const section = {
    id: uniqueId,
    name,
    kind,
    role: "worker",
    agent: input.agent === "claude" ? "claude" : input.agent === "hermes" ? "hermes" : "codex",
    status: "idle",
    reusable: kind === "reusable",
    approvalMode: input.approvalMode === "auto" ? "auto" : "user",
    maxTasks: Math.max(1, Math.min(1000, Number(input.maxTasks) || (kind === "one-shot" ? 1 : 20))),
    maxContextChars: Math.max(2000, Math.min(50000, Number(input.maxContextChars) || 12000)),
    taskIds: [],
    useCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  project.sections.unshift(section);
  project.events ||= [];
  project.events.unshift({ id: randomUUID(), type: "section.created", at: timestamp, detail: `${name} · ${kind}` });
  project.updatedAt = timestamp;
  return section;
}

function assignTaskToSection(state, projectId, taskId, sectionRef) {
  const project = getProject(state, projectId);
  if (project.status === "archived") throw new Error("已归档项目不能改派任务，请先恢复项目");
  const task = getTask(project, taskId);
  if (["in_progress", "awaiting_result", "review"].includes(task.status)) {
    throw new Error("运行中或待审核任务不能改派，请先停止或完成当前运行");
  }
  ensureProjectSections(project);
  const section = getSection(project, sectionRef);
  if (!section) throw new Error("Section not found");
  if (section.kind === "main") throw new Error("主控 Section 只负责调配和审核，不能直接执行任务");
  if (["closed", "archived"].includes(section.status)) throw new Error("Section 已关闭，不能继续派发任务");
  const sectionTaskCount = (section.taskIds || []).filter((id) => id !== task.id).length;
  if (sectionTaskCount >= Number(section.maxTasks || (section.kind === "one-shot" ? 1 : 20))) throw new Error("Section 已达到任务上限，请新建或恢复另一个 Section");
  const timestamp = now();
  const previousSection = task.sectionId && getSection(project, task.sectionId);
  if (previousSection && previousSection.id !== section.id) {
    previousSection.taskIds = (previousSection.taskIds || []).filter((id) => id !== task.id);
    previousSection.updatedAt = timestamp;
    const previousActive = (project.tasks || []).some((item) => item.sectionId === previousSection.id && item.id !== task.id && ["in_progress", "awaiting_result", "review"].includes(item.status));
    if (!previousActive && ["running", "awaiting_approval"].includes(previousSection.status)) previousSection.status = "idle";
  }
  task.sectionId = section.id;
  section.taskIds ||= [];
  if (!section.taskIds.includes(task.id)) section.taskIds.push(task.id);
  section.updatedAt = timestamp;
  project.events ||= [];
  if (!previousSection || previousSection.id !== section.id) {
    project.events.unshift({ id: randomUUID(), type: "task.section.assigned", at: timestamp, detail: `${task.title} → ${section.name}` });
  }
  project.updatedAt = timestamp;
  return task;
}

function updateSectionForTask(project, task, status) {
  const section = getSection(project, task.sectionId);
  if (!section) return;
  section.updatedAt = now();
  if (status === "running" || status === "review") section.status = status === "review" ? "awaiting_approval" : "running";
  if (status === "accepted") {
    section.useCount = Number(section.useCount || 0) + 1;
    section.status = section.kind === "one-shot" ? "closed" : "idle";
    if (section.kind === "one-shot") section.closedAt = section.updatedAt;
  }
  if (status === "changes_requested") section.status = "idle";
  if (status === "failed") section.status = "idle";
}

function closeSection(state, projectId, sectionRef, reason = "用户关闭") {
  const project = getProject(state, projectId);
  project.events ||= [];
  const section = getSection(project, sectionRef);
  if (!section) throw new Error("Section not found");
  if (section.kind === "main") throw new Error("主控 Section 不能关闭");
  const active = (project.tasks || []).some((task) => task.sectionId === section.id && ["in_progress", "awaiting_result", "review"].includes(task.status));
  if (active) throw new Error("Section 仍有进行中的任务，完成或退回后再关闭");
  section.status = "closed";
  section.closedAt = now();
  section.closeReason = String(reason || "用户关闭").slice(0, 500);
  project.events.unshift({ id: randomUUID(), type: "section.closed", at: section.closedAt, detail: section.name });
  const session = project.sessions.find((item) => item.id === section.sessionId);
  if (session && session.role === "task") { session.status = "retired"; session.retiredReason = "所属 Section 已关闭"; }
  project.updatedAt = section.closedAt;
  return section;
}

function archiveSection(state, projectId, sectionRef, reason = "用户归档") {
  const project = getProject(state, projectId);
  project.events ||= [];
  const section = getSection(project, sectionRef);
  if (!section) throw new Error("Section not found");
  if (section.kind === "main") throw new Error("主控 Section 不能归档");
  const active = (project.tasks || []).some((task) => task.sectionId === section.id && ["in_progress", "awaiting_result", "review"].includes(task.status));
  if (active) throw new Error("Section 仍有进行中的任务，不能归档");
  section.status = "archived";
  section.archivedAt = now();
  section.archiveReason = String(reason || "用户归档").slice(0, 500);
  project.events.unshift({ id: randomUUID(), type: "section.archived", at: section.archivedAt, detail: section.name });
  const session = project.sessions.find((item) => item.id === section.sessionId);
  if (session && session.role === "task") { session.status = "retired"; session.retiredReason = "所属 Section 已归档"; }
  project.updatedAt = section.archivedAt;
  return section;
}

function archiveProject(state, projectId, reason = "用户归档") {
  const project = getProject(state, projectId);
  project.events ||= [];
  const active = (project.tasks || []).some((task) => ["in_progress", "awaiting_result", "review"].includes(task.status));
  if (active) throw new Error("项目仍有进行中的任务，完成或停止后再归档");
  const archivedAt = now();
  project.status = "archived";
  project.archive = { archivedAt, reason: String(reason || "用户归档").slice(0, 500) };
  for (const section of project.sections || []) {
    if (section.kind !== "main" && section.status !== "closed") {
      section.status = "closed";
      section.closedAt ||= archivedAt;
    }
  }
  project.events.unshift({ id: randomUUID(), type: "project.archived", at: archivedAt, detail: project.archive.reason });
  project.updatedAt = archivedAt;
  if (state.selectedProjectId === project.id) {
    const replacement = state.projects.find((item) => item.id !== project.id && item.status !== "archived");
    state.selectedProjectId = replacement?.id || project.id;
  }
  return project;
}

function restoreProject(state, projectId) {
  const project = getProject(state, projectId);
  project.events ||= [];
  const restoredAt = now();
  project.status = "active";
  project.archive = undefined;
  project.events.unshift({ id: randomUUID(), type: "project.restored", at: restoredAt, detail: project.name });
  project.updatedAt = restoredAt;
  state.selectedProjectId = project.id;
  ensureProjectSections(project);
  return project;
}

function setProjectStatus(state, projectId, status) {
  const allowed = ["active", "paused", "blocked", "completed", "archived"];
  if (!allowed.includes(status)) throw new Error("Invalid project status");
  if (status === "archived") return archiveProject(state, projectId);
  const project = getProject(state, projectId);
  if (status === "completed" && (project.tasks || []).some((task) => ["in_progress", "awaiting_result", "review"].includes(task.status))) {
    throw new Error("项目仍有未完成或待审核任务，不能标记为已完成");
  }
  project.status = status;
  project.updatedAt = now();
  project.events ||= [];
  project.events.unshift({ id: randomUUID(), type: `project.${status}`, at: project.updatedAt, detail: project.name });
  return project;
}

function updateProjectContract(state, projectId, input = {}) {
  const project = getProject(state, projectId);
  ensureObjectives(project);
  project.contractRevision ||= 1;
  const previousContract = JSON.stringify({
    path: project.path,
    goal: project.goal,
    objective: project.objective?.title,
    techStack: project.techStack || [],
    constraints: project.constraints || [],
    blockers: project.blockers || [],
  });
  const timestamp = now();
  if (input.path !== undefined || input.projectPath !== undefined) {
    const requestedPath = String(input.path ?? input.projectPath ?? "").trim();
    if (requestedPath) {
      const resolvedPath = path.resolve(requestedPath);
      const changingExisting = project.path && path.resolve(project.path).toLowerCase() !== resolvedPath.toLowerCase();
      if (changingExisting && project.source?.kind !== "blank") throw new Error("已接入项目的根目录不能从契约面板直接改写");
      if (changingExisting && (project.tasks || []).some((task) => ["in_progress", "awaiting_result", "review"].includes(task.status))) {
        throw new Error("项目仍有运行中或待审核任务，不能更换根目录");
      }
      project.path = resolvedPath;
    }
  }
  if (input.goal !== undefined) project.goal = String(input.goal || "").trim().slice(0, 4000) || "尚未填写项目目标。";
  if (input.objectiveTitle !== undefined || input.objective !== undefined) {
    const title = String(input.objectiveTitle ?? input.objective ?? "").trim();
    if (title) {
      project.objective = { ...(project.objective || {}), id: project.objective?.id || randomUUID(), title, status: project.objective?.status || "active" };
      project.objectives = project.objectives.map((item) => item.id === project.objective.id ? { ...project.objective } : item);
    }
  }
  const normalizeLines = (value) => Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 40)
    : String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 40);
  if (input.techStack !== undefined) project.techStack = normalizeLines(input.techStack);
  if (input.constraints !== undefined) project.constraints = normalizeLines(input.constraints);
  if (input.blockers !== undefined) project.blockers = normalizeLines(input.blockers);
  const nextContract = JSON.stringify({
    path: project.path,
    goal: project.goal,
    objective: project.objective?.title,
    techStack: project.techStack || [],
    constraints: project.constraints || [],
    blockers: project.blockers || [],
  });
  if (nextContract !== previousContract) project.contractRevision += 1;
  project.events.unshift({ id: randomUUID(), type: "project.contract.updated", at: timestamp, detail: "项目目标与约束已更新" });
  project.updatedAt = timestamp;
  return project;
}

function ensureObjectives(project) {
  project.objectives ||= [];
  if (project.objective && !project.objectives.some((item) => item.id === project.objective.id)) project.objectives.unshift({ ...project.objective });
  if (!project.objective && project.objectives.length) project.objective = project.objectives[0];
  return project.objectives;
}

function createObjective(state, projectId, input = {}) {
  const project = getProject(state, projectId);
  ensureObjectives(project);
  const title = String(input.title || input.objective || "").trim();
  if (!title) throw new Error("Objective title is required");
  const timestamp = now();
  for (const objective of project.objectives) {
    if (objective.status === "active") {
      objective.status = String(input.supersede ? "superseded" : "paused");
      objective.endedAt = timestamp;
    }
  }
  const objective = { id: randomUUID(), title: title.slice(0, 1200), status: "active", createdAt: timestamp };
  project.objectives.unshift(objective);
  project.objective = objective;
  project.events.unshift({ id: randomUUID(), type: "objective.created", at: timestamp, detail: objective.title });
  project.updatedAt = timestamp;
  return objective;
}

function setObjectiveStatus(state, projectId, status) {
  const project = getProject(state, projectId);
  ensureObjectives(project);
  const allowed = ["active", "paused", "completed", "superseded", "blocked"];
  if (!allowed.includes(status)) throw new Error("Invalid objective status");
  const objective = project.objective;
  if (!objective) throw new Error("Objective not found");
  objective.status = status;
  objective.endedAt = status === "active" ? undefined : now();
  project.objectives = project.objectives.map((item) => item.id === objective.id ? { ...objective } : item);
  project.events.unshift({ id: randomUUID(), type: `objective.${status}`, at: now(), detail: objective.title });
  project.updatedAt = now();
  return objective;
}

function getProjectActivity(project, { limit = 50 } = {}) {
  const entries = [
    ...(project?.events || []).map((event) => ({ kind: "event", at: event.at, type: event.type, detail: event.detail, id: event.id })),
    ...(project?.checkpoints || []).map((checkpoint) => ({ kind: "checkpoint", at: checkpoint.acceptedAt, type: "checkpoint.accepted", detail: checkpoint.summary, revision: checkpoint.revision, id: checkpoint.id })),
  ];
  return entries
    .filter((item) => item.at)
    .sort((left, right) => String(right.at).localeCompare(String(left.at)))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function projectOverview(project) {
  const tasks = project?.tasks || [];
  return {
    projectId: project?.id,
    status: project?.status || "active",
    revision: Number(project?.revision || 0),
    taskCounts: Object.fromEntries(["backlog", "ready", "in_progress", "awaiting_result", "review", "changes_requested", "accepted", "failed"].map((status) => [status, tasks.filter((task) => task.status === status).length])),
    sectionCounts: Object.fromEntries(["idle", "running", "awaiting_approval", "closed", "archived"].map((status) => [status, (project?.sections || []).filter((section) => section.status === status).length])),
    conversationCount: (project?.sessions || []).filter((session) => ["conversation", "task", "cto", "review"].includes(session.role)).length,
    latestCheckpoint: project?.checkpoints?.[0] || null,
    latestEvent: project?.events?.[0] || null,
    activeObjective: project?.objective || null,
    github: project?.githubSnapshot?.remote ? {
      repository: project.githubSnapshot.repository?.nameWithOwner || project.githubSnapshot.remote.nameWithOwner,
      pullRequests: (project.githubSnapshot.pullRequests || []).length,
      issues: (project.githubSnapshot.issues || []).length,
    } : null,
  };
}

function createSelfHostedProject(projectPath) {
  const projectId = projectIdFromPath(projectPath);
  const taskId = "task-review-acid-mvp";
  const sessionId = "session-codex-mvp";
  const createdAt = now();
  return {
    id: projectId,
    name: "AI Project Harness",
    path: projectPath,
    status: "active",
    revision: 1,
    contractRevision: 1,
    goal: "让项目状态独立于 Agent 会话，并通过审核推进 Project HEAD。",
    source: { kind: "ai-project-harness", label: "由 AI Project Harness 自举接入" },
    techStack: [],
    constraints: [],
    gitPolicy: { mode: "evidence-only", commitOnAccept: false },
    objective: {
      id: "objective-mvp-loop",
      title: "验证 Task → Review → Project HEAD 的桌面闭环",
      status: "active",
    },
    tasks: [
      {
        id: taskId,
        title: "审核酸性桌面 MVP",
        workstream: "desktop-mvp",
        criteria: [
          "Electron 桌面窗口可以独立运行",
          "Git 面板读取真实本地仓库状态",
          "用户 Accept 后 Project HEAD 原子推进",
        ],
        agent: "codex",
        sessionPolicy: "warm",
        status: "review",
        baseRevision: 1,
        contractRevision: 1,
        createdAt,
        run: {
          id: "run-self-hosted-mvp",
          sessionId,
          baseRevision: 1,
          contractRevision: 1,
          startedAt: createdAt,
          submittedAt: createdAt,
        },
        candidate: {
          summary: "桌面壳、项目状态、Git 读取和人工接受事务已经进入可验收状态。",
          completed: ["Electron/Vite 桌面壳", "本地状态存储", "Git evidence reader", "Task review gate"],
          remaining: ["Hermes/Claude 后台 adapter、SQLite/CAS 主存储和 macOS 仍在后续路线"],
          nextStep: "用户审核首个自举 checkpoint，再验证真实项目上的 Section 接力。",
          acceptance: [
            { criterion: "Electron 桌面窗口可以独立运行", status: "pass" },
            { criterion: "Git 面板读取真实本地仓库状态", status: "pass" },
            { criterion: "用户 Accept 后 Project HEAD 原子推进", status: "pending" },
          ],
          evidence: [
            { type: "build", value: "npm run check" },
            { type: "source", value: "electron/main.cjs + src/main.ts" },
          ],
        },
      },
      {
        id: "task-agent-pack",
        title: "自动捕获 Codex harness-result",
        workstream: "agent-adapter",
        criteria: ["解析 fenced harness-result", "校验 base revision 与 result schema", "候选结果进入用户审核区"],
        agent: "codex",
        sessionPolicy: "auto",
        status: "ready",
        baseRevision: 1,
        createdAt,
      },
      {
        id: "task-claude-adapter",
        title: "接入 Claude Code 用户主动调用路径",
        workstream: "agent-adapter",
        criteria: ["不包装 OAuth 会话", "支持用户主动 skill/MCP", "能力缺失可见"],
        agent: "claude",
        sessionPolicy: "disposable",
        status: "backlog",
        baseRevision: 1,
        createdAt,
      },
    ],
    sessions: [
      {
        id: sessionId,
        role: "task",
        title: "Task · 审核酸性桌面 MVP",
        agent: "codex",
        type: "warm",
        status: "awaiting_review",
        workstream: "desktop-mvp",
        cursor: 0,
        taskIds: [taskId],
        createdAt,
      },
    ],
    sections: [],
    objectives: [],
    checkpoints: [],
    decisions: [],
    events: [
      { id: randomUUID(), type: "project.bootstrap", at: createdAt, detail: "Self-hosted MVP project created." },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

function createInitialState(projectPath) {
  const project = createSelfHostedProject(projectPath);
  ensureProjectControlSessions(project);
  ensureProjectSections(project);
  ensureObjectives(project);
  return { schemaVersion: 1, selectedProjectId: project.id, projects: [project] };
}

function createEmptyState() {
  return { schemaVersion: 1, selectedProjectId: "", projects: [] };
}

function getProject(state, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  return project;
}

function shouldAutoProvisionCodexProject(project) {
  if (!project?.path) return false;
  if (project.source?.kind === "blank" && !project.codexProjectId) return false;
  return true;
}

function getTask(project, taskId) {
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found");
  return task;
}

function addProject(state, projectPath) {
  const normalized = path.resolve(projectPath);
  const existing = state.projects.find((item) => path.resolve(item.path).toLowerCase() === normalized.toLowerCase());
  if (existing) {
    state.selectedProjectId = existing.id;
    return existing;
  }
  const timestamp = now();
  const project = {
    id: projectIdFromPath(normalized),
    name: path.basename(normalized),
    path: normalized,
    status: "active",
    revision: 1,
    contractRevision: 1,
    goal: "尚未填写项目目标。",
    source: { kind: "ai-project-harness", label: "由 AI Project Harness 接入" },
    techStack: [],
    constraints: [],
    gitPolicy: { mode: "evidence-only", commitOnAccept: false },
    objective: { id: randomUUID(), title: "建立第一个可验收任务", status: "active" },
    tasks: [],
    sessions: [],
    sections: [],
    objectives: [],
    checkpoints: [],
    decisions: [],
    events: [{ id: randomUUID(), type: "project.created", at: timestamp, detail: normalized }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  ensureProjectControlSessions(project);
  ensureProjectSections(project);
  ensureObjectives(project);
  state.projects.push(project);
  state.selectedProjectId = project.id;
  return project;
}

/**
 * Create a Harness project without probing Codex, the filesystem, or Git.
 * Blank projects are deliberately first-class: the user can fill the
 * contract by hand and later choose when (or whether) to connect an Agent.
 */
function createBlankProject(state, input = {}) {
  const name = String(input.name || input.title || "").trim().slice(0, 160);
  if (!name) throw new Error("Project name is required");
  const timestamp = now();
  const suppliedPath = String(input.path || "").trim();
  const project = {
    id: `project-${randomUUID()}`,
    name,
    path: suppliedPath ? path.resolve(suppliedPath) : "",
    status: "active",
    revision: 1,
    contractRevision: 1,
    goal: String(input.goal || "尚未填写项目目标。").trim().slice(0, 4000) || "尚未填写项目目标。",
    source: { kind: "blank", label: "手动新建的空白项目" },
    techStack: Array.isArray(input.techStack) ? input.techStack.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40) : [],
    constraints: Array.isArray(input.constraints) ? input.constraints.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40) : [],
    gitPolicy: { mode: "evidence-only", commitOnAccept: false },
    objective: { id: randomUUID(), title: String(input.objective || "定义项目目标"), status: "active" },
    tasks: [],
    sessions: [],
    sections: [],
    objectives: [],
    checkpoints: [],
    decisions: [],
    events: [{ id: randomUUID(), type: "project.created.blank", at: timestamp, detail: name }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  ensureProjectControlSessions(project);
  ensureProjectSections(project);
  ensureObjectives(project);
  state.projects.push(project);
  state.selectedProjectId = project.id;
  return project;
}

/**
 * Register a request to hydrate a project from an existing Codex Project.
 * This is intentionally a pure state transition. The caller may later run a
 * Codex Agent to fill the project, but creating the request itself must never
 * start app-server, mutate Codex state, or fabricate imported data.
 */
function requestCodexProjectImport(state, input = {}) {
  const codexProjectId = String(input.codexProjectId || input.externalProjectId || input.projectId || "").trim();
  if (!codexProjectId) throw new Error("Codex Project id is required");
  // `targetProjectId`/`harnessProjectId` lets the UI hydrate an existing blank
  // project. A bare `projectId` remains an accepted alias for the external
  // Codex id for callers that only have one identifier.
  const targetProjectId = String(input.targetProjectId || input.harnessProjectId || (input.codexProjectId ? input.projectId : "") || "").trim();
  const existing = state.projects.find((item) => (targetProjectId && item.id === targetProjectId)
    || item.codexProjectId === codexProjectId
    || item.codexImport?.codexProjectId === codexProjectId);
  if (existing) {
    const boundCodexProjectId = String(existing.codexImport?.codexProjectId || existing.codexProjectId || "").trim();
    if (boundCodexProjectId && boundCodexProjectId !== codexProjectId) {
      throw new Error(`CODEX_IMPORT_SOURCE_REBIND_REQUIRED: Harness 项目已绑定 ${boundCodexProjectId}，不能静默改绑到 ${codexProjectId}`);
    }
    const requestedPath = String(input.path || input.root || "").trim();
    if (requestedPath) {
      const resolvedPath = path.resolve(requestedPath);
      if (!String(existing.path || "").trim()) existing.path = resolvedPath;
      else if (path.resolve(existing.path).toLowerCase() !== resolvedPath.toLowerCase()) {
        throw new Error(`CODEX_IMPORT_PATH_MISMATCH: Harness 项目目录 ${existing.path} 不属于所选 Codex Project 根 ${resolvedPath}`);
      }
    }
    const active = existing.tasks.find((task) => task.workstream === "codex-project-import"
      && ["ready", "in_progress", "awaiting_result", "review", "changes_requested", "failed"].includes(task.status));
    if (active) {
      state.selectedProjectId = existing.id;
      return { project: existing, task: active, reused: true };
    }
  }
  const name = String(input.name || input.projectName || input.title || `Codex Project ${codexProjectId.slice(0, 12)}`).trim().slice(0, 160);
  const project = existing || createBlankProject(state, {
    name,
    path: input.path || input.root || "",
    goal: "从 Codex Project 回填完整项目状态、任务、会话与证据。",
    objective: "完成 Codex Project → Harness 的完整回填",
  });
  project.source = { kind: "codex-import", label: "待从 Codex Project 回填" };
  project.codexProjectId = codexProjectId;
  project.codexImport = {
    ...(project.codexImport || {}),
    status: "queued",
    codexProjectId,
    requestedAt: now(),
    taskId: undefined,
    startedAt: undefined,
    completedAt: undefined,
    failedAt: undefined,
    error: undefined,
    candidateAt: undefined,
    candidateHash: undefined,
    threadId: undefined,
    detail: "等待 Codex Agent 回填任务、CTO、Review、进度、Git 与会话归档。",
  };
  const task = createTask(state, project.id, {
    title: `从 Codex Project 导入 ${project.name}`,
    workstream: "codex-project-import",
    criteria: [
      "读取 Codex Project 的完整会话与历史摘要",
      "回填 CTO、Review、任务与未完成事项",
      "核对项目最新进展、Git 状态与 GitHub 证据",
      "为每条回填数据保存来源与时间戳，不覆盖用户已审核内容",
    ].join("\n"),
    agent: "codex",
    sessionPolicy: "warm",
    reviewMode: "user",
    priority: "high",
  });
  project.codexImport.taskId = task.id;
  project.events.unshift({ id: randomUUID(), type: "project.codex-import.requested", at: project.codexImport.requestedAt, detail: `${project.name} · ${codexProjectId}` });
  project.updatedAt = project.codexImport.requestedAt;
  state.selectedProjectId = project.id;
  return { project, task, reused: false };
}

/**
 * Store a structured snapshot returned by the Codex import Agent as a
 * reviewable candidate.  Import candidates intentionally do not mutate the
 * project's durable contract, tasks, Git or checkpoints yet; that only
 * happens after the user accepts the candidate through the import gate.
 */
function recordCodexImportCandidate(state, projectId, taskId, candidate, metadata = {}) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.workstream !== "codex-project-import") throw new Error("Task is not a Codex project import");
  if (!candidate || typeof candidate !== "object" || candidate.type !== "harness-import" || candidate.version !== 1) {
    throw new Error("Invalid harness-import candidate");
  }
  assertCodexImportCandidateIdentity(project, candidate);
  assertCodexImportIsNotStale(project, candidate);
  const serialized = JSON.stringify(candidate);
  const fingerprint = createHash("sha256").update(serialized).digest("hex");
  if (task.importCandidateHash === fingerprint && task.importCandidate) return task;
  const sourceRevision = candidate.source?.sourceRevision ?? candidate.project?.sourceRevision;
  const counts = {
    tasks: Array.isArray(candidate.tasks) ? candidate.tasks.length : 0,
    sections: Array.isArray(candidate.sections) ? candidate.sections.length : 0,
    checkpoints: Array.isArray(candidate.checkpoints) ? candidate.checkpoints.length : 0,
    decisions: Array.isArray(candidate.decisions) ? candidate.decisions.length : 0,
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions.length : 0,
  };
  const summaryParts = Object.entries(counts).filter(([, value]) => value > 0).map(([key, value]) => `${key} ${value}`);
  const latestCheckpoint = Array.isArray(candidate.checkpoints) ? candidate.checkpoints[0] : undefined;
  const summary = latestCheckpoint?.summary
    ? `Codex 最新进展：${String(latestCheckpoint.summary).slice(0, 320)}${summaryParts.length ? `（回填 ${summaryParts.join("、")}）` : ""}`
    : `Codex Project 回填候选已生成${summaryParts.length ? `：${summaryParts.join("、")}` : ""}。`;
  const evidence = [
    { type: "codex-project", value: String(candidate.source?.codexProjectId || project.codexProjectId || "未提供") },
    ...(sourceRevision !== undefined ? [{ type: "source-revision", value: `R${sourceRevision}` }] : []),
    ...(candidate.git?.commits?.[0]?.hash ? [{ type: "git-head", value: String(candidate.git.commits[0].hash) }] : []),
  ];
  task.importCandidate = JSON.parse(serialized);
  task.importCandidateHash = fingerprint;
  task.candidate = {
    summary,
    completed: ["Codex Project 已完成只读盘点", "原始 Agent 运行与关联 rollout 正在上下文外独立归档"],
    remaining: ["等待用户审核后写入 Harness 项目字段"],
    nextStep: latestCheckpoint?.nextStep ? String(latestCheckpoint.nextStep).slice(0, 1000) : "核对导入数量、最新进展和 Git/GitHub 证据；确认后写入项目。",
    acceptance: [
      { criterion: "来源 Project 与项目根目录已核对", status: "pass" },
      { criterion: "任务、Section、会话和进展可追溯", status: "pending" },
      { criterion: "Git / GitHub 信息来自 Agent 最新只读盘点", status: "pending" },
    ],
    evidence,
  };
  if (task.run) {
    task.run.status = "awaiting_review";
    task.run.phase = "awaiting_review";
    task.run.progress = 100;
    task.run.submittedAt ||= now();
  }
  task.status = "review";
  updateSectionForTask(project, task, "review");
  task.review = {
    status: "queued",
    agent: "codex",
    sessionId: project.controlSessions?.reviewId,
    queuedAt: now(),
  };
  project.codexImport = {
    ...(project.codexImport || {}),
    status: "awaiting_review",
    candidateHash: fingerprint,
    sourceRevision,
    sourceGeneratedAt: candidate.generatedAt,
    candidateAt: now(),
  };
  project.events ||= [];
  project.events.unshift({
    id: randomUUID(),
    type: "codex.project.import.candidate",
    at: now(),
    detail: `${project.name} · ${summary}`,
  });
  project.updatedAt = now();
  return task;
}

/** Mark an already-applied import candidate as accepted and advance the
 * local Project HEAD through the same review transaction as ordinary tasks. */
function acceptCodexImportCandidate(state, projectId, taskId) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.workstream !== "codex-project-import" || task.status !== "review" || !task.importCandidate) {
    throw new Error("No Codex import candidate to accept");
  }
  if (!task.candidate) throw new Error("Codex import review summary is missing");
  assertCodexImportCandidateIdentity(project, task.importCandidate);
  assertCodexImportIsNotStale(project, task.importCandidate);
  // Import is a read-only snapshot, so it can be reviewed after unrelated
  // local tasks advance HEAD. Rebase the import transaction to the current
  // revision immediately before creating its acceptance checkpoint.
  const sourceRevision = Number(project.codexImport?.sourceRevision);
  if (Number.isInteger(sourceRevision) && sourceRevision > project.revision) project.revision = sourceRevision;
  if (task.run) {
    task.run.baseRevision = project.revision;
    task.run.contractRevision = Number(project.contractRevision || 1);
    task.baseRevision = project.revision;
    task.contractRevision = Number(project.contractRevision || 1);
  }
  const checkpoint = acceptTaskResult(state, projectId, taskId);
  const timestamp = now();
  task.importAppliedAt = timestamp;
  project.codexImport = {
    ...(project.codexImport || {}),
    status: "completed",
    completedAt: timestamp,
    detail: "Codex Project 候选已由用户确认并写入 Harness。",
  };
  project.events.unshift({ id: randomUUID(), type: "codex.project.import.accepted", at: timestamp, detail: project.name });
  project.updatedAt = timestamp;
  return checkpoint;
}

/** Keep an import candidate visible while making the task retryable. */
function requestCodexImportChanges(state, projectId, taskId) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.workstream !== "codex-project-import" || task.status !== "review" || !task.importCandidate) {
    throw new Error("No Codex import candidate to revise");
  }
  const timestamp = now();
  task.status = "changes_requested";
  task.candidate = undefined;
  task.importCandidate = undefined;
  task.importCandidateHash = undefined;
  if (task.run) {
    task.run.status = "failed";
    task.run.phase = "changes_requested";
    task.run.error = "用户要求重新盘点 Codex Project";
    task.run.completedAt ||= timestamp;
  }
  updateSectionForTask(project, task, "changes_requested");
  project.codexImport = { ...(project.codexImport || {}), status: "queued", detail: "用户要求重新盘点，可重新启动导入。" };
  project.events.unshift({ id: randomUUID(), type: "codex.project.import.changes_requested", at: timestamp, detail: project.name });
  project.updatedAt = timestamp;
  return task;
}

/** Reject an import without deleting its raw run archive or provenance. */
function rejectCodexImportCandidate(state, projectId, taskId, reason = "用户拒绝 Codex 项目导入") {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.workstream !== "codex-project-import" || task.status !== "review" || !task.importCandidate) {
    throw new Error("No Codex import candidate to reject");
  }
  const timestamp = now();
  task.rejectedImportCandidate = task.importCandidate;
  task.importCandidate = undefined;
  task.importCandidateHash = undefined;
  task.candidate = undefined;
  task.status = "failed";
  if (task.run) {
    task.run.status = "failed";
    task.run.phase = "rejected";
    task.run.error = String(reason || "用户拒绝 Codex 项目导入").slice(0, 500);
    task.run.completedAt ||= timestamp;
  }
  task.review = { ...(task.review || {}), status: "changes_requested", automatic: false, reviewedAt: timestamp, notes: task.run?.error };
  updateSectionForTask(project, task, "failed");
  project.codexImport = { ...(project.codexImport || {}), status: "failed", error: task.run?.error, failedAt: timestamp };
  project.events.unshift({ id: randomUUID(), type: "codex.project.import.rejected", at: timestamp, detail: `${project.name} · ${task.run?.error || reason}` });
  project.updatedAt = timestamp;
  return task;
}

function createTask(state, projectId, input) {
  const project = getProject(state, projectId);
  ensureProjectSections(project);
  if (project.status === "archived") throw new Error("已归档项目不能新建任务，请先恢复项目");
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Task title is required");
  const timestamp = now();
  const task = {
    id: randomUUID(),
    title,
    workstream: String(input.workstream || "general").trim() || "general",
    criteria: String(input.criteria || "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    agent: input.agent === "claude" ? "claude" : input.agent === "hermes" ? "hermes" : "codex",
    sessionPolicy: ["auto", "warm", "disposable"].includes(input.sessionPolicy) ? input.sessionPolicy : "auto",
    sectionId: input.sectionId ? String(input.sectionId) : undefined,
    reviewMode: input.reviewMode === "auto" ? "auto" : "user",
    priority: ["low", "normal", "high", "urgent"].includes(input.priority) ? input.priority : "normal",
    dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn.map(String).filter(Boolean).slice(0, 20) : String(input.dependsOn || "").split(/[\s,]+/).filter(Boolean).slice(0, 20),
    status: "ready",
    baseRevision: project.revision,
    contractRevision: Number(project.contractRevision || 1),
    createdAt: timestamp,
  };
  if (task.sectionId) {
    const section = getSection(project, task.sectionId);
    if (!section) throw new Error("Section not found");
    if (section.kind === "main") throw new Error("主控 Section 只负责调配和审核，不能直接执行任务");
    if (["closed", "archived"].includes(section.status)) throw new Error("Section 已关闭，不能继续派发任务");
    if ((section.taskIds || []).length >= Number(section.maxTasks || (section.kind === "one-shot" ? 1 : 20))) throw new Error("Section 已达到任务上限，请新建或恢复另一个 Section");
  }
  project.tasks.unshift(task);
  if (task.sectionId) assignTaskToSection(state, projectId, task.id, task.sectionId);
  project.updatedAt = timestamp;
  project.events.unshift({ id: randomUUID(), type: "task.created", at: timestamp, detail: task.title });
  return task;
}

function createAndDispatchOnboarding(state, projectId) {
  const project = getProject(state, projectId);
  const active = project.tasks.find(
    (task) => task.workstream === "project-onboarding" && ["ready", "in_progress", "review", "changes_requested"].includes(task.status),
  );
  if (active?.status === "in_progress" && active.run) {
    const session = project.sessions.find((item) => item.id === active.run.sessionId);
    if (!session) throw new Error("Onboarding Session not found");
    return { task: active, session, missionPacket: buildMissionPacket(project, active, session), reused: true };
  }
  const task = active || createTask(state, projectId, {
    title: `接管 ${project.name} 并建立项目画像`,
    workstream: "project-onboarding",
    criteria: "识别真实技术栈、入口和现有文档\n核对当前 Git 状态与最近进展\n提出最小可验收的下一项任务",
    agent: "codex",
    sessionPolicy: "warm",
  });
  return { ...dispatchTask(state, projectId, task.id), reused: false };
}

function attachExternalThread(state, projectId, taskId, external) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (!task.run) throw new Error("Task has no active run");
  task.run.externalThreadId = String(external.threadId || "");
  task.run.externalTurnId = external.turnId ? String(external.turnId) : undefined;
  task.run.externalAgent = "codex";
  task.run.externalProjectId = external.projectId ? String(external.projectId) : undefined;
  task.run.processId = Number.isFinite(Number(external.processId)) ? Number(external.processId) : undefined;
  task.run.status = "running";
  task.run.phase = "agent_starting";
  task.run.progress = Math.max(task.run.progress || 0, 8);
  task.run.lastEventAt = now();
  task.run.desktopOpened = Boolean(external.desktopOpened);
  task.launchError = undefined;
  project.events.unshift({ id: randomUUID(), type: "codex.thread.started", at: now(), detail: task.run.externalThreadId });
  project.updatedAt = now();
  return task;
}

function recordAgentEvent(state, projectId, taskId, event = {}) {
  const project = getProject(state, projectId);
  project.events ||= [];
  const task = getTask(project, taskId);
  if (!task.run) throw new Error("Task has no active run");
  const at = event.at || now();
  task.run.eventCount = (task.run.eventCount || 0) + 1;
  task.run.lastEventAt = at;
  if (event.phase) task.run.phase = String(event.phase);
  if (Number.isFinite(Number(event.progress))) task.run.progress = Math.max(0, Math.min(100, Number(event.progress)));
  if (event.detail) task.run.lastEvent = String(event.detail).slice(0, 500);
  project.events.unshift({
    id: randomUUID(),
    type: event.type || "agent.event",
    at,
    detail: String(event.detail || event.type || "Agent event").slice(0, 500),
  });
  project.updatedAt = at;
  return task;
}

function markRunCompleted(state, projectId, taskId, detail) {
  const project = getProject(state, projectId);
  project.events ||= [];
  const task = getTask(project, taskId);
  if (!task.run) throw new Error("Task has no active run");
  const completedAt = now();
  task.run.status = "completed";
  task.run.phase = "completed";
  task.run.progress = 100;
  task.run.userActionRequired = false;
  task.run.completedAt = completedAt;
  task.run.lastEventAt = completedAt;
  if (detail) task.run.lastEvent = String(detail).slice(0, 500);
  if (task.status === "in_progress") task.status = "awaiting_result";
  if (task.workstream === "codex-project-import" && !task.importCandidate && task.status !== "review") {
    task.status = "failed";
    task.run.status = "failed";
    task.run.phase = "invalid_result";
    task.run.error = "Codex 运行结束但未返回 harness-import 候选";
    updateSectionForTask(project, task, "failed");
    project.codexImport = {
      ...(project.codexImport || {}),
      status: "failed",
      error: "Codex 运行结束但未返回 harness-import 候选",
      failedAt: completedAt,
      detail: "未收到结构化回填，可重新启动导入。",
    };
  }
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  // An automatic Review Agent can accept the candidate before the app-server
  // emits turn/completed. Do not regress an accepted/changes-requested task
  // back into an awaiting-result session when that late event arrives.
  if (session) {
    if (task.status === "review") session.status = "awaiting_review";
    else if (task.status === "awaiting_result") session.status = "awaiting_result";
    else if (task.status === "failed") session.status = session.type === "disposable" ? "retired" : "warm";
  }
  project.events.unshift({ id: randomUUID(), type: task.workstream === "codex-project-import" && !task.importCandidate ? "agent.run.invalid-result" : "agent.run.completed", at: completedAt, detail: task.title });
  project.updatedAt = completedAt;
  return task;
}

function markRunFailed(state, projectId, taskId, error) {
  const project = getProject(state, projectId);
  project.events ||= [];
  const task = getTask(project, taskId);
  if (!task.run) throw new Error("Task has no active run");
  const failedAt = now();
  const message = String(error || "Agent 执行失败");
  task.run.status = "failed";
  task.run.phase = "failed";
  task.run.error = message;
  task.run.completedAt = failedAt;
  task.run.lastEventAt = failedAt;
  task.run.lastEvent = message.slice(0, 500);
  task.status = "failed";
  if (task.workstream === "codex-project-import") {
    project.codexImport = {
      ...(project.codexImport || {}),
      status: "failed",
      error: message,
      failedAt: failedAt,
      detail: "Codex 回填失败，可重新启动导入。",
    };
  }
  updateSectionForTask(project, task, "failed");
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) session.status = session.type === "disposable" ? "retired" : "warm";
  project.events.unshift({ id: randomUUID(), type: "agent.run.failed", at: failedAt, detail: message });
  project.updatedAt = failedAt;
  return task;
}

function recordGitSnapshot(state, projectId, gitSnapshot) {
  const project = getProject(state, projectId);
  project.gitSnapshot = gitSnapshot ? JSON.parse(JSON.stringify(gitSnapshot)) : undefined;
  project.updatedAt = now();
  return project.gitSnapshot;
}

/**
 * Record what the Harness can actually prove about the external Codex
 * Project.  A successful app-server `project/create` proves the official
 * database row, but not that an already-running Desktop renderer has loaded
 * it.  Keep that distinction durable so the UI cannot turn a database fact
 * into a false sidebar claim.
 */
function setCodexProjectSync(state, projectId, input = {}) {
  const project = getProject(state, projectId);
  const officialProjectId = String(input.officialProjectId || project.codexProjectId || "").trim();
  const requestedState = String(input.state || "").trim();
  const syncState = CODEX_PROJECT_SYNC_STATES.includes(requestedState)
    ? requestedState
    : (officialProjectId ? "desktop-restart-required" : "not-created");
  const next = {
    state: syncState,
    ...(officialProjectId ? { officialProjectId } : {}),
    ...(input.legacyProjectId ? { legacyProjectId: String(input.legacyProjectId) } : {}),
    checkedAt: String(input.checkedAt || now()),
    ...(input.detail ? { detail: String(input.detail).slice(0, 500) } : syncState === "desktop-restart-required" ? { detail: CODEX_PROJECT_RESTART_DETAIL } : {}),
  };
  const comparable = (value) => JSON.stringify({
    state: value?.state,
    officialProjectId: value?.officialProjectId,
    legacyProjectId: value?.legacyProjectId,
    detail: value?.detail,
  });
  if (comparable(project.codexProjectSync) !== comparable(next)) {
    project.codexProjectSync = next;
    project.updatedAt = now();
  } else if (project.codexProjectSync) {
    // Keep the original evidence timestamp stable during heartbeat refreshes.
    next.checkedAt = project.codexProjectSync.checkedAt;
  }
  return project.codexProjectSync;
}

function recordCodexProjectSyncError(state, projectId, error, stage = "sync") {
  const project = getProject(state, projectId);
  const timestamp = now();
  const message = String(error || "Codex Project 同步失败").slice(0, 1000);
  project.codexSyncError = { message, stage: String(stage || "sync").slice(0, 80), at: timestamp, retryable: true };
  project.events ||= [];
  project.events.unshift({ id: randomUUID(), type: "codex.project.sync.failed", at: timestamp, detail: `${stage}: ${message}` });
  project.updatedAt = timestamp;
  return project.codexSyncError;
}

function setExternalDesktopOpened(state, projectId, taskId, opened) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (!task.run?.externalThreadId) throw new Error("Task has no external Codex thread");
  task.run.desktopOpened = Boolean(opened);
  project.updatedAt = now();
  return task;
}

function markControlSessionOpened(state, projectId, role, packetPath) {
  const project = getProject(state, projectId);
  const session = project.sessions.find((item) => item.role === role);
  if (!session) throw new Error(`${role} control session not found`);
  session.lastOpenedAt = now();
  if (packetPath) session.pendingDraftPath = String(packetPath);
  project.events.unshift({ id: randomUUID(), type: `control-session.${role}.opened`, at: now(), detail: session.id });
  project.updatedAt = now();
  return session;
}

function markExternalLaunchFailed(state, projectId, taskId, error) {
  const project = getProject(state, projectId);
  project.events ||= [];
  const task = getTask(project, taskId);
  task.status = "ready";
  updateSectionForTask(project, task, "failed");
  task.launchError = String(error || "Codex launch failed");
  const session = task.run && project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) session.status = "retired";
  task.run = undefined;
  if (task.workstream === "codex-project-import") {
    project.codexImport = {
      ...(project.codexImport || {}),
      status: "failed",
      error: task.launchError,
      failedAt: now(),
      detail: "Codex 回填对话未能启动，可重试。",
    };
  }
  project.events.unshift({ id: randomUUID(), type: "codex.thread.failed", at: now(), detail: task.launchError });
  project.updatedAt = now();
  return task;
}

function selectWarmSession(project, task) {
  return project.sessions.find(
    (session) => session.agent === task.agent
      && session.workstream === task.workstream
      && session.status === "warm"
      && Number(session.acceptedTaskCount || 0) < Number(session.maxAcceptedTasks || 5)
      && project.revision - Number(session.cursor || 0) <= Number(session.maxRevisionLag || 3),
  );
}

function dispatchTask(state, projectId, taskId) {
  const project = getProject(state, projectId);
  project.sessions ||= [];
  project.events ||= [];
  const task = getTask(project, taskId);
  ensureProjectSections(project);
  if (project.status !== "active") throw new Error(`项目当前为“${project.status || "未知"}”，不能启动任务`);
  if (!["ready", "backlog", "changes_requested", "failed"].includes(task.status)) throw new Error("Task cannot be dispatched");
  const dependencies = (task.dependsOn || []).map((id) => project.tasks.find((item) => item.id === id));
  const unknownDependencies = (task.dependsOn || []).filter((id) => !project.tasks.some((item) => item.id === id));
  if (unknownDependencies.length) throw new Error("任务依赖不存在，请先确认依赖任务");
  const unmet = dependencies.filter((item) => item && item.status !== "accepted");
  if (unmet.length) throw new Error(`任务依赖尚未完成：${unmet.map((item) => item.title).join("、")}`);

  let section = getSection(project, task.sectionId);
  if (!section) {
    // A task created from the compact MVP form gets a reusable workstream
    // section automatically. The main steward remains non-executable.
    section = (project.sections || []).find((item) => item.kind === "reusable" && item.workstream === task.workstream && item.agent === task.agent && item.status !== "closed" && item.status !== "archived");
    if (!section) {
      section = createSection(state, projectId, { name: task.workstream || "通用工作流", kind: task.sessionPolicy === "disposable" ? "one-shot" : "reusable", agent: task.agent });
      section.workstream = task.workstream;
    }
    task.sectionId = section.id;
    if (!section.taskIds.includes(task.id)) section.taskIds.push(task.id);
  }
  if (section.kind === "main") throw new Error("主控 Section 只负责调配和审核，不能直接执行任务");
  if (["closed", "archived"].includes(section.status)) {
    throw new Error("Section 已关闭，请先改派到可用 Section 后再启动任务");
  }
  if (section.approvalMode === "auto" && task.reviewMode !== "auto") task.reviewMode = "auto";

  const sectionSession = section.sessionId && project.sessions.find((item) => item.id === section.sessionId && item.status === "warm" && item.agent === task.agent);
  const forceDisposable = section.kind === "one-shot";
  let session = (task.sessionPolicy === "disposable" || forceDisposable) ? undefined : sectionSession || selectWarmSession(project, task);
  if (!session) {
    session = {
      id: randomUUID(),
      role: "task",
      title: `Task · ${task.title}`,
      agent: task.agent,
      type: (task.sessionPolicy === "disposable" || forceDisposable) ? "disposable" : "warm",
      status: "executing",
      workstream: task.workstream,
      cursor: project.revision,
      taskIds: [],
      acceptedTaskCount: 0,
      maxAcceptedTasks: 5,
      maxRevisionLag: 3,
      createdAt: now(),
    };
    project.sessions.unshift(session);
  } else {
    session.status = "executing";
  }
  if (!session.taskIds.includes(task.id)) session.taskIds.push(task.id);
  section.sessionId = session.id;
  section.reusable = section.kind === "reusable";
  task.sessionId = session.id;

  task.status = "in_progress";
  task.baseRevision = project.revision;
  task.run = {
    id: randomUUID(),
    sessionId: session.id,
    baseRevision: project.revision,
    contractRevision: Number(project.contractRevision || 1),
    startedAt: now(),
    status: "starting",
    phase: "queued",
    progress: 4,
    eventCount: 0,
    sectionId: section.id,
    reviewSessionId: project.controlSessions?.reviewId,
  };
  task.candidate = undefined;
  section.status = "running";
  section.updatedAt = now();
  project.events.unshift({
    id: randomUUID(),
    type: "task.dispatched",
    at: task.run.startedAt,
    detail: `${task.title} · run ${task.run.id} · section ${section.id} · ${task.agent}`,
  });
  project.updatedAt = now();
  return { task, session, missionPacket: buildMissionPacket(project, task, session) };
}

/** Prepare a Claude Code/Hermes task for a user-invoked session. No PTY or
 * OAuth automation is attempted; the durable run simply waits for the user
 * to open the workspace, use the injected skill, and submit a result. */
function prepareUserAgentTask(state, projectId, taskId) {
  const result = dispatchTask(state, projectId, taskId);
  if (!["claude", "hermes"].includes(result.task.agent)) throw new Error("Only user-invoked agents use this path");
  result.task.status = "awaiting_result";
  result.task.run.status = "awaiting_user";
  result.task.run.phase = "user_action_required";
  result.task.run.progress = 0;
  result.task.run.userActionRequired = true;
  result.task.run.externalAgent = result.task.agent;
  result.session.status = "awaiting_result";
  result.project = getProject(state, projectId);
  result.project.events.unshift({ id: randomUUID(), type: "agent.user-action-required", at: now(), detail: `${result.task.agent} · ${result.task.title}` });
  result.project.updatedAt = now();
  return result;
}

function stopTask(state, projectId, taskId, reason = "用户停止任务") {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (!task.run || !["in_progress", "awaiting_result", "review"].includes(task.status)) throw new Error("Task is not running");
  const stoppedAt = now();
  task.status = "failed";
  task.run.status = "failed";
  task.run.phase = "stopped";
  task.run.userActionRequired = false;
  task.run.error = String(reason || "用户停止任务").slice(0, 500);
  task.run.lastEvent = task.run.error;
  task.run.completedAt = stoppedAt;
  task.run.lastEventAt = stoppedAt;
  if (task.workstream === "codex-project-import") {
    project.codexImport = {
      ...(project.codexImport || {}),
      status: "failed",
      error: task.run.error,
      failedAt: stoppedAt,
      detail: "导入已停止，可重新启动。",
    };
  }
  updateSectionForTask(project, task, "failed");
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) session.status = session.type === "disposable" ? "retired" : "warm";
  project.events.unshift({ id: randomUUID(), type: "task.stopped", at: stoppedAt, detail: `${task.title} · ${task.run.error}` });
  project.updatedAt = stoppedAt;
  return task;
}

function createConversationSession(state, projectId, input = {}) {
  const project = getProject(state, projectId);
  if (project.status === "archived") throw new Error("已归档项目不能创建新对话");
  ensureProjectSections(project);
  project.events ||= [];
  const title = String(input.title || "项目讨论").trim().slice(0, 240) || "项目讨论";
  const timestamp = now();
  const session = {
    id: randomUUID(),
    role: "conversation",
    title: `${project.name} · ${title}`,
    agent: input.agent === "claude" ? "claude" : input.agent === "hermes" ? "hermes" : "codex",
    type: input.type === "disposable" ? "disposable" : "warm",
    status: "warm",
    workstream: String(input.workstream || "project-discussion").trim() || "project-discussion",
    cursor: project.revision,
    taskIds: [],
    createdAt: timestamp,
    createdBy: "user",
  };
  project.sessions.unshift(session);
  project.events.unshift({ id: randomUUID(), type: "conversation.created", at: timestamp, detail: session.title });
  project.updatedAt = timestamp;
  return session;
}

function buildMissionPacket(project, task, session) {
  const accepted = project.checkpoints[0];
  const section = getSection(project, task.sectionId);
  // launchHarnessTask creates a fresh provider thread. A logical warm Section
  // is useful for routing, but it is not proof that the provider has prior
  // context, so every new task gets a self-contained FULL packet.
  const recentCheckpoints = project.checkpoints.slice(0, 6);
  const packet = [
    "# AI Project Harness · FULL PACKET",
    `PROJECT: ${project.name}`,
    `PROJECT_REVISION: R${project.revision}`,
    `CONTRACT_REVISION: C${Number(project.contractRevision || 1)}`,
    `SESSION_CURSOR: R${session.cursor}`,
    `PROJECT_GOAL: ${project.goal || "尚未填写项目目标。"}`,
    `OBJECTIVE: ${project.objective.title}`,
    `PROJECT_STATUS: ${project.status || "active"}`,
    `TASK: ${task.title}`,
    `WORKSTREAM: ${task.workstream}`,
    `PRIORITY: ${task.priority || "normal"}`,
    `SECTION: ${section?.name || "自动工作区"} (${section?.kind || "reusable"})`,
    project.techStack?.length ? `TECH_STACK: ${project.techStack.join(", ")}` : "TECH_STACK: not registered",
    project.profile?.entrypoints?.length ? `ENTRYPOINTS: ${project.profile.entrypoints.join(", ")}` : "ENTRYPOINTS: not detected",
    "ACCEPTANCE:",
    ...(task.criteria.length ? task.criteria.map((item, index) => `${index + 1}. ${item}`) : ["1. Complete the task and provide verifiable evidence."]),
    `LATEST_ACCEPTED_CHECKPOINT: ${accepted ? accepted.summary : "None"}`,
    ...(recentCheckpoints.length ? ["RECENT_ACCEPTED_CHECKPOINTS:", ...recentCheckpoints.map((item) => `- R${item.revision}: ${item.summary}`)] : []),
    project.constraints?.length ? `CONSTRAINTS: ${project.constraints.slice(0, 10).join("; ")}` : "CONSTRAINTS: none recorded",
    project.blockers?.length ? `BLOCKERS: ${project.blockers.slice(0, 5).join("; ")}` : "BLOCKERS: none recorded",
    "RETURN: submit a structured Task Result with summary, acceptance status, evidence, remaining work, and next step.",
  ].join("\n");
  const maxChars = Number(section?.maxContextChars || 12000);
  if (packet.length <= maxChars) return packet;
  const suffix = "\n[任务包已按 Section 上下文预算裁剪；请通过 Harness context 按需读取完整证据。]";
  return `${packet.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function submitTaskResult(state, projectId, taskId, input) {
  const project = getProject(state, projectId);
  ensureProjectControlSessions(project);
  project.events ||= [];
  const task = getTask(project, taskId);
  if (!(task.status === "in_progress" || task.status === "awaiting_result") || !task.run) throw new Error("Task is not in progress");
  if (Number(task.run.contractRevision || 0) !== Number(project.contractRevision || 1)) {
    throw new Error(`STALE_CONTRACT: run is based on C${task.run.contractRevision || 0}, current contract is C${project.contractRevision || 1}`);
  }
  const summary = String(input.summary || "").trim().slice(0, 4000);
  if (!summary) throw new Error("Result summary is required");
  const normalizeList = (value) => Array.isArray(value) ? value.map(String).map((item) => item.trim().slice(0, 800)).filter(Boolean).slice(0, 50) : [];
  const acceptance = Array.isArray(input.acceptance)
    ? input.acceptance.filter((item) => item && typeof item === "object").slice(0, 50).map((item, index) => ({
      criterion: String(item.criterion || task.criteria[index] || `验收条件 ${index + 1}`).trim().slice(0, 600),
      status: ["pass", "fail", "pending"].includes(String(item.status || "").toLowerCase()) ? String(item.status).toLowerCase() : "pending",
    }))
    : [];
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((item) => item && typeof item === "object").slice(0, 50).map((item) => ({
      type: String(item.type || "note").trim().slice(0, 80) || "note",
      value: String(item.value || "").trim().slice(0, 1200),
    })).filter((item) => item.value)
    : [];
  task.candidate = {
    summary,
    completed: normalizeList(input.completed),
    remaining: normalizeList(input.remaining),
    nextStep: String(input.nextStep || "").trim().slice(0, 2000),
    acceptance,
    evidence,
  };
  task.run.submittedAt = now();
  task.run.resultSource = input.source === "agent-auto" ? "agent-auto" : "manual";
  task.run.status = "awaiting_review";
  task.run.phase = "awaiting_review";
  task.status = "review";
  updateSectionForTask(project, task, "review");
  task.review = {
    status: "queued",
    agent: "codex",
    sessionId: project.controlSessions?.reviewId,
    queuedAt: now(),
  };
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) session.status = "awaiting_review";
  project.updatedAt = now();
  return task;
}

function autoReviewTaskResult(state, projectId, taskId, options = {}) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.status !== "review" || !task.candidate || !task.run) throw new Error("No candidate result to review");
  const reviewedAt = now();
  if (state.recovery?.mode === "safe-recovery" && state.recovery?.status === "unrecoverable") {
    task.review = {
      status: "inconclusive",
      agent: "codex",
      automatic: false,
      sessionId: project.controlSessions?.reviewId,
      reviewedAt,
      notes: "安全恢复模式禁止产生新的接受记录，请先恢复可信状态。",
    };
    return task;
  }
  const requiredCriteria = (task.criteria || []).map((item) => String(item).trim()).filter(Boolean);
  const submittedCriteria = (task.candidate.acceptance || []).map((item) => String(item.criterion || "").trim()).filter(Boolean);
  const failedCriteria = task.candidate.acceptance.filter((item) => String(item.status).toLowerCase() === "fail");
  const hasDuplicateCriteria = new Set(submittedCriteria).size !== submittedCriteria.length;
  const hasExactCriteria = requiredCriteria.length > 0
    && submittedCriteria.length === requiredCriteria.length
    && requiredCriteria.every((criterion) => submittedCriteria.includes(criterion));
  const allRequiredPass = hasExactCriteria
    && task.candidate.acceptance.every((item) => String(item.status).toLowerCase() === "pass");
  const hasEvidence = Array.isArray(task.candidate.evidence)
    && task.candidate.evidence.some((item) => String(item?.value || "").trim());
  const approved = !hasDuplicateCriteria && allRequiredPass && hasEvidence;
  const inconclusive = failedCriteria.length === 0 && !approved;
  task.review = {
    status: approved ? "approved" : inconclusive ? "inconclusive" : "changes_requested",
    agent: "codex",
    automatic: approved && options.accept !== false,
    sessionId: project.controlSessions?.reviewId,
    reviewedAt,
    notes: approved
      ? "Review Agent 已核对完整验收项与非空证据。"
      : inconclusive
        ? "自动审核证据不完整：验收项必须与任务契约一一对应、全部通过且至少包含一条证据。"
        : `有 ${failedCriteria.length} 条验收条件未通过。`,
  };
  const reviewSession = project.sessions.find((session) => session.id === project.controlSessions?.reviewId);
  if (reviewSession) {
    reviewSession.status = "warm";
    reviewSession.lastReviewedAt = reviewedAt;
  }
  project.events.unshift({ id: randomUUID(), type: approved ? "review.agent.approved" : inconclusive ? "review.agent.inconclusive" : "review.agent.changes_requested", at: reviewedAt, detail: task.title });
  project.updatedAt = reviewedAt;
  if (approved && options.accept !== false) return acceptTaskResult(state, projectId, taskId);
  if (!approved && !inconclusive) requestChanges(state, projectId, taskId);
  return task;
}

function acceptTaskResult(state, projectId, taskId) {
  if (state.recovery?.mode === "safe-recovery" && state.recovery?.status === "unrecoverable") {
    throw new Error("RECOVERY_MODE: restore a trusted profile before accepting new results");
  }
  const project = getProject(state, projectId);
  project.checkpoints ||= [];
  project.events ||= [];
  const task = getTask(project, taskId);
  if (task.status !== "review" || !task.candidate || !task.run) throw new Error("No candidate result to accept");
  if (Number(task.run.contractRevision || 0) !== Number(project.contractRevision || 1)) {
    throw new Error(`STALE_CONTRACT: run is based on C${task.run.contractRevision || 0}, current contract is C${project.contractRevision || 1}`);
  }
  if (task.run.baseRevision !== project.revision) {
    throw new Error(`STALE_RESULT: run is based on R${task.run.baseRevision}, current HEAD is R${project.revision}`);
  }
  const previousRevision = project.revision;
  project.revision += 1;
  const acceptedAt = now();
  const checkpointEvidence = [...(task.candidate.evidence || [])];
  const headCommit = project.gitSnapshot?.commits?.[0];
  if (project.gitSnapshot?.available && headCommit && !checkpointEvidence.some((item) => item.type === "git-head")) {
    checkpointEvidence.push({ type: "git-head", value: `${project.gitSnapshot.branch || "DETACHED"}@${headCommit.hash || headCommit.shortHash}` });
  }
  if (project.githubSnapshot?.remote && !checkpointEvidence.some((item) => item.type === "github-remote")) {
    checkpointEvidence.push({ type: "github-remote", value: project.githubSnapshot.remote.nameWithOwner });
  }
  const checkpoint = {
    id: randomUUID(),
    parentRevision: previousRevision,
    revision: project.revision,
    taskId: task.id,
    runId: task.run.id,
    summary: task.candidate.summary,
    completed: task.candidate.completed,
    remaining: task.candidate.remaining,
    nextStep: task.candidate.nextStep,
    evidence: checkpointEvidence,
    source: {
      agent: task.agent,
      sessionId: task.run.sessionId,
      threadId: task.run.externalThreadId,
      turnId: task.run.externalTurnId,
    },
    acceptedAt,
  };
  project.checkpoints.unshift(checkpoint);
  task.status = "accepted";
  updateSectionForTask(project, task, "accepted");
  if (task.sectionId) {
    const section = getSection(project, task.sectionId);
    section.revision = project.revision;
    section.lastAcceptedAt = acceptedAt;
    section.lastReview = "approved";
    if (section.kind === "one-shot") {
      section.status = "closed";
      section.closedAt = acceptedAt;
      section.closeReason = "task.accepted";
    }
  }
  task.acceptedAt = acceptedAt;
  task.run.status = "completed";
  task.run.phase = "completed";
  task.run.progress = 100;
  task.run.completedAt ||= acceptedAt;
  task.run.userActionRequired = false;
  if (task.review) {
    task.review.status = "approved";
    task.review.acceptedAt = acceptedAt;
  }
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) {
    session.cursor = project.revision;
    session.acceptedTaskCount = Number(session.acceptedTaskCount || 0) + 1;
    session.status = session.type === "disposable" ? "retired" : "warm";
    session.lastUsedAt = acceptedAt;
    if (session.type !== "disposable" && session.acceptedTaskCount >= Number(session.maxAcceptedTasks || 5)) {
      session.status = "retired";
      session.retiredReason = "达到温会话任务上限，下一项任务将建立新上下文";
    }
  }
  project.events.unshift({ id: randomUUID(), type: "task.accepted", at: acceptedAt, detail: `${task.title} → R${project.revision}` });
  project.updatedAt = acceptedAt;
  return checkpoint;
}

function requestChanges(state, projectId, taskId) {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.status !== "review") throw new Error("Task is not awaiting review");
  task.status = "changes_requested";
  updateSectionForTask(project, task, "changes_requested");
  task.candidate = undefined;
  if (task.run) task.run.baseRevision = project.revision;
  const session = task.run && project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) session.status = "warm";
  project.updatedAt = now();
  return task;
}

function rejectTaskResult(state, projectId, taskId, reason = "用户拒绝候选结果") {
  const project = getProject(state, projectId);
  const task = getTask(project, taskId);
  if (task.status !== "review" || !task.candidate || !task.run) throw new Error("No candidate result to reject");
  const rejectedAt = now();
  task.rejectedCandidate = task.candidate;
  task.candidate = undefined;
  task.status = "failed";
  task.run.status = "failed";
  task.run.phase = "rejected";
  task.run.error = String(reason || "用户拒绝候选结果").slice(0, 500);
  task.run.completedAt ||= rejectedAt;
  task.review = { ...(task.review || {}), status: "changes_requested", notes: task.run.error, reviewedAt: rejectedAt, automatic: false };
  updateSectionForTask(project, task, "failed");
  const session = project.sessions.find((item) => item.id === task.run.sessionId);
  if (session) session.status = session.type === "disposable" ? "retired" : "warm";
  project.events.unshift({ id: randomUUID(), type: "task.rejected", at: rejectedAt, detail: `${task.title} · ${task.run.error}` });
  project.updatedAt = rejectedAt;
  return task;
}

module.exports = {
  createInitialState,
  createEmptyState,
  addProject,
  createBlankProject,
  requestCodexProjectImport,
  recordCodexImportCandidate,
  acceptCodexImportCandidate,
  requestCodexImportChanges,
  rejectCodexImportCandidate,
  createTask,
  createAndDispatchOnboarding,
  attachExternalThread,
  recordAgentEvent,
  markRunCompleted,
  markRunFailed,
  recordGitSnapshot,
  recordCodexProjectSyncError,
  setCodexProjectSync,
  setExternalDesktopOpened,
  markControlSessionOpened,
  markExternalLaunchFailed,
  dispatchTask,
  prepareUserAgentTask,
  stopTask,
  createConversationSession,
  submitTaskResult,
  autoReviewTaskResult,
  acceptTaskResult,
  requestChanges,
  rejectTaskResult,
  ensureProjectControlSessions,
  ensureProjectSections,
  createSection,
  assignTaskToSection,
  closeSection,
  archiveProject,
  archiveSection,
  restoreProject,
  setProjectStatus,
  updateProjectContract,
  ensureObjectives,
  createObjective,
  setObjectiveStatus,
  getProjectActivity,
  projectOverview,
  buildMissionPacket,
  getProject,
  shouldAutoProvisionCodexProject,
  getSection,
  boundProjectHistory,
  HISTORY_LIMITS,
  CODEX_PROJECT_SYNC_STATES,
  CODEX_PROJECT_RESTART_DETAIL,
};
