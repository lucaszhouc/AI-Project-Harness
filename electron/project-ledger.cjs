const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const LEDGER_VERSION = 1;
const MAX_CHARS = 24000;

function clip(value, max = 600) {
  const text = String(value ?? "").replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function list(value, max = 12) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, max) : [];
}

function statusLabel(status) {
  return ({
    active: "进行中", paused: "已暂停", blocked: "已阻塞", completed: "已完成", archived: "已归档",
    backlog: "待整理", ready: "可开始", in_progress: "执行中", awaiting_result: "待回写",
    review: "审核中", changes_requested: "需修改", accepted: "已接受", failed: "失败",
    idle: "空闲", running: "运行中", awaiting_approval: "待审核", closed: "已关闭",
  })[String(status)] || String(status || "未知");
}

function buildProjectLedger(project, { git, github, generatedAt = new Date().toISOString() } = {}) {
  const checkpoints = list(project.checkpoints, 12);
  const tasks = list(project.tasks, 40);
  const sections = list(project.sections, 20);
  const decisions = list(project.decisions, 16);
  const blockers = list(project.blockers, 12);
  const events = list(project.events, 20);
  const lines = [
    `# ${clip(project.name, 200)} · 动态项目白皮书`,
    "",
    `> 由 AI Project Harness 自动生成。版本：v${LEDGER_VERSION}；最后更新：${generatedAt}`,
    "> 这是项目状态层的可读投影，不替代 Git，也不依赖任何单一 Agent 对话。",
    "",
    "## 项目身份",
    `- Harness 项目 ID：${project.id}`,
    `- 项目目录：${project.path}`,
    `- 项目状态：${statusLabel(project.status)}`,
    `- Project HEAD：R${Number(project.revision || 0)}`,
    `- 目标：${clip(project.goal, 1200)}`,
    `- 当前 Objective：${clip(project.objective?.title, 800)} · ${statusLabel(project.objective?.status)}`,
    project.codexProjectId
      ? `- Codex Project：${clip(project.codexProjectId, 160)} · ${clip(project.codexProjectSync?.state || "未完成侧栏核对", 120)}`
      : "- Codex Project：尚未建立官方项目。",
    `- 来源：${clip(project.source?.label, 800)}`,
    "",
    "## Objective 历史",
    ...(project.objectives?.length ? project.objectives.slice(0, 12).map((objective) => `- ${clip(objective.title, 700)} · ${statusLabel(objective.status)}${objective.endedAt ? ` · ${objective.endedAt}` : ""}`) : ["- 当前只有一个未归档 Objective。"]),
    "",
    "## 技术栈与约束",
    ...(project.techStack?.length ? project.techStack.map((item) => `- 技术栈：${clip(item, 300)}`) : ["- 尚未登记技术栈。"]),
    ...(project.constraints?.length ? project.constraints.map((item) => `- 约束：${clip(item, 300)}`) : ["- 尚未登记额外约束。"]),
    "",
    "## 当前进展",
    ...(checkpoints.length ? checkpoints.map((item) => [
      `- R${item.revision} · ${item.acceptedAt || "未知时间"}：${clip(item.summary, 1000)}`,
      item.nextStep ? `  下一步：${clip(item.nextStep, 800)}` : "",
      item.evidence?.length ? `  证据：${item.evidence.slice(0, 5).map((e) => `${clip(e.type, 80)}=${clip(e.value, 360)}`).join("；")}` : "",
      item.source?.threadId ? `  来源 thread：${clip(item.source.threadId, 120)}` : "",
    ].filter(Boolean).join("\n")) : ["- 还没有已接受 checkpoint。"]),
    "",
    "## 任务与 Section",
    ...(tasks.length ? tasks.map((task) => {
      const section = sections.find((item) => item.id === task.sectionId);
      return `- ${clip(task.title, 500)} · ${statusLabel(task.status)} · ${clip(task.agent, 60)} · ${clip(section?.name || task.workstream, 160)}${task.run?.archiveManifestId ? ` · archive ${clip(task.run.archiveManifestId, 80)}` : ""}`;
    }) : ["- 当前没有任务。"]),
    ...(sections.length ? sections.map((section) => `- Section「${clip(section.name, 180)}」· ${section.kind || "reusable"} · ${statusLabel(section.status)} · 已使用 ${Number(section.useCount || 0)} 次`) : []),
    "",
    "## 决策、阻塞与下一步",
    ...(decisions.length ? decisions.map((item) => `- 决策：${clip(typeof item === "string" ? item : item.title || item.summary || item.detail, 700)}`) : ["- 暂无结构化决策。"]),
    ...(blockers.length ? blockers.map((item) => `- 阻塞：${clip(item, 700)}`) : ["- 当前没有登记阻塞。"]),
    "",
    "## Git 事实",
    git?.available
      ? `- 分支：${clip(git.branch, 160)}；工作区：${git.dirty ? `有 ${git.changeCount || 0} 项变更` : "干净"}；领先/落后：${git.ahead || 0}/${git.behind || 0}`
      : `- Git：不可用${git?.error ? `（${clip(git.error, 300)}）` : ""}`,
    ...(git?.commits?.length ? git.commits.slice(0, 8).map((commit) => `- 提交 ${clip(commit.shortHash, 20)}：${clip(commit.subject, 700)} · ${clip(commit.date, 80)}`) : []),
    "",
    "## GitHub / 远端（只读）",
    github?.remote ? `- 远端：${github.remote.nameWithOwner} · ${github.remote.url}` : "- 尚未识别 GitHub 远端。",
    github?.repository ? `- 仓库：${clip(github.repository.description || github.repository.nameWithOwner, 700)}` : "- 未取得 GitHub 仓库摘要（可在本机配置 gh 后刷新）。",
    github?.pullRequests?.length ? `- 最近 PR：${github.pullRequests.slice(0, 5).map((item) => `#${item.number} ${clip(item.title, 180)} · ${item.state}`).join("；")}` : "- 最近 PR：无可用数据。",
    github?.issues?.length ? `- 最近 Issue：${github.issues.slice(0, 5).map((item) => `#${item.number} ${clip(item.title, 180)} · ${item.state}`).join("；")}` : "- 最近 Issue：无可用数据。",
    "",
    "## 最近事件（来源索引）",
    ...(events.length ? events.map((event) => `- ${event.at || "未知时间"} · ${clip(event.type, 100)} · ${clip(event.detail, 700)}`) : ["- 暂无事件。"]),
    "",
    "## 归档与来源",
    `- CTO 上下文：${project.contextPackets?.cto?.path || "未生成"}`,
    `- Review 上下文：${project.contextPackets?.review?.path || "未生成"}`,
    `- 原始会话归档：由 Harness 数据盘 archive/manifest 管理。`,
    ...(project.archiveManifests?.length ? project.archiveManifests.slice(0, 8).map((item) => `- 归档 ${clip(item.id, 80)}：${item.bytes || 0} bytes · sha256 ${clip(item.sha256, 20)}${item.deduplicated ? " · 复用对象" : ""}`) : []),
    `- Git 策略：${project.gitPolicy?.commitOnAccept ? "接受时可提交（需显式动作）" : "仅记录证据，不自动提交"}`,
  ];
  const text = lines.join("\n");
  if (text.length <= MAX_CHARS) return text;
  const suffix = "\n\n[动态白皮书已按长度上限裁剪；完整状态仍保存在 Harness JSON/JSONL 数据盘。]";
  return `${text.slice(0, MAX_CHARS - suffix.length)}${suffix}`;
}

