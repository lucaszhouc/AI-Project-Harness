import type { GitHubState, GitState, Project, Section, Snapshot, Task } from "./types";
import { renderGuide } from "./guide-view.mjs";
import { localizeAppHtml } from "./app-copy.mjs";

const statusCopy: Record<string, string> = {
  backlog: "待整理",
  ready: "可开始",
  in_progress: "进行中",
  awaiting_result: "已结束，待回写",
  awaiting_user: "等待用户在 Agent 中执行",
  review: "待确认",
  changes_requested: "需修改",
  accepted: "已完成",
  failed: "执行失败",
  user_action_required: "等待用户操作",
  stopped: "已停止",
};
const projectStatusCopy: Record<string, string> = { active: "进行中", paused: "已暂停", blocked: "已阻塞", completed: "已完成", archived: "已归档" };
const objectiveStatusCopy: Record<string, string> = { active: "进行中", paused: "已暂停", completed: "已完成", superseded: "已替代", blocked: "已阻塞" };
const priorityCopy: Record<string, string> = { low: "低", normal: "普通", high: "高", urgent: "紧急" };
const phaseCopy: Record<string, string> = {
  queued: "排队中",
  agent_starting: "启动 Agent",
  thinking: "分析中",
  working: "执行中",
  executing_command: "执行命令",
  updating_files: "更新文件",
  reporting: "整理结果",
  completed: "已结束",
  awaiting_review: "等待审核",
  failed: "执行失败",
};

function agentLabel(agent?: string): string {
  return agent === "claude" ? "Claude Code" : agent === "hermes" ? "Hermes" : "Codex";
}

