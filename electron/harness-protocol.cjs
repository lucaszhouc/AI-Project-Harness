const { randomUUID } = require("node:crypto");
const machine = require("./state-machine.cjs");

const BLOCK_PATTERNS = {
  result: /```harness-result\s*([\s\S]*?)```/gi,
  event: /```harness-event\s*([\s\S]*?)```/gi,
  decision: /```harness-decision\s*([\s\S]*?)```/gi,
};

function redact(value) {
  return String(value ?? "").replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]");
}

function clip(value, max = 800) {
  const text = redact(value).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function boundedGit(git) {
  if (!git || typeof git !== "object") return git || null;
  return {
    available: Boolean(git.available),
    error: git.error ? clip(git.error, 300) : undefined,
    detail: git.detail ? clip(git.detail, 600) : undefined,
    root: git.root ? clip(git.root, 500) : undefined,
    branch: git.branch ? clip(git.branch, 160) : undefined,
    upstream: git.upstream ? clip(git.upstream, 240) : undefined,
    ahead: Number(git.ahead || 0),
    behind: Number(git.behind || 0),
    dirty: Boolean(git.dirty),
    changeCount: Number(git.changeCount || 0),
    changes: (Array.isArray(git.changes) ? git.changes : []).slice(0, 20).map((item) => ({ code: clip(item?.code, 20), file: clip(item?.file, 500) })),
    commits: (Array.isArray(git.commits) ? git.commits : []).slice(0, 10).map((item) => ({
      hash: clip(item?.hash, 80), shortHash: clip(item?.shortHash, 20), subject: clip(item?.subject, 500), author: clip(item?.author, 160), date: clip(item?.date, 80),
    })),
    branches: (Array.isArray(git.branches) ? git.branches : []).slice(0, 50).map((item) => ({ name: clip(item?.name, 180), current: Boolean(item?.current) })),
    tags: (Array.isArray(git.tags) ? git.tags : []).slice(0, 50).map((item) => clip(item, 180)),
    checkedAt: clip(git.checkedAt, 80),
  };
}

function boundedGithub(github) {
  if (!github || typeof github !== "object") return github || null;
  const boundItem = (item) => ({
    number: item?.number,
    title: clip(item?.title, 400),
    state: clip(item?.state, 60),
    url: clip(item?.url, 600),
    updatedAt: clip(item?.updatedAt, 80),
  });
  return {
    available: Boolean(github.available),
    error: github.error ? clip(github.error, 300) : undefined,
    detail: github.detail ? clip(github.detail, 600) : undefined,
    checkedAt: clip(github.checkedAt, 80),
    detailsLoaded: Boolean(github.detailsLoaded),
    remote: github.remote ? {
      owner: clip(github.remote.owner, 120), name: clip(github.remote.name, 160),
      nameWithOwner: clip(github.remote.nameWithOwner, 300), url: clip(github.remote.url, 600),
    } : null,
    remoteName: github.remoteName ? clip(github.remoteName, 80) : undefined,
    repository: github.repository && typeof github.repository === "object" ? {
      nameWithOwner: clip(github.repository.nameWithOwner, 300), description: clip(github.repository.description, 800), url: clip(github.repository.url, 600),
    } : null,
    pullRequests: (Array.isArray(github.pullRequests) ? github.pullRequests : []).slice(0, 10).map(boundItem),
    issues: (Array.isArray(github.issues) ? github.issues : []).slice(0, 10).map(boundItem),
    gh: github.gh && typeof github.gh === "object" ? { available: Boolean(github.gh.available), authenticated: github.gh.authenticated === true, error: github.gh.error ? clip(github.gh.error, 400) : undefined } : undefined,
  };
}

function parseJsonBlocks(text, kind = "result") {
  const pattern = BLOCK_PATTERNS[kind] || BLOCK_PATTERNS.result;
  pattern.lastIndex = 0;
  const output = [];
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    try {
      const value = JSON.parse(match[1].trim());
      if (value && typeof value === "object" && !Array.isArray(value)) output.push(value);
    } catch {
      // Ignore an incomplete block and keep scanning for a later complete one.
    }
  }
  return output;
}

