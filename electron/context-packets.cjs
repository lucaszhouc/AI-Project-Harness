const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const CTO_PACKET_VERSION = 1;
const REVIEW_PACKET_VERSION = 1;
const CTO_MAX_CHARS = 12000;
const REVIEW_MAX_CHARS = 8000;

function clip(value, max = 800) {
  const text = String(value ?? "").replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function statusLabel(status) {
  return ({
    backlog: "待整理",
    ready: "可开始",
    in_progress: "进行中",
    awaiting_result: "已结束，待回写",
    review: "审核中",
    changes_requested: "需修改",
    accepted: "已完成",
    failed: "执行失败",
    idle: "空闲",
    running: "运行中",
    awaiting_approval: "待审核",
    closed: "已关闭",
    archived: "已归档",
  })[status] || String(status || "未知");
}

function checkpointLines(project, max = 4) {
  return (project.checkpoints || []).slice(0, max).map((checkpoint) => [
    `- R${checkpoint.revision}: ${clip(checkpoint.summary, 600)}`,
    checkpoint.nextStep ? `  下一步：${clip(checkpoint.nextStep, 500)}` : "",
    checkpoint.evidence?.length ? `  证据：${checkpoint.evidence.slice(0, 3).map((item) => `${clip(item.type, 60)}=${clip(item.value, 280)}`).join("；")}` : "",
  ].filter(Boolean).join("\n"));
}

function activeTaskLines(project, max = 8) {
  return (project.tasks || [])
    .filter((task) => task.status !== "accepted")
    .slice(0, max)
    .map((task) => {
      const run = task.run;
      const details = [
        `- ${clip(task.title, 360)} · ${statusLabel(task.status)} · ${clip(task.workstream, 100)}`,
        `  Section：${clip((project.sections || []).find((section) => section.id === task.sectionId)?.name || "自动", 160)} · 审核：${task.reviewMode === "auto" ? "自动" : "用户确认"}`,
        task.criteria?.length ? `  验收：${task.criteria.slice(0, 3).map((item) => clip(item, 220)).join("；")}` : "",
        run?.error ? `  阻塞：${clip(run.error, 400)}` : "",
        task.candidate?.nextStep ? `  候选下一步：${clip(task.candidate.nextStep, 400)}` : "",
      ];
      return details.filter(Boolean).join("\n");
    });
}

function decisionLines(project, max = 6) {
  return (project.decisions || []).slice(0, max).map((decision) => {
    if (typeof decision === "string") return `- ${clip(decision, 500)}`;
    return `- ${clip(decision.title || decision.summary || decision.detail || "未命名决策", 420)}${decision.status ? ` · ${clip(decision.status, 80)}` : ""}`;
  });
}

function referencesFor(project) {
  const references = [
    `项目目录：${project.path}`,
    "Harness 状态与 JSONL 回放：见当前数据盘的 storage.statePath / storage.journalPath",
  ];
  if (project.ledger?.path) references.push(`动态项目白皮书：${project.ledger.path}`);
  if (project.ledger?.manifestPath) references.push(`项目状态 manifest：${project.ledger.manifestPath}`);
  if (project.archiveManifests?.length) references.push(`会话归档：${project.archiveManifests.length} 个 manifest，位于 Harness archive/目录`);
  for (const name of ["README.md", "WHITEPAPER.md", "package.json", "AGENTS.md"]) {
    try {
      if (project.path && fs.existsSync(path.join(project.path, name))) references.push(`项目文档：${path.join(project.path, name)}`);
    } catch {
      // A missing or inaccessible project document must not block packet creation.
    }
  }
  return references;
}

function buildCtoContextPacket(project) {
  const control = project.controlSessions || {};
  const accepted = checkpointLines(project);
  const active = activeTaskLines(project);
  const decisions = decisionLines(project);
  const lines = [
    `# AI Project Harness · CTO Context v${CTO_PACKET_VERSION}`,
    "",
    "## 身份与来源",
    "- 这是项目 CTO 主 Session 的精简上下文文件。项目由 AI Project Harness 接入、扫描并持续回写。",
    "- 该文件只提供项目索引和当前状态，不包含完整对话历史；完整证据仍在项目目录、Git 和 Harness 数据盘。",
    `- SESSION_ROLE: CTO · 项目核心；CONTROL_SESSION_ID: ${control.ctoId || "未绑定"}`,
    "",
    "## 项目身份",
    `- PROJECT_ID: ${project.id}`,
    `- PROJECT_NAME: ${clip(project.name, 200)}`,
    `- PROJECT_PATH: ${project.path}`,
    `- SOURCE: ${project.source?.label || "AI Project Harness 本地项目接入"}`,
    `- PROJECT_HEAD: R${project.revision}`,
    `- STATE_UPDATED_AT: ${project.updatedAt || "未知"}`,
    project.codexProjectId
      ? `- CODEX_PROJECT: ${clip(project.codexProjectId, 160)} · ${clip(project.codexProjectSync?.state || "侧栏待核对", 120)}`
      : "- CODEX_PROJECT: 尚未建立官方 Project",
    `- GOAL: ${clip(project.goal, 800)}`,
    `- OBJECTIVE: ${clip(project.objective?.title, 800)} · ${statusLabel(project.objective?.status)}`,
    ...(project.objectives?.length ? [`- OBJECTIVE_HISTORY: ${project.objectives.slice(0, 6).map((item) => `${clip(item.title, 140)}=${statusLabel(item.status)}`).join("；")}`] : []),
    `- TECH_STACK: ${project.techStack?.length ? project.techStack.slice(0, 12).map((item) => clip(item, 120)).join("、") : "未登记"}`,
    `- CONSTRAINTS: ${project.constraints?.length ? project.constraints.slice(0, 8).map((item) => clip(item, 160)).join("；") : "未登记"}`,
    `- ENVIRONMENT: ${project.profile?.stack?.length ? project.profile.stack.slice(0, 12).join("、") : "未检测"}${project.profile?.packageManager ? ` · ${project.profile.packageManager}` : ""}`,
    `- SESSION_POLICY: 温会话最多承载 ${Math.max(...(project.sessions || []).map((item) => Number(item.maxAcceptedTasks || 5)), 5)} 个已接受任务；游标落后过多时重建上下文。`,
    "",
    "## 当前进展",
    ...(accepted.length ? accepted : ["- 还没有已接受 checkpoint。"]),
    "",
    "## 活动工作",
    ...(active.length ? active : ["- 当前没有未完成任务；请先和用户确认下一项目标。"]),
    "",
    "## Section 调配",
    ...((project.sections || []).slice(0, 12).map((section) => `- ${clip(section.name, 180)} · ${clip(section.kind, 40)} · ${statusLabel(section.status)} · ${section.taskIds?.length || 0} 项任务`)),
    "",
    "## 决策与阻塞",
    ...(decisions.length ? decisions : ["- 暂无结构化决策记录。"]),
    ...(project.blockers?.length ? project.blockers.slice(0, 6).map((item) => `- 阻塞：${clip(item, 500)}`) : []),
    "",
    "## CTO 职责",
    "- 这是用户主动进入的长期项目入口：回答项目问题、澄清目标、规划未来工作、拆分可验收任务并决定优先级。",
    "- 不要把本文件当成自动发送指令；用户可以先继续对话，确认后再发送本文件引用。",
    "- 任务执行交给独立任务 Session；Review Session 在后台审核和推进 Project HEAD。",
    "",
    "## 必要索引",
    ...referencesFor(project).map((item) => `- ${item}`),
  ];
  return boundPacket(lines.join("\n"), CTO_MAX_CHARS);
}

function buildReviewContextPacket(project) {
  const control = project.controlSessions || {};
  const candidates = (project.tasks || []).filter((task) => task.status === "review" && task.candidate).slice(0, 8);
  const lines = [
    `# AI Project Harness · Review Context v${REVIEW_PACKET_VERSION}`,
    "",
    "## 审核 Session",
    "- SESSION_ROLE: Review Agent · 项目审核",
    `- CONTROL_SESSION_ID: ${control.reviewId || "未绑定"}`,
    "- 该 Session 由 Harness 后台维护，不是用户交互入口。它核对候选并提出结论；普通任务仍需用户 Accept 才推进 Project HEAD，只有显式 auto Section 才自动推进。",
    "- 上下文超过预算时由 Harness 重建本精简文件；不要依赖不断增长的对话历史。",
    "",
    "## 项目",
    `- PROJECT_ID: ${project.id}`,
    `- PROJECT_NAME: ${clip(project.name, 200)}`,
    `- PROJECT_PATH: ${project.path}`,
    `- PROJECT_HEAD: R${project.revision}`,
    `- GOAL: ${clip(project.goal, 800)}`,
    "",
    "## 待审核候选",
    ...(candidates.length ? candidates.flatMap((task) => [
      `- ${clip(task.title, 320)} · 基于 R${task.run?.baseRevision ?? task.baseRevision} · ${task.review?.status || "queued"}`,
      `  摘要：${clip(task.candidate.summary, 600)}`,
      task.candidate.acceptance?.length ? `  验收：${task.candidate.acceptance.slice(0, 6).map((item) => `${clip(item.criterion, 180)}=${clip(item.status, 40)}`).join("；")}` : "",
      task.candidate.evidence?.length ? `  证据：${task.candidate.evidence.slice(0, 4).map((item) => `${clip(item.type, 60)}=${clip(item.value, 260)}`).join("；")}` : "",
    ].filter(Boolean)) : ["- 当前没有待审核候选。"]),
    "",
    "## 最近已接受进展",
    ...(checkpointLines(project, 3).length ? checkpointLines(project, 3) : ["- 暂无 checkpoint。"]),
    "",
    "## Section 状态",
    ...((project.sections || []).slice(0, 12).map((section) => `- ${clip(section.name, 180)} · ${clip(section.kind, 40)} · ${statusLabel(section.status)}`)),
  ];
  return boundPacket(lines.join("\n"), REVIEW_MAX_CHARS);
}

function boundPacket(packet, maxChars) {
  if (packet.length <= maxChars) return packet;
  const suffix = "\n\n[内容已按上下文预算裁剪；完整证据请读取项目目录与 Harness 状态文件。]";
  return `${packet.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function atomicWrite(filePath, content, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fileSystem.writeFileSync(temporary, `${content}\n`, "utf8");
  fileSystem.renameSync(temporary, filePath);
}

function packetMeta(filePath, content, previous) {
  const hash = createHash("sha256").update(content).digest("hex");
  return {
    path: filePath,
    hash,
    chars: content.length,
    revision: previous?.revision,
    generatedAt: previous?.hash === hash ? previous.generatedAt : new Date().toISOString(),
  };
}

function persistContextPackets(state, dataRoot, fileSystem = fs) {
  if (!dataRoot || !state || !Array.isArray(state.projects)) return false;
  let changed = false;
  for (const project of state.projects) {
    const contextDir = path.join(dataRoot, "projects", project.id, "context");
    const ctoPath = path.join(contextDir, "cto-context.md");
    const reviewPath = path.join(contextDir, "review-context.md");
    const ctoPacket = buildCtoContextPacket(project);
    const reviewPacket = buildReviewContextPacket(project);
    const ctoPrevious = project.contextPackets?.cto;
    const reviewPrevious = project.contextPackets?.review;
    const ctoMeta = packetMeta(ctoPath, ctoPacket, ctoPrevious);
    const reviewMeta = packetMeta(reviewPath, reviewPacket, reviewPrevious);
    if (ctoPrevious?.hash !== ctoMeta.hash || !fileSystem.existsSync(ctoPath)) atomicWrite(ctoPath, ctoPacket, fileSystem);
    if (reviewPrevious?.hash !== reviewMeta.hash || !fileSystem.existsSync(reviewPath)) atomicWrite(reviewPath, reviewPacket, fileSystem);
    ctoMeta.revision = project.revision;
    reviewMeta.revision = project.revision;
    if (JSON.stringify(project.contextPackets?.cto || null) !== JSON.stringify(ctoMeta)
      || JSON.stringify(project.contextPackets?.review || null) !== JSON.stringify(reviewMeta)) {
      project.contextPackets = { cto: ctoMeta, review: reviewMeta };
      changed = true;
    }
  }
  return changed;
}

module.exports = {
  CTO_MAX_CHARS,
  REVIEW_MAX_CHARS,
  buildCtoContextPacket,
  buildReviewContextPacket,
  persistContextPackets,
  boundPacket,
};