function codexProjectCopy(project: Project): { title: string; detail: string } {
  const official = Boolean(project.codexProjectId && !String(project.codexProjectId).startsWith("local-"));
  if (!official) return { title: "等待同步", detail: "还没有可核对的官方 Codex Project。" };
  const state = project.codexProjectSync?.state;
  if (state === "desktop-restart-required") {
    return {
      title: "官方 Project 已创建 · 待冷启动核对",
      detail: project.codexProjectSync?.detail || "请完全退出 Codex Desktop 后重新打开，再核对侧栏。",
    };
  }
  if (state === "app-server-confirmed") {
    return {
      title: "官方 Project 已确认 · 侧栏待核对",
      detail: "app-server 已返回该 Project；当前 Desktop 侧栏仍需一次完全退出后的冷启动核对。",
    };
  }
  if (state === "desktop-registered") {
    return {
      title: "官方 Project 已创建 · Desktop 已注册",
      detail: "Codex Desktop 已接受项目深链；CTO、Review 和后续任务会归入这个 Project。",
    };
  }
  return {
    title: "已记录官方 Project · 侧栏待核对",
    detail: "已有官方 Project ID，但没有把它直接当作侧栏可见性证明。",
  };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatClock(value?: string): string {
  if (!value) return "--:--";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "--:--" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function taskAction(task: Task, project?: Project): string {
  const workerSections = (project?.sections || []).filter((section) => section.kind !== "main" && !["closed", "archived"].includes(section.status));
  // Do not move a task while an Agent owns an active run. The assignment
  // control remains available for queued, terminal, and accepted tasks so a
  // user can repair the workstream mapping without editing raw state.
  const canAssign = workerSections.length > 0 && !["in_progress", "awaiting_result", "review"].includes(task.status);
  const assign = canAssign
    ? `<button class="text-action" data-action="assign-section" data-task="${escapeHtml(task.id)}">改派 Section</button>`
    : "";
  if (["ready", "backlog", "changes_requested", "failed"].includes(task.status)) {
    const dispatchLabel = task.workstream === "codex-project-import" ? "重试 Codex 回填" : task.agent === "codex" ? "开始任务（注入 Codex）" : "开始任务";
    return `<div class="task-actions"><button class="action action--small" data-action="dispatch" data-task="${escapeHtml(task.id)}" data-guide-target="task-dispatch-${escapeHtml(task.id)}"${task.agent === "codex" ? ' aria-label="开始任务" title="开始任务后注入 Codex"' : ""}>${dispatchLabel}</button>${assign}</div>`;
  }
  const open = task.run?.externalThreadId
    ? `<button class="text-action" data-action="open-agent" data-task="${escapeHtml(task.id)}">${["starting", "running"].includes(String(task.run.status || "").toLowerCase()) ? "打开项目入口" : "打开对话"}</button>`
    : "";
  if (task.workstream === "codex-project-import" && ["in_progress", "awaiting_result"].includes(task.status)) {
    return `<div class="task-actions">${open}<button class="text-action" data-action="stop-task" data-task="${escapeHtml(task.id)}">停止回填</button></div>`;
  }
  const projectOpen = task.agent === "codex"
    ? `<button class="text-action" data-action="open-codex-project">打开最近对话</button>`
    : "";
  if (!open && projectOpen) {
    return `<div class="task-actions">${projectOpen}${assign}<span class="task-hint">旧任务未保存独立 thread，将按项目最近对话打开</span></div>`;
  }
  if (task.run?.userActionRequired && task.status !== "accepted") {
    return `<div class="task-actions"><button class="text-action" data-action="open-workspace" data-task="${escapeHtml(task.id)}">打开工作区</button><button class="text-action" data-action="copy-packet" data-task="${escapeHtml(task.id)}">复制任务包</button><button class="action action--small" data-action="submit-result" data-task="${escapeHtml(task.id)}">提交结果</button><button class="text-action" data-action="stop-task" data-task="${escapeHtml(task.id)}">停止</button></div>`;
  }
  if (task.status === "in_progress" || task.status === "awaiting_result") {
    return `<div class="task-actions">${open}<button class="text-action" data-action="copy-packet" data-task="${escapeHtml(task.id)}">复制任务包</button><button class="action action--small" data-action="submit-result" data-task="${escapeHtml(task.id)}">${task.status === "awaiting_result" ? "补交结果" : "提交结果"}</button><button class="text-action" data-action="stop-task" data-task="${escapeHtml(task.id)}">停止</button></div>`;
  }
  if (task.status === "review") {
    const automated = task.review?.status === "approved" || task.run?.resultSource === "agent-auto";
    return `<div class="task-actions">${open}<span class="task-hint">${automated ? "Review Agent 自动审核中" : "等待你的确认"}</span></div>`;
  }
  return `<div class="task-actions">${open}${assign}<span class="task-hint task-hint--done">已写入项目进展</span></div>`;
}

function renderRuntime(task: Task): string {
  const run = task.run;
  if (!run || (task.status === "review" && !run.status)) return "";
  const phase = run.phase || (run.status === "failed" ? "failed" : "queued");
  const progress = Math.max(0, Math.min(100, Number(run.progress) || 0));
  const event = run.lastEvent ? ` · ${run.lastEvent}` : "";
  const process = run.processId ? `PID ${run.processId}` : "进程已记录";
  const thread = run.externalThreadId ? ` · thread ${run.externalThreadId}` : "";
  return `<div class="task-runtime" aria-label="Agent 运行态"><div class="task-runtime__line"><span>${escapeHtml(phaseCopy[phase] || phase)}</span><b>${progress}%</b></div><div class="task-runtime__bar"><i style="width:${progress}%"></i></div><small>${escapeHtml(process)} · ${run.eventCount || 0} 个事件${escapeHtml(thread)}${escapeHtml(event)}${run.transcriptPath ? ` · <button class="text-action" data-action="open-run-archive" data-task="${escapeHtml(task.id)}">打开运行归档</button>` : ""}</small></div>`;
}

function renderTask(task: Task, project?: Project): string {
  const criteriaItems = Array.isArray(task.criteria) ? task.criteria : [];
  const criteria = criteriaItems.length
    ? criteriaItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>尚未填写验收条件</li>";
  const policy = task.sessionPolicy === "disposable" ? "一次性会话" : task.sessionPolicy === "warm" ? "温会话" : "自动会话";
  const section = project?.sections?.find((item) => item.id === task.sectionId);
  const dependencyIds = Array.isArray(task.dependsOn) ? task.dependsOn : String(task.dependsOn || "").split(/[\s,]+/).filter(Boolean);
  const unmet = dependencyIds.map((id) => project?.tasks?.find((item) => item.id === id)).filter((item) => item && item.status !== "accepted");
  const failure = task.status === "failed" ? String(task.run?.error || task.launchError || "").trim() : "";
  return `<article class="task-row task-row--${escapeHtml(task.status)}">
    <div class="task-copy">
      <div class="task-title-line"><h3>${escapeHtml(task.title)}</h3><span class="priority priority--${escapeHtml(task.priority || "normal")}">${priorityCopy[task.priority || "normal"]}</span><span class="status status--${escapeHtml(task.status)}">${statusCopy[task.status] || escapeHtml(task.status)}</span></div>
      <div class="task-meta"><span>${escapeHtml(agentLabel(task.agent))}</span><span>${escapeHtml(task.workstream)}</span><span>${escapeHtml(section?.name || "自动 Section")}</span><span>${policy}</span>${dependencyIds.length ? `<span>依赖 ${dependencyIds.length}</span>` : ""}</div>
      ${renderRuntime(task)}
      ${failure ? `<div class="task-failure" role="status">${escapeHtml(failure)}</div>` : ""}
      ${unmet.length ? `<div class="task-dependency">等待前置：${escapeHtml(unmet.map((item) => item?.title).join("、"))}</div>` : ""}
      <details data-preserve-key="task-criteria-${escapeHtml(task.id)}"><summary data-preserve-focus-key="task-criteria-${escapeHtml(task.id)}">验收条件 · ${criteriaItems.length || 1}</summary><ol>${criteria}</ol></details>
    </div>
    <div class="task-state">${taskAction(task, project)}</div>
  </article>`;
}

function renderImportPreview(payload?: Record<string, unknown>): string {
  if (!payload) return "";
  const project = payload.project && typeof payload.project === "object" ? payload.project as Record<string, unknown> : {};
  const tasks = Array.isArray(payload.tasks) ? payload.tasks.filter((item) => item && typeof item === "object").slice(0, 8) as Array<Record<string, unknown>> : [];
  const checkpoints = Array.isArray(payload.checkpoints) ? payload.checkpoints.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  const blockers = Array.isArray(project.blockers) ? project.blockers.slice(0, 6) : [];
  const git = payload.git && typeof payload.git === "object" ? payload.git as Record<string, unknown> : {};
  const commits = Array.isArray(git.commits) ? git.commits.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  const latest = checkpoints[0];
  return `<div class="review-import-preview"><span class="eyebrow">即将写入的项目快照</span><div class="review-import-preview__facts"><p><b>目标</b>${escapeHtml(project.objective || project.goal || "未提供")}</p><p><b>最新进展</b>${escapeHtml(latest?.summary || "未提供 checkpoint")}</p><p><b>Git</b>${escapeHtml(git.branch || "未提供分支")}${commits[0]?.hash ? ` · ${escapeHtml(String(commits[0].hash).slice(0, 12))}` : ""}</p></div>${blockers.length ? `<p><b>阻塞</b> ${escapeHtml(blockers.join("；"))}</p>` : ""}${tasks.length ? `<ul>${tasks.map((item) => `<li><span>${escapeHtml(item.status || "backlog")}</span>${escapeHtml(item.title || "未命名任务")}</li>`).join("")}</ul>` : ""}</div>`;
}

function renderReviewCard(task: Task): string {
  if (!task.candidate) return "";
  const isImport = task.workstream === "codex-project-import";
  const importPayload = isImport && task.importCandidate && typeof task.importCandidate === "object"
    ? task.importCandidate as Record<string, unknown>
    : undefined;
  const importedCounts = importPayload ? [
    ["任务", Array.isArray(importPayload.tasks) ? importPayload.tasks.length : 0],
    ["Section", Array.isArray(importPayload.sections) ? importPayload.sections.length : 0],
    ["checkpoint", Array.isArray(importPayload.checkpoints) ? importPayload.checkpoints.length : 0],
    ["会话", Array.isArray(importPayload.sessions) ? importPayload.sessions.length : 0],
  ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}`).join("、") : "";
  const acceptanceItems = Array.isArray(task.candidate.acceptance) ? task.candidate.acceptance : [];
  const evidenceItems = Array.isArray(task.candidate.evidence) ? task.candidate.evidence : [];
  const acceptance = acceptanceItems.map((item) => `<li><span class="criterion-state criterion-state--${escapeHtml(item.status)}">${item.status === "pass" ? "通过" : item.status === "fail" ? "未通过" : "待确认"}</span><span>${escapeHtml(item.criterion)}</span></li>`).join("");
  const evidence = evidenceItems.map((item) => `<li><span>${escapeHtml(item.type)}</span><code>${escapeHtml(item.value)}</code></li>`).join("");
  const automatic = task.reviewMode === "auto";
  const reviewSignal = task.review?.status === "approved"
    ? "Review Agent 已通过"
    : automatic
      ? "Review Agent 后台审核中"
      : isImport ? "Codex 回填候选 · 等待你的确认" : "等待你的确认";
  const reviewActions = automatic
    ? `<div class="review-actions"><span class="task-hint task-hint--done">审核与回写由 Review Agent 自动完成，无需用户确认。</span></div>`
    : isImport
      ? `<div class="review-actions"><button class="action action--quiet" data-action="reject" data-task="${escapeHtml(task.id)}" data-guide-target="review-reject">拒绝导入</button><button class="action action--quiet" data-action="request-changes" data-task="${escapeHtml(task.id)}">重新盘点</button><button class="action action--accept" data-action="accept" data-task="${escapeHtml(task.id)}" data-guide-target="review-accept">接受并写入 Harness</button></div>`
      : `<div class="review-actions"><button class="action action--quiet" data-action="reject" data-task="${escapeHtml(task.id)}" data-guide-target="review-reject">拒绝结果</button><button class="action action--quiet" data-action="request-changes" data-task="${escapeHtml(task.id)}">退回修改</button><button class="action action--accept" data-action="accept" data-task="${escapeHtml(task.id)}" data-guide-target="review-accept">接受并推进 HEAD</button></div>`;
  const importMeta = isImport ? `<p class="review-import-meta">${importedCounts ? `本次候选包含：${escapeHtml(importedCounts)}。` : "候选已通过结构化协议校验。"} 原始 transcript 在模型上下文外独立归档，确认后才会合并到项目。</p>` : "";
  return `<section class="review-block">
    <div class="review-kicker"><span class="review-signal">${reviewSignal}</span><span>基于 HEAD R${task.run?.baseRevision ?? task.baseRevision}</span></div>
    <h2>${escapeHtml(task.title)}</h2>
    <p class="review-summary">${escapeHtml(task.candidate.summary)}</p>
    ${importMeta}
    <details class="review-details" data-preserve-key="review-details-${escapeHtml(task.id)}"><summary data-preserve-focus-key="review-details-${escapeHtml(task.id)}">查看验收结果与证据</summary><div class="review-detail-grid">
      <div><span class="eyebrow">验收结果</span><ul class="criterion-list">${acceptance}</ul></div>
      <div><span class="eyebrow">Agent 证据</span><ul class="evidence-list">${evidence || "<li>没有附加证据</li>"}</ul></div>
      <div><span class="eyebrow">建议下一步</span><p>${escapeHtml(task.candidate.nextStep || "没有建议下一步")}</p></div>
      ${isImport ? renderImportPreview(importPayload) : ""}
    </div></details>
    ${reviewActions}
  </section>`;
}

function renderReview(project: Project): string {
  const tasks = (project.tasks || []).filter((item) => item.status === "review" && item.candidate).slice(0, 6);
  if (!tasks.length) {
    return `<section class="review-empty" aria-label="审核状态"><span class="state-dot"></span><div><strong>目前没有需要确认的结果</strong><p>普通任务结果到达后会等待人工审核；只有接受才推进 Project HEAD。</p></div></section>`;
  }
  return tasks.map(renderReviewCard).join("");
}

function renderGit(git: GitState | undefined): string {
  if (!git?.available) return `<div class="empty-signal"><strong>Git 暂不可用</strong><span>${escapeHtml(git?.error || "正在等待仓库")}</span></div>`;
  const changes = (Array.isArray(git.changes) ? git.changes : []).slice(0, 7).map((item) => `<li><code>${escapeHtml(item.code)}</code><span title="${escapeHtml(item.file)}">${escapeHtml(item.file)}</span></li>`).join("");
  const commits = (Array.isArray(git.commits) ? git.commits : []).slice(0, 3).map((item) => `<li><code>${escapeHtml(item.shortHash)}</code><span>${escapeHtml(item.subject)}</span></li>`).join("");
  return `<div class="git-head"><div><span class="eyebrow">当前分支</span><strong>${escapeHtml(git.branch)}</strong></div><span class="git-state ${git.dirty ? "git-state--dirty" : ""}">${git.dirty ? `${git.changeCount} 项变更` : "工作区干净"}</span></div>
    <div class="git-ab"><span>领先 ${git.ahead || 0}</span><span>落后 ${git.behind || 0}</span><span>${escapeHtml(git.upstream || "未设置上游")}</span></div><div class="git-ab git-ab--secondary"><span>${git.branches?.length || 0} 个分支</span><span>${git.tags?.length || 0} 个标签</span><span>检查于 ${formatClock(git.checkedAt)}</span></div>
    <span class="eyebrow">工作区变更</span><ul class="file-list">${changes || "<li><span>没有本地变更</span></li>"}</ul>
    <span class="eyebrow">最近提交</span><ul class="commit-list">${commits || "<li><span>还没有提交</span></li>"}</ul>`;
}

function renderGitHub(github: GitHubState | undefined): string {
  if (!github?.remote) {
    return `<div class="empty-signal"><strong>没有 GitHub 远端</strong><span>${escapeHtml(github?.error || "可在项目 Git 中添加 origin；本地状态不受影响")}</span><button class="text-action" data-action="connect-github">连接 GitHub 远端</button></div>`;
  }
  const auth = github.gh?.authenticated ? "gh 已认证" : github.gh?.available ? "gh 未认证" : "仅显示远端";
  const prs = (Array.isArray(github.pullRequests) ? github.pullRequests : []).slice(0, 3).map((item) => `<li><a href="${escapeHtml(String(item.url || github.remote?.url || "#"))}" target="_blank" rel="noreferrer">#${escapeHtml(item.number)} ${escapeHtml(item.title)}</a><span>${escapeHtml(item.state || "")}</span></li>`).join("");
  const issues = (Array.isArray(github.issues) ? github.issues : []).slice(0, 3).map((item) => `<li><a href="${escapeHtml(String(item.url || github.remote?.url || "#"))}" target="_blank" rel="noreferrer">#${escapeHtml(item.number)} ${escapeHtml(item.title)}</a><span>${escapeHtml(item.state || "")}</span></li>`).join("");
  return `<div class="github-head"><div><span class="eyebrow">仓库</span><a href="${escapeHtml(github.remote.url)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(github.remote.nameWithOwner)}</strong></a></div><span class="git-state">${auth}</span></div><button class="text-action" data-action="connect-github">更换远端</button>${github.detailsLoaded ? "" : "<p class=\"drawer-note\">点击右上角刷新以读取最近 PR / Issue（只读）。</p>"}
    ${github.repository?.description ? `<p class="github-description">${escapeHtml(github.repository.description)}</p>` : ""}
    <span class="eyebrow">最近 PR</span><ul class="github-list">${prs || "<li><span>暂无可用数据</span></li>"}</ul>
    <span class="eyebrow">最近 Issue</span><ul class="github-list">${issues || "<li><span>暂无可用数据</span></li>"}</ul>`;
}

function renderSections(project: Project): string {
  const sections = (project.sections || []).filter((section) => section.kind !== "main");
  if (!sections.length) return `<div class="empty-signal"><strong>还没有工作 Section</strong><span>开始任务时会按 workstream 自动建立可复用 Section。</span></div>`;
  const status: Record<string, string> = { idle: "空闲", running: "运行中", awaiting_approval: "待审核", closed: "已关闭", archived: "已归档" };
  return `<ul class="section-list">${sections.slice(0, 12).map((section: Section) => `<li class="section-row"><span class="section-kind">${section.kind === "one-shot" ? "一次性" : "复用"}</span><span><strong>${escapeHtml(section.name)}</strong><small>${escapeHtml(agentLabel(section.agent))} · ${escapeHtml(status[section.status] || section.status)} · ${section.taskIds?.length || 0} 项任务</small></span><i class="session-state">${Number(section.useCount || 0)} 次</i>${section.status === "idle" ? `<button class="text-action" data-action="close-section" data-section="${escapeHtml(section.id)}">关闭</button>` : section.status === "closed" ? `<button class="text-action" data-action="archive-section" data-section="${escapeHtml(section.id)}">归档</button>` : ""}</li>`).join("")}</ul>`;
}

function renderArchives(snapshot: Snapshot, project: Project): string {
  const manifests = (snapshot.archives?.[project.id] || project.archiveManifests || []).slice(0, 6);
  if (!manifests.length) return `<div class="empty-signal"><strong>还没有会话归档</strong><span>导入旧 Agent 会话后，这里只显示 hash、大小和来源索引。</span></div>`;
  return `<ul class="archive-list">${manifests.map((item) => `<li><div><strong>${escapeHtml(item.label || item.sourceName || item.id)}</strong><small>${escapeHtml(String(item.format || "text"))} · ${Number(item.bytes || 0).toLocaleString()} bytes · ${escapeHtml(String(item.sha256 || "").slice(0, 16))}…</small></div><div class="archive-row-actions">${item.sha256 ? `<button class="text-action" data-action="verify-archive" data-hash="${escapeHtml(item.sha256)}">校验</button>` : ""}${item.deduplicated ? `<i class="session-state">复用</i>` : ""}</div></li>`).join("")}</ul>`;
}

function codexMemberCount(project: Project): number {
  const ids = new Set<string>();
  (project.sessions || []).forEach((session) => { if (session.agent === "codex" && session.externalThreadId) ids.add(session.externalThreadId); });
  (project.tasks || []).forEach((task) => { if (task.agent === "codex" && task.run?.externalThreadId) ids.add(task.run.externalThreadId); });
  return ids.size;
}

function renderProjectList(snapshot: Snapshot): string {
  return snapshot.state.projects.map((project, index) => {
    const active = project.id === snapshot.state.selectedProjectId;
    const tasks = project.tasks || [];
    const waiting = tasks.filter((task) => task.status === "review").length;
    const running = tasks.filter((task) => ["in_progress", "awaiting_result"].includes(task.status)).length;
    return `<button class="project-item ${active ? "project-item--active" : ""} ${project.status === "archived" ? "project-item--archived" : ""}" data-action="select-project" data-project="${escapeHtml(project.id)}">
      <span class="project-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="project-item-copy"><strong>${escapeHtml(project.name)}</strong><small>HEAD R${project.revision} · ${escapeHtml(project.status === "archived" ? "已归档" : project.status === "paused" ? "已暂停" : project.status === "blocked" ? "已阻塞" : "进行中")}${snapshot.git?.[project.id]?.dirty ? " · Git 有变更" : ""}${running ? ` · ${running} 个运行中` : waiting ? ` · ${waiting} 项待确认` : ""}</small></span>
      ${waiting ? `<i aria-label="${waiting} 项待确认">${waiting}</i>` : ""}
    </button>`;
  }).join("");
}

function renderCheckpoint(project: Project): string {
  // Checkpoints are prepended by the state machine; the head is the latest accepted progress.
  const checkpoint = (project.checkpoints || [])[0];
  if (!checkpoint) return "";
  return `<section class="checkpoint"><span class="eyebrow">最近一次进展 · R${checkpoint.revision}</span><div><strong>${escapeHtml(checkpoint.summary)}</strong><span>${formatClock(checkpoint.acceptedAt)}</span></div></section>`;
}

function renderTimeline(project: Project): string {
  const checkpoints = (project.checkpoints || []).slice(0, 6);
  if (!checkpoints.length) return "";
  return `<section class="timeline"><div class="section-title"><div><span class="eyebrow">PROJECT LEDGER</span><h2>进展轨迹</h2></div><span>最近 ${checkpoints.length} 个 checkpoint</span></div><ol>${checkpoints.map((checkpoint) => `<li><span class="timeline-marker">R${checkpoint.revision}</span><div><strong>${escapeHtml(checkpoint.summary)}</strong><small>${formatClock(checkpoint.acceptedAt)}${checkpoint.nextStep ? ` · 下一步：${escapeHtml(checkpoint.nextStep)}` : ""}</small></div></li>`).join("")}</ol></section>`;
}

function renderDetailsDrawer(snapshot: Snapshot, project: Project, git: GitState | undefined, github: GitHubState | undefined, open: boolean): string {
  const sessionStatusCopy: Record<string, string> = { warm: "可复用", executing: "执行中", awaiting_review: "等待审核", awaiting_result: "待回写", retired: "已结束" };
  const projectSessions = project.sessions || [];
  const sessions = projectSessions.map((session) => {
    const role = session.role === "cto" ? "CTO" : session.role === "review" ? "Review" : session.role === "conversation" ? "讨论" : agentLabel(session.agent);
    const description = session.role === "cto"
      ? `用户主入口 · ${project.contextPackets?.cto ? "上下文待发送" : "上下文待生成"}`
      : session.role === "review"
        ? "后台自动审核 · 上下文自动限长"
        : `${session.type === "disposable" ? "一次性" : "温会话"} · 游标 R${session.cursor}`;
    const action = session.role === "cto"
      ? `<button class="text-action session-open" data-action="open-cto">进入 CTO</button>`
      : session.role === "review"
        ? `<span class="session-background">后台运行</span>`
        : session.externalThreadId
          ? `<button class="text-action session-open" data-action="open-session" data-session="${escapeHtml(session.id)}">打开</button>`
          : session.role === "conversation"
            ? `<button class="text-action session-open" data-action="open-session" data-session="${escapeHtml(session.id)}">打开工作区</button>`
            : "";
    return `<li class="session-row"><span class="session-agent">${role}</span><span><strong>${escapeHtml(session.title || session.workstream)}</strong><small>${escapeHtml(session.workstream)} · ${escapeHtml(description)}</small></span><i class="session-state session-state--${escapeHtml(session.status)}">${escapeHtml(sessionStatusCopy[session.status] || session.status)}</i>${action}</li>`;
  }).join("");
  const codexCopy = codexProjectCopy(project);
  return `<button class="drawer-scrim ${open ? "drawer-scrim--open" : ""}" data-action="close-details" aria-label="关闭项目详情" tabindex="${open ? "0" : "-1"}"></button>
    <aside class="project-drawer ${open ? "project-drawer--open" : ""}" aria-label="项目详情" aria-hidden="${open ? "false" : "true"}" ${open ? "" : "inert"}>
      <div class="drawer-head"><div><span class="eyebrow">PROJECT DETAILS</span><h2>项目详情</h2></div><button class="icon-button" data-action="close-details" aria-label="关闭项目详情">×</button></div>
      <div class="drawer-scroll">
        <section class="drawer-section project-facts"><div class="drawer-section-title"><div><span class="eyebrow">项目位置</span><strong>${escapeHtml(project.name)}</strong></div><button class="text-action" data-action="edit-contract">编辑契约</button></div><code title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</code><div><span>Project HEAD</span><b>R${project.revision}</b></div><div><span>项目状态</span><b>${escapeHtml(projectStatusCopy[project.status] || project.status || "进行中")}</b></div><div><span>当前 Objective</span><b>${escapeHtml(objectiveStatusCopy[project.objective?.status || "active"] || project.objective?.status || "进行中")}</b></div><button class="text-action drawer-path-action" data-action="open-project-path">打开项目目录</button>${project.objective?.status === "active" ? `<button class="text-action drawer-path-action" data-action="complete-objective">标记 Objective 已完成</button>` : ""}<button class="text-action drawer-path-action" data-action="new-objective">切换 Objective</button></section>
        <section class="drawer-section project-facts"><span class="eyebrow">Codex Project</span><strong>${escapeHtml(codexCopy.title)}</strong><small>${escapeHtml(codexCopy.detail)} CTO、Review 和后续任务对话会归入这个 Codex 项目。当前已记录 ${codexMemberCount(project)} 个成员对话（2+N）。${project.codexProjectId ? ` ID：${escapeHtml(project.codexProjectId)}` : ""}${project.codexImport ? ` 导入状态：${escapeHtml(project.codexImport.status === "awaiting_review" ? "待审核" : project.codexImport.status === "running" ? "Agent 盘点中" : project.codexImport.status === "completed" ? "已完成" : project.codexImport.status === "failed" ? "失败可重试" : "排队中")}${project.codexImport.sourceLatestAt ? ` · Agent 最新 checkpoint：${escapeHtml(project.codexImport.sourceLatestAt)}` : ""}` : ""}</small>${project.codexSyncError ? `<div class="onboarding-feedback onboarding-feedback--error" role="alert"><strong>上次连接未完成：${escapeHtml(project.codexSyncError.message)}</strong><small>阶段：${escapeHtml(project.codexSyncError.stage)} · ${escapeHtml(formatClock(project.codexSyncError.at))}</small></div>` : ""}<div class="drawer-inline-actions">${project.source?.kind === "blank" || project.codexProjectId ? `<button class="text-action" data-action="import-into-project">${project.codexProjectId ? "从 Codex 刷新项目" : "从 Codex 回填到此项目"}</button>` : ""}<button class="text-action" data-action="sync-codex">${project.codexSyncError ? "重试连接 Codex" : "同步 Project"}</button><button class="text-action" data-action="new-conversation">新建项目对话</button></div></section>
        <section class="drawer-section project-facts"><span class="eyebrow">持久化数据盘</span><strong>${escapeHtml(snapshot.storage?.root || "当前用户数据目录")}</strong><small>状态与 JSONL 回放日志会在每次状态变更后原子写入。</small>${snapshot.storage?.harnessCliPath ? `<code class="runtime-path" title="${escapeHtml(snapshot.storage.harnessCliPath)}">Agent CLI：${escapeHtml(snapshot.storage.harnessCliPath)}</code>` : ""}</section>
        <section class="drawer-section project-facts"><div class="drawer-section-title"><div><span class="eyebrow">开发环境画像</span><strong>${escapeHtml(project.profile?.stack?.join(" · ") || project.techStack?.join(" · ") || "尚未检测")}</strong></div><button class="icon-button icon-button--small" data-action="refresh-profile" aria-label="刷新开发环境画像">↻</button></div><small>${project.profile?.packageManager ? `包管理器：${escapeHtml(project.profile.packageManager)} · ` : ""}${project.profile?.entrypoints?.length ? `入口：${escapeHtml(project.profile.entrypoints.slice(0, 4).join("、"))}` : "接入时会自动扫描常见入口"}</small></section>
        <section class="drawer-section project-facts"><span class="eyebrow">项目健康</span><strong>${snapshot.health?.[project.id]?.status === "ok" ? "正常" : "需要关注"}</strong><small>${snapshot.health?.[project.id]?.failures?.includes("codexProject") ? "Codex Project 已写入，但 Desktop 归组证据尚未完成。" : snapshot.health?.[project.id]?.failures?.length ? `缺少：${escapeHtml(snapshot.health[project.id].failures.join("、"))}` : "状态、上下文、Ledger 和事实索引均可读取"}</small></section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">版本状态</span><h3>Git</h3></div><button class="icon-button icon-button--small" data-action="refresh-git" aria-label="刷新 Git">↻</button></div>${renderGit(git)}</section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">远端协作</span><h3>GitHub</h3></div><button class="icon-button icon-button--small" data-action="refresh-github" aria-label="刷新 GitHub">↻</button></div>${renderGitHub(github)}</section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">任务容器</span><h3>Sections</h3></div><button class="text-action" data-action="new-section">新建</button></div>${renderSections(project)}</section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">工程记忆</span><h3>决策</h3></div><button class="text-action" data-action="new-decision">记录</button></div><ul class="decision-list">${(project.decisions || []).slice(0, 6).map((decision) => `<li><strong>${escapeHtml(typeof decision === "string" ? decision : decision.title || decision.summary || decision.detail)}</strong><small>${escapeHtml(typeof decision === "string" ? "" : decision.status || "proposed")}</small></li>`).join("") || "<li class=\"empty-row\">还没有结构化决策</li>"}</ul></section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">审计</span><h3>最近事件</h3></div><b>${project.events?.length || 0}</b></div><ul class="event-list">${(project.events || []).slice(0, 8).map((event) => `<li><span>${escapeHtml(formatClock(event.at))}</span><strong>${escapeHtml(event.detail || event.type)}</strong></li>`).join("") || "<li class=\"empty-row\">暂无事件</li>"}</ul></section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">无损存储</span><h3>会话归档</h3></div><b>${(snapshot.archives?.[project.id] || project.archiveManifests || []).length}</b></div>${renderArchives(snapshot, project)}</section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">桌面显示</span><h3>面板置顶</h3></div><button class="action action--quiet" data-action="toggle-pin">${snapshot.window?.alwaysOnTop ? "取消置顶" : "置顶"}</button></div><small class="drawer-note">置顶只影响 Harness 自己的窗口，不会抢焦点或影响其他 Agent。</small></section>
        <section class="drawer-section"><span class="eyebrow">可用 Agent</span><div class="agent-list">${(["codex", "claude", "hermes"] as const).map((agent) => `<div class="agent-row" title="${escapeHtml(snapshot.agents?.[agent]?.capabilities?.join("、") || "无能力清单")}"><span class="agent-light ${snapshot.agents?.[agent]?.installed ? "agent-light--on" : ""}"></span><strong>${agentLabel(agent)}</strong><small>${snapshot.agents?.[agent]?.installed ? `${snapshot.agents[agent].mode || "已检测"}` : "未找到"}</small></div>`).join("")}</div></section>
        <section class="drawer-section"><div class="drawer-section-title"><div><span class="eyebrow">上下文容器</span><h3>会话</h3></div><b>${projectSessions.length}</b></div><ul class="session-list">${sessions || "<li class=\"empty-row\">还没有会话</li>"}</ul></section>
        <section class="drawer-section drawer-actions"><span class="eyebrow">项目工具 · ${project.archiveManifests?.length || 0} 个归档</span><div class="drawer-action-grid"><button class="action action--quiet" data-action="open-ledger">打开动态白皮书</button><button class="action action--quiet" data-action="import-archive">导入会话归档</button><button class="action action--quiet" data-action="open-archive">查看归档目录</button><button class="action action--quiet" data-action="export-project">导出项目包</button><button class="action action--quiet" data-action="import-project">导入项目包</button><button class="action action--quiet" data-action="apply-template">套用项目模板</button>${project.status === "archived" ? `<button class="action action--accept" data-action="restore-project">恢复项目</button>` : `<button class="action action--quiet" data-action="archive-project">归档项目</button>`}${project.status === "active" ? `<button class="action action--quiet" data-action="pause-project">暂停项目</button>` : project.status === "paused" ? `<button class="action action--accept" data-action="resume-project">恢复运行</button>` : ""}</div><small class="drawer-note">归档只改变 Harness 项目状态，不删除 Git、Codex 对话或原始归档。</small></section>
      </div>
    </aside>`;
}

function renderSectionOptions(sections: Section[], selectedId = ""): string {
  return sections.map((section) => `<option value="${escapeHtml(section.id)}"${section.id === selectedId ? " selected" : ""}>${escapeHtml(section.name)} · ${section.kind === "one-shot" ? "一次性" : "可复用"} · ${escapeHtml(agentLabel(section.agent))}</option>`).join("");
}

function renderDependencyOptions(project: Project | undefined): string {
  const tasks = (project?.tasks || []).filter((task) => Boolean(task.id)).slice(0, 100);
  if (!tasks.length) return `<option value="" disabled>暂无可依赖任务</option>`;
  return tasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)} · ${escapeHtml(statusCopy[task.status] || task.status)}</option>`).join("");
}

export function renderApp(snapshot: Snapshot, detailsOpen = false): string {
  const locale = snapshot.guide?.locale === "en" ? "en" : "zh-CN";
  const protectedValues = snapshot.state.projects.flatMap((item) => [
    item.name, item.goal, item.objective?.title,
    ...(item.tasks || []).flatMap((task) => [task.title, task.workstream, ...(task.criteria || []), task.candidate?.summary, task.candidate?.nextStep]),
    ...(item.sections || []).map((section) => section.name),
    ...(item.events || []).map((event) => event.detail),
  ]).filter(Boolean);
  const project = snapshot.state.projects.find((item) => item.id === snapshot.state.selectedProjectId) || snapshot.state.projects[0];
  const guide = renderGuide(snapshot.guide || {}, snapshot.guideRecommendation || {});
  if (!project) return localizeAppHtml(`<div class="app-shell app-shell--empty"><main class="fatal-empty"><span class="brand-code">APH</span><h1>先建个项目吧</h1><p>这里只保存名称和目标，不会连接 Codex，也不会读取代码或历史记录。</p><button class="action action--accept" data-action="add-project" data-guide-target="project-create-blank">新建项目</button>${renderDialogs(snapshot)}<div id="toast" class="toast" role="status" aria-live="polite"></div></main>${guide}</div>`, locale, protectedValues);
  const projectTasks = project.tasks || [];
  const accepted = projectTasks.filter((task) => task.status === "accepted").length;
  const waiting = projectTasks.filter((task) => task.status === "review").length;
  const running = projectTasks.filter((task) => ["in_progress", "awaiting_result"].includes(task.status)).length;
  const git = snapshot.git?.[project.id] || project.gitSnapshot;
  const github = snapshot.github?.[project.id] || project.githubSnapshot;
  const activeProjectCount = snapshot.state.projects.filter((item) => item.status !== "archived").length;
  return localizeAppHtml(`<div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-code">APH</span><div><strong>AI Project Harness</strong><small>项目持续，Agent 轮换</small></div></div><div class="project-context"><span>${escapeHtml(project.name)}</span><b>HEAD R${project.revision}</b></div><div class="top-actions"><button class="action action--quiet" data-action="guide-open">小助手</button><button class="action action--quiet action--refresh" data-action="refresh">刷新状态</button>${!project.codexProjectId ? `<button class="action action--quiet" data-action="connect-codex" data-guide-target="project-connect-codex">连接 Codex</button>` : `<button class="action action--quiet action--open-codex" data-action="open-codex-project">打开最近对话</button>`}<button class="action action--quiet action--new-conversation" data-action="new-conversation">新对话</button><button class="action action--quiet action--details" data-action="open-details">项目详情</button><button class="action action--quiet action--cto" data-action="open-cto">进入 CTO</button>${project.status === "archived" ? `<button class="action action--accept" data-action="restore-project" data-guide-target="project-restore">恢复项目</button>` : `<button class="action action--accept" data-action="new-task" data-guide-target="task-create">新建任务</button>`}</div></header>
    <aside class="project-rail"><div class="rail-title"><span>项目 <small>${activeProjectCount} 个活动</small></span><b>${snapshot.state.projects.length}</b></div><label class="rail-search"><span>筛选项目</span><input id="project-search" type="search" placeholder="名称 / 状态" autocomplete="off" /></label><nav aria-label="项目列表">${renderProjectList(snapshot)}</nav><button class="add-project" data-action="add-project" aria-label="添加项目"><span aria-hidden="true">＋</span>添加项目</button></aside>
    <main class="work-surface">
      <div class="content-column">
        <section class="project-head"><div class="head-copy"><span class="eyebrow">现在做什么</span><h1>${escapeHtml(project.objective?.title || "未命名 Objective")}</h1><p>${escapeHtml(project.goal)}</p>${project.events?.[0] ? `<div class="latest-event"><span>最新事件</span><strong>${escapeHtml(project.events[0].detail || project.events[0].type)}</strong><small>${formatClock(project.events[0].at)}</small></div>` : ""}</div><div class="head-stats"><div><strong>${accepted}<span> / ${projectTasks.length}</span></strong><small>任务已验收</small></div><div class="head-status"><span class="state-dot ${waiting || running ? "state-dot--attention" : ""}"></span>${running ? `${running} 个 Agent 正在运行` : waiting ? `${waiting} 项结果待确认` : "项目状态正常"}</div></div></section>
        ${renderReview(project)}
        <section class="task-section"><div class="section-title"><div><span class="eyebrow">项目任务</span><h2>任务列表</h2></div><span>${projectTasks.length} 项</span></div><div class="task-list">${projectTasks.map((task) => renderTask(task, project)).join("") || "<div class=\"empty-tasks\"><strong>还没有任务</strong><p>新建一个清晰、可验收的工作单元。</p></div>"}</div></section>
        ${renderCheckpoint(project)}
        ${renderTimeline(project)}
      </div>
    </main>
    ${renderDetailsDrawer(snapshot, project, git, github, detailsOpen)}
    ${renderDialogs(snapshot)}
    ${guide}
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>`, locale, protectedValues);
}

function renderDialogs(snapshot?: Snapshot): string {
  const dialogProject = snapshot?.state.projects.find((item) => item.id === snapshot.state.selectedProjectId);
  const dialogSections = (dialogProject?.sections || []).filter((section) => section.kind !== "main" && !["closed", "archived"].includes(section.status));
  const codexAvailable = Boolean(snapshot?.agents?.codex?.installed);
  const codexConnectionLabel = codexAvailable ? "已找到 Codex" : "没有检测到 Codex";
  const codexConnectionDetail = codexAvailable
    ? "你可以选择一个现有的 Codex 项目。确认导入前，不会启动任何任务。"
    : "没有检测到 Codex，但你仍然可以先新建项目";
  const dependencyOptions = renderDependencyOptions(dialogProject);
  const sectionOptions = renderSectionOptions(dialogSections);
  return `<dialog id="project-dialog" class="acid-dialog acid-dialog--project"><form id="project-form" data-mode=""><div class="dialog-title"><span>添加项目</span><button type="button" data-close aria-label="关闭">×</button></div><div class="project-onboarding-copy"><span class="eyebrow">从哪里开始？</span><h2>新建一个，或者从 Codex 带过来。</h2><p>新建项目不会自动连接 Codex。导入时也只会读取你选中的项目，不会翻看其他对话。</p></div><input type="hidden" name="entryMode" value="" />
    <div class="project-mode-choice" role="group" aria-label="项目来源"><button type="button" class="project-mode-card" data-action="select-project-mode" data-mode="blank" data-guide-target="project-create-blank" aria-label="新建项目" aria-pressed="false"><span class="project-mode-card__index">01</span><strong>新建项目</strong><small>先保存项目名称和目标，之后再选择文件夹或连接 Codex。</small></button><button type="button" class="project-mode-card" data-action="select-project-mode" data-mode="import" data-guide-target="project-import-registered" aria-label="从 Codex 导入" aria-pressed="false"><span class="project-mode-card__index">02</span><strong>从 Codex 导入</strong><small>从你已经在 Codex 中建立的项目导入现有信息。</small></button></div>
    <section class="project-mode-panel" data-project-mode-panel="blank" hidden><span class="eyebrow">新建项目</span><label>项目名称（必填）<input name="blankName" required maxlength="120" autocomplete="off" placeholder="例如：我的第一个项目" /></label><label>项目文件夹（可选）<input name="blankPath" maxlength="500" autocomplete="off" placeholder="现在不选也没关系" /></label><label>你想完成什么？（可选）<textarea name="blankGoal" rows="3" placeholder="例如：整理需求并完成第一个可验收任务"></textarea></label><div class="field-pair"><label>技术栈（可选）<textarea name="blankTechStack" rows="3" placeholder="每行一项"></textarea></label><label>需要注意的事项（可选）<textarea name="blankConstraints" rows="3" placeholder="每行一项"></textarea></label></div><p class="dialog-help">这里只会在 Harness 中保存项目资料，不会连接 Codex，也不会读取代码或历史记录。</p></section>
    <section class="project-mode-panel" data-project-mode-panel="import" hidden><span class="eyebrow">从 Codex 导入</span><label>Codex 项目名称<input name="importName" maxlength="120" autocomplete="off" placeholder="例如：portfolio" /></label><p class="dialog-help">如果找到多个相似项目，我们会让你选择，不会自动替你决定。</p><div class="agent-connection" aria-label="${codexAvailable ? "已找到 Codex" : "没有检测到 Codex"}"><span class="agent-light${codexAvailable ? " agent-light--on" : ""}"></span><div><strong>${codexConnectionLabel}</strong><small>${codexConnectionDetail}</small></div></div></section>
    <div id="project-entry-hint" class="project-entry-hint" role="status">选择一种方式后继续。</div><div id="project-onboarding-status" class="project-onboarding-status" hidden></div><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept" disabled>选择方式后继续</button></div></form></dialog>
    <dialog id="task-dialog" class="acid-dialog"><form id="task-form"><div class="dialog-title"><span>新建任务</span><button type="button" data-close aria-label="关闭">×</button></div><label>任务名称<input name="title" required maxlength="120" /></label><label>工作流<input name="workstream" value="general" maxlength="60" /></label><label>验收条件<textarea name="criteria" rows="4" placeholder="每行一条验收条件"></textarea></label><div class="field-pair"><label>执行 Agent<select name="agent"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="hermes">Hermes</option></select></label><label>会话策略<select name="sessionPolicy"><option value="auto">自动选择</option><option value="warm">温会话</option><option value="disposable">一次性会话</option></select></label></div><div class="field-pair"><label>优先级<select name="priority"><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option><option value="low">低</option></select></label><label>指定 Section（可选）<select name="sectionId"><option value="">开始时自动按工作流选择</option>${sectionOptions}</select></label></div><label>前置任务（可选）<select name="dependsOn" multiple size="4" aria-describedby="task-dependencies-help">${dependencyOptions}</select><small id="task-dependencies-help" class="dialog-help">可选；按住 Ctrl/⌘ 可多选，任务会等前置任务验收后再启动。</small></label><label>审核方式<select name="reviewMode"><option value="user">用户确认后推进（推荐）</option><option value="auto">Review Agent 自动推进</option></select></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">创建任务</button></div></form></dialog>
    <dialog id="section-assignment-dialog" class="acid-dialog"><form id="section-assignment-form"><div class="dialog-title"><span>改派任务 Section</span><button type="button" data-close aria-label="关闭">×</button></div><input type="hidden" name="taskId"/><p class="dialog-help">任务改派只更新后续调度归属，不会重跑已完成的任务；运行中的任务请先停止。</p><p>任务：<strong id="section-assignment-task-title">--</strong></p><label>目标 Section<select name="sectionId" required>${sectionOptions || `<option value="" disabled>暂无可用 Section</option>`}</select></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">保存改派</button></div></form></dialog>
    <dialog id="section-dialog" class="acid-dialog"><form id="section-form"><div class="dialog-title"><span>新建工作 Section</span><button type="button" data-close aria-label="关闭">×</button></div><p class="dialog-help">主控 Section 只负责调配；这里创建一个可复用或一次性执行区。</p><label>Section 名称<input name="name" required maxlength="80" placeholder="例如：前端迭代" /></label><div class="field-pair"><label>类型<select name="kind"><option value="reusable">可复用 Section</option><option value="one-shot">一次性 Section</option></select></label><label>默认 Agent<select name="agent"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="hermes">Hermes</option></select></label></div><label>审核方式<select name="approvalMode"><option value="user">用户确认后推进（推荐）</option><option value="auto">Review Agent 自动推进</option></select></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">创建 Section</button></div></form></dialog>
    <dialog id="contract-dialog" class="acid-dialog acid-dialog--wide"><form id="contract-form"><div class="dialog-title"><span>项目契约</span><button type="button" data-close aria-label="关闭">×</button></div><p class="dialog-help">这里保存长期事实；它会进入 CTO/Review 上下文和动态项目白皮书。</p><label>项目目录<input name="projectPath" maxlength="500" placeholder="空白项目可在这里绑定本地工作区" /></label><label>项目目标<textarea name="goal" rows="3"></textarea></label><label>当前 Objective<textarea name="objectiveTitle" rows="2"></textarea></label><div class="field-pair"><label>技术栈<textarea name="techStack" rows="4" placeholder="每行一项"></textarea></label><label>约束 / 要求<textarea name="constraints" rows="4" placeholder="每行一项"></textarea></label></div><label>待解决问题 / 阻塞<textarea name="blockers" rows="3" placeholder="每行一项"></textarea></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">保存契约</button></div></form></dialog>
    <dialog id="remote-dialog" class="acid-dialog"><form id="remote-form"><div class="dialog-title"><span>连接 GitHub 远端</span><button type="button" data-close aria-label="关闭">×</button></div><p class="dialog-help">只保存 Git 的 origin 地址；不会登录或上传代码。提交后可用本机 gh 读取 PR/Issue。</p><label>远端地址<input name="remoteUrl" required maxlength="500" placeholder="https://github.com/owner/repo.git" /></label><label>远端名称<input name="remoteName" value="origin" maxlength="64" /></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">保存远端</button></div></form></dialog>
    <dialog id="template-dialog" class="acid-dialog"><form id="template-form"><div class="dialog-title"><span>套用项目模板</span><button type="button" data-close aria-label="关闭">×</button></div><p class="dialog-help">模板只填充目标、技术栈、约束和不重复的起始任务；已有内容不会删除。</p><label>模板<select name="templateId"><option value="blank">空白项目</option><option value="web">Web 应用</option><option value="library">库 / SDK</option><option value="automation">自动化工具</option><option value="research">研究 / 原型</option></select></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">应用模板</button></div></form></dialog>
    <dialog id="decision-dialog" class="acid-dialog"><form id="decision-form"><div class="dialog-title"><span>记录工程决策</span><button type="button" data-close aria-label="关闭">×</button></div><label>决策内容<textarea name="title" rows="3" required maxlength="1200" placeholder="例如：保持本地优先，不上传 transcript"></textarea></label><label>理由（可选）<textarea name="rationale" rows="3" maxlength="2000"></textarea></label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">保存决策</button></div></form></dialog>
    <dialog id="conversation-dialog" class="acid-dialog"><form id="conversation-form"><div class="dialog-title"><span>新建项目对话</span><button type="button" data-close aria-label="关闭">×</button></div><p class="dialog-help">Harness 会在当前项目下创建一个独立对话，不会继续堆积旧的 resume 历史。</p><label>对话主题<input name="title" required maxlength="160" placeholder="例如：讨论下一阶段架构" /></label><div class="field-pair"><label>Agent<select name="agent"><option value="codex">Codex Project 对话</option><option value="claude">Claude Code（用户主动）</option><option value="hermes">Hermes（用户主动）</option></select></label><label>会话类型<select name="type"><option value="warm">可继续的温会话</option><option value="disposable">一次性讨论</option></select></label></div><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">创建并打开</button></div></form></dialog>
    <dialog id="objective-dialog" class="acid-dialog"><form id="objective-form"><div class="dialog-title"><span>切换 Objective</span><button type="button" data-close aria-label="关闭">×</button></div><p class="dialog-help">旧 Objective 会保留在历史中，并自动变为暂停或 superseded；项目同时只保留一个 active Objective。</p><label>新 Objective<input name="title" required maxlength="1200" placeholder="例如：完成跨 Agent 回写验收" /></label><label class="checkbox-line"><input type="checkbox" name="supersede" /> 将当前 Objective 标记为 superseded</label><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">切换</button></div></form></dialog>
    <dialog id="result-dialog" class="acid-dialog acid-dialog--wide"><form id="result-form"><div class="dialog-title"><span>提交 Agent 结果</span><button type="button" data-close aria-label="关闭">×</button></div><input type="hidden" name="taskId"/><label>结构化结果 JSON<textarea name="result" rows="16" spellcheck="false"></textarea></label><p class="dialog-help">正常情况下结果由 Agent 自动回写并交给项目 Review Agent；这里保留人工补交入口，便于恢复异常运行。</p><div class="dialog-actions"><button type="button" data-close class="action action--quiet">取消</button><button type="submit" class="action action--accept">送交审核</button></div></form></dialog>`;
}