function atomicWrite(filePath, content, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fileSystem.writeFileSync(temporary, `${content}\n`, "utf8");
  fileSystem.renameSync(temporary, filePath);
}

function persistProjectLedger(state, dataRoot, { gitByProject = {}, githubByProject = {}, fileSystem = fs } = {}) {
  if (!state?.projects || !dataRoot) return false;
  let changed = false;
  for (const project of state.projects) {
    const ledgerPath = path.join(dataRoot, "projects", project.id, "PROJECT-LEDGER.md");
    const manifestPath = path.join(dataRoot, "projects", project.id, "project-manifest.json");
    const generatedAt = project.ledger?.hash && project.ledger.revision === project.revision
      ? project.ledger.generatedAt
      : (project.updatedAt || new Date().toISOString());
    const content = buildProjectLedger(project, { git: gitByProject[project.id] || project.gitSnapshot, github: githubByProject[project.id] || project.githubSnapshot, generatedAt });
    const hash = createHash("sha256").update(content).digest("hex");
    const metadata = { path: ledgerPath, hash, chars: content.length, revision: project.revision, generatedAt };
    if (project.ledger?.hash !== hash || !fileSystem.existsSync(ledgerPath)) {
      atomicWrite(ledgerPath, content, fileSystem);
      changed = true;
    }
    const manifest = {
      version: LEDGER_VERSION,
      projectId: project.id,
      name: project.name,
      path: project.path,
      status: project.status,
      revision: project.revision,
      ledgerPath,
      ledgerHash: hash,
      updatedAt: project.updatedAt,
    };
    let manifestMatches = false;
    try { manifestMatches = fileSystem.existsSync(manifestPath) && fileSystem.readFileSync(manifestPath, "utf8") === `${JSON.stringify(manifest, null, 2)}\n`; } catch {}
    if (!manifestMatches) {
      atomicWrite(manifestPath, JSON.stringify(manifest, null, 2), fileSystem);
      changed = true;
    }
    metadata.manifestPath = manifestPath;
    if (JSON.stringify(project.ledger || null) !== JSON.stringify(metadata)) {
      project.ledger = metadata;
      changed = true;
    }
  }
  return changed;
}

module.exports = { LEDGER_VERSION, MAX_CHARS, buildProjectLedger, persistProjectLedger, atomicWrite };