function buildProjectContext(project, { maxTasks = 20, maxCheckpoints = 8, maxEvents = 20 } = {}) {
  if (!project) throw new Error("Project is required");
  const sectionById = new Map((Array.isArray(project.sections) ? project.sections : []).map((section) => [section.id, section]));
  return {
    version: 1,
    project: {
      id: clip(project.id, 120),
      name: clip(project.name, 240),
      path: clip(project.path, 800),
      status: clip(project.status, 60),
      revision: Number(project.revision || 0),
      goal: clip(project.goal, 4000),
      objective: project.objective ? { id: clip(project.objective.id, 120), title: clip(project.objective.title, 1200), status: clip(project.objective.status, 60) } : null,
      techStack: (Array.isArray(project.techStack) ? project.techStack : []).slice(0, 20).map((item) => clip(item, 300)),
      constraints: (Array.isArray(project.constraints) ? project.constraints : []).slice(0, 20).map((item) => clip(item, 500)),
    },
    sections: (Array.isArray(project.sections) ? project.sections : []).slice(0, 20).map((section) => ({
      id: clip(section.id, 120), name: clip(section.name, 300), kind: clip(section.kind, 60), role: clip(section.role, 60),
      status: clip(section.status, 60), reusable: Boolean(section.reusable), useCount: Number(section.useCount || 0),
      taskIds: (Array.isArray(section.taskIds) ? section.taskIds : []).slice(0, 30).map((item) => clip(item, 120)),
    })),
    tasks: (Array.isArray(project.tasks) ? project.tasks : []).filter((task) => task.status !== "accepted").slice(0, Math.max(0, Math.min(100, Number(maxTasks) || 20))).map((task) => ({
      id: clip(task.id, 120),
      title: clip(task.title, 600),
      workstream: clip(task.workstream, 180),
      section: clip(sectionById.get(task.sectionId)?.name, 240) || null,
      agent: clip(task.agent, 60),
      status: clip(task.status, 60),
      criteria: (Array.isArray(task.criteria) ? task.criteria : []).slice(0, 12).map((item) => clip(item, 600)),
      dependsOn: (Array.isArray(task.dependsOn) ? task.dependsOn : []).slice(0, 20).map((item) => clip(item, 120)),
      baseRevision: Number(task.baseRevision || 0),
      run: task.run ? {
        id: clip(task.run.id, 120), status: clip(task.run.status, 60), phase: clip(task.run.phase, 80),
        progress: Math.max(0, Math.min(100, Number(task.run.progress) || 0)), externalThreadId: clip(task.run.externalThreadId, 160) || undefined,
      } : undefined,
      candidate: task.candidate ? { summary: clip(task.candidate.summary, 1000), nextStep: clip(task.candidate.nextStep, 1000) } : undefined,
    })),
    checkpoints: (Array.isArray(project.checkpoints) ? project.checkpoints : []).slice(0, Math.max(0, Math.min(100, Number(maxCheckpoints) || 8))).map((checkpoint) => ({
      revision: Number(checkpoint.revision || 0), summary: clip(checkpoint.summary, 1200), nextStep: clip(checkpoint.nextStep, 1000),
      acceptedAt: clip(checkpoint.acceptedAt, 80), evidence: (Array.isArray(checkpoint.evidence) ? checkpoint.evidence : []).slice(0, 8).map((item) => ({ type: clip(item?.type, 80), value: clip(item?.value, 1200) })),
    })),
    decisions: (Array.isArray(project.decisions) ? project.decisions : []).slice(0, 20).map((item) => typeof item === "string" ? clip(item, 1200) : { id: clip(item?.id, 120), title: clip(item?.title || item?.summary || item?.detail, 1200), status: clip(item?.status, 80), rationale: clip(item?.rationale, 1600), source: clip(item?.source, 120), createdAt: clip(item?.createdAt, 80) }),
    blockers: (Array.isArray(project.blockers) ? project.blockers : []).slice(0, 20).map((item) => clip(item, 1000)),
    events: (Array.isArray(project.events) ? project.events : []).slice(0, Math.max(0, Math.min(100, Number(maxEvents) || 20))).map((item) => ({ id: clip(item?.id, 120), type: clip(item?.type, 120), at: clip(item?.at, 80), detail: clip(item?.detail, 1000) })),
    git: boundedGit(project.gitSnapshot),
    github: boundedGithub(project.githubSnapshot),
  };
}

function validateBaseRevision(project, input = {}) {
  if (input.baseRevision === undefined || input.baseRevision === null || input.baseRevision === "") return;
  const base = Number(input.baseRevision);
  if (!Number.isInteger(base) || base !== Number(project.revision)) {
    throw new Error(`STALE_RESULT: request based on R${input.baseRevision}, current HEAD is R${project.revision}`);
  }
}

function applyHarnessResult(state, projectId, taskId, input = {}) {
  const project = machine.getProject(state, projectId);
  const currentTask = project.tasks.find((item) => item.id === taskId);
  if (!currentTask) throw new Error("Task not found");
  validateBaseRevision(project, input);
  if (input.runId && currentTask.run?.id && String(input.runId) !== String(currentTask.run.id)) throw new Error("RUN_MISMATCH: task run does not match result");
  if (currentTask.status === "review" && currentTask.candidate?.summary === String(input.summary || "").trim()) return currentTask;
  if (currentTask.status === "accepted" && currentTask.run?.id === input.runId) return currentTask;
  const source = input.source === "agent-auto" ? "agent-auto" : "manual";
  const result = machine.submitTaskResult(state, projectId, taskId, { ...input, source });
  project.events.unshift({ id: randomUUID(), type: "protocol.result.accepted", at: new Date().toISOString(), detail: `${currentTask.id} · ${source}` });
  project.updatedAt = new Date().toISOString();
  return result;
}

function applyHarnessEvent(state, projectId, taskId, input = {}) {
  const project = machine.getProject(state, projectId);
  const currentTask = project.tasks.find((item) => item.id === taskId);
  if (!currentTask) throw new Error("Task not found");
  if (input.baseRevision !== undefined) validateBaseRevision(project, input);
  if (input.runId && currentTask.run?.id && String(input.runId) !== String(currentTask.run.id)) throw new Error("RUN_MISMATCH: task run does not match event");
  return machine.recordAgentEvent(state, projectId, taskId, input);
}

function applyDecisionProposal(state, projectId, input = {}) {
  const project = machine.getProject(state, projectId);
  const title = String(input.title || input.summary || input.detail || "").trim();
  if (!title) throw new Error("Decision title is required");
  const decision = {
    id: String(input.id || randomUUID()),
    title: title.slice(0, 1200),
    status: String(input.status || "proposed"),
    rationale: String(input.rationale || "").slice(0, 2000),
    source: String(input.source || "agent"),
    createdAt: new Date().toISOString(),
  };
  project.decisions ||= [];
  project.decisions.unshift(decision);
  project.events.unshift({ id: randomUUID(), type: "decision.proposed", at: decision.createdAt, detail: decision.title });
  project.updatedAt = decision.createdAt;
  return decision;
}

// Project imports use a separate module to keep the result protocol small,
// while these lazy wrappers preserve one discoverable protocol entry point.
function parseHarnessImport(...args) { return require("./codex-import.cjs").parseHarnessImport(...args); }
function applyHarnessImport(...args) { return require("./codex-import.cjs").applyHarnessImport(...args); }

module.exports = { parseJsonBlocks, buildProjectContext, validateBaseRevision, applyHarnessResult, applyHarnessEvent, applyDecisionProposal, parseHarnessImport, applyHarnessImport };
