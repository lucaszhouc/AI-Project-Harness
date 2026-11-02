const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadViewModule() {
  const sourcePath = path.join(__dirname, "..", "src", "view.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => require(specifier);
  vm.runInNewContext(output, { exports: module.exports, module, require: localRequire, console }, { filename: sourcePath });
  return module.exports;
}

function fixture(codexInstalled = true) {
  const projectId = "project-ui";
  const sections = [
    {
      id: "section-hermes",
      name: "研究接力",
      kind: "reusable",
      role: "worker",
      agent: "hermes",
      status: "idle",
      approvalMode: "user",
      taskIds: ["task-ready"],
      useCount: 1,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
    {
      id: "section-codex",
      name: "实现接力",
      kind: "reusable",
      role: "worker",
      agent: "codex",
      status: "idle",
      approvalMode: "user",
      taskIds: ["task-accepted"],
      useCount: 2,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
    {
      id: "section-closed",
      name: "已关闭接力",
      kind: "reusable",
      role: "worker",
      agent: "hermes",
      status: "closed",
      approvalMode: "user",
      taskIds: [],
      useCount: 0,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
    {
      id: "section-main",
      name: "主控",
      kind: "main",
      role: "steward",
      agent: "codex",
      status: "idle",
      approvalMode: "user",
      taskIds: [],
      useCount: 0,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
  ];
  const tasks = [
    {
      id: "task-ready",
      title: "准备 Hermes 研究任务",
      workstream: "research",
      criteria: ["给出可复核证据"],
      agent: "hermes",
      sessionPolicy: "warm",
      status: "ready",
      baseRevision: 1,
      sectionId: "section-hermes",
      dependsOn: [],
      createdAt: "2026-09-04T00:00:00.000Z",
    },
    {
      id: "task-accepted",
      title: "已完成的实现任务",
      workstream: "implementation",
      criteria: ["通过测试"],
      agent: "codex",
      sessionPolicy: "warm",
      status: "accepted",
      baseRevision: 1,
      sectionId: "section-codex",
      dependsOn: [],
      createdAt: "2026-09-04T00:00:00.000Z",
      run: {
        id: "run-accepted",
        sessionId: "session-accepted",
        baseRevision: 1,
        startedAt: "2026-09-04T00:00:00.000Z",
        status: "completed",
        phase: "completed",
        progress: 100,
      },
    },
  ];
  const project = {
    id: projectId,
    name: "UI Fixture",
    path: "E:\\fixture\\ui",
    status: "active",
    revision: 3,
    goal: "验证面板入口",
    objective: { id: "objective-ui", title: "验证 UI 入口", status: "active" },
    tasks,
    sessions: [{
      id: "session-hermes",
      role: "task",
      title: "Hermes 研究会话",
      agent: "hermes",
      type: "warm",
      status: "warm",
      workstream: "research",
      cursor: 3,
      taskIds: ["task-ready"],
      createdAt: "2026-09-04T00:00:00.000Z",
    }],
    sections,
    checkpoints: [],
    decisions: [],
    events: [],
    updatedAt: "2026-09-04T00:00:00.000Z",
    codexProjectId: "official-project-ui",
    codexProjectSync: {
      state: "desktop-restart-required",
      officialProjectId: "official-project-ui",
      checkedAt: "2026-09-04T00:00:00.000Z",
      detail: "请在现有 Codex Desktop 窗口刷新或手动核对侧栏。",
    },
  };
  return {
    state: { schemaVersion: 1, selectedProjectId: projectId, projects: [project] },
    git: { [projectId]: { available: false, checkedAt: "2026-09-04T00:00:00.000Z" } },
    github: {},
    agents: {
      codex: { installed: false, path: "" },
      claude: { installed: false, path: "" },
      hermes: { installed: true, path: "C:\\fixture\\hermes.exe" },
    },
    platform: "win32",
    window: { alwaysOnTop: false },
  };
}

test("renderer exposes Hermes Sections, task reassignment, and dependency choices", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(true));

  assert.match(html, /<option value="hermes">Hermes<\/option>/);
  assert.match(html, /研究接力<\/strong><small>Hermes · 空闲/);
  assert.doesNotMatch(html, /研究接力<\/strong><small>Codex · 空闲/);
  assert.match(html, /data-action="assign-section" data-task="task-ready">改派 Section<\/button>/);
  assert.match(html, /data-action="assign-section" data-task="task-accepted">改派 Section<\/button>/);
  assert.match(html, /id="section-assignment-dialog"/);
  assert.match(html, /name="dependsOn" multiple/);
  assert.match(html, /<option value="task-ready">准备 Hermes 研究任务/);
  assert.match(html, /<option value="task-accepted">已完成的实现任务/);
  assert.match(html, /<span class="session-agent">Hermes<\/span>/);
  assert.doesNotMatch(html, /<option value="section-closed">/);
  assert.doesNotMatch(html, /<option value="section-main">/);
  assert.match(html, /官方 Project 已创建 · 侧栏待核对/);
  const codexState = fixture(true);
  codexState.state.projects[0].tasks.unshift({
    id: "task-codex-ready",
    title: "待注入 Codex",
    workstream: "implementation",
    criteria: [],
    agent: "codex",
    sessionPolicy: "auto",
    status: "ready",
    baseRevision: 3,
    createdAt: "2026-09-04T00:00:00.000Z",
  });
  const codexHtml = renderApp(codexState);
  assert.match(codexHtml, /准备原生 Codex 任务/);
  assert.match(codexHtml, /不会创建隐藏执行器/);
});

test("unrecoverable state is shown as an explicit safe recovery mode", () => {
  const { renderApp } = loadViewModule();
  const snapshot = fixture(true);
  snapshot.state.recovery = {
    mode: "safe-recovery",
    status: "unrecoverable",
    detail: "检测到既有状态，但主文件和日志都无法恢复。",
  };
  snapshot.state.projects[0].tasks[0] = {
    ...snapshot.state.projects[0].tasks[0],
    status: "review",
    candidate: { summary: "待恢复", completed: [], remaining: [], nextStep: "先恢复", acceptance: [], evidence: [] },
    run: { id: "run-recovery", sessionId: "session-hermes", baseRevision: 3, startedAt: "2026-09-04T00:00:00.000Z", status: "awaiting_review" },
    review: { status: "legacy_unverified", agent: "codex", automatic: false },
  };
  const html = renderApp(snapshot);
  assert.match(html, /安全恢复模式/);
  assert.match(html, /没有把空状态当作原项目/);
  assert.match(html, /恢复可信状态后才能接受/);
  assert.doesNotMatch(html, /data-action="accept"/);
});

test("inconclusive automatic evidence stays visibly behind human confirmation", () => {
  const { renderApp } = loadViewModule();
  const snapshot = fixture(true);
  const project = snapshot.state.projects[0];
  project.tasks[0] = {
    ...project.tasks[0],
    status: "review",
    reviewMode: "auto",
    candidate: { summary: "证据不完整", completed: [], remaining: [], nextStep: "人工确认", acceptance: [], evidence: [] },
    run: { id: "run-review", sessionId: "session-hermes", baseRevision: 3, startedAt: "2026-09-04T00:00:00.000Z", status: "awaiting_review", resultSource: "agent-auto" },
    review: { status: "inconclusive", agent: "codex", automatic: false },
  };
  const html = renderApp(snapshot);
  assert.match(html, /等待你的确认/);
  assert.match(html, /接受并推进 HEAD/);
  assert.doesNotMatch(html, /Review Agent 自动审核中/);
  assert.doesNotMatch(html, /Review Agent 后台审核中/);
});

test("task session copy describes logical workstream reuse instead of provider-thread resume", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(true));
  assert.match(html, /<option value="warm">复用工作流<\/option>/);
  assert.match(html, /研究接力<\/span><span>复用工作流<\/span>/);
});

test("project onboarding separates blank, whole-project, and checkbox conversation import", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(true));

  assert.match(html, /id="project-dialog"/);
  assert.match(html, /data-action="select-project-mode" data-mode="blank"/);
  assert.match(html, /data-action="select-project-mode" data-mode="import"/);
  assert.match(html, /data-action="select-project-mode" data-mode="threads"/);
  assert.match(html, /新建项目/);
  assert.match(html, /通过 Desktop 原生深链注册 Project/);
  assert.match(html, /关键词整理/);
  assert.match(html, /固定你勾选的对话范围/);
  assert.match(html, /手动选对话/);
  assert.match(html, /id="codex-conversation-picker"/);
  assert.match(html, /name="threadsName"/);
  assert.match(html, /直接勾选多个对话/);
  assert.doesNotMatch(html, /独立事务|已登记|Project \/ cwd|Agent turn|按标题猜测/);
  assert.match(html, /name="entryMode"/);
  assert.match(html, /选择一种方式后继续/);
  assert.match(html, /type="submit" class="action action--accept" disabled>选择方式后继续/);
});

test("knowledge candidates render as source-linked rule and Playbook reviews", () => {
  const { renderApp } = loadViewModule();
  const snapshot = fixture(true);
  snapshot.state.projects[0].knowledgeCandidates = [
    {
      id: "rule-1", type: "rule", status: "pending", title: "交付前必须测试", scope: "project", kind: "must",
      statement: "功能更新交付前必须运行打包后测试。", rationale: "源码测试不能证明 EXE 可用。",
      sources: [{ evidenceId: "u1", quote: "测试完的测试结果也要发。", role: "user", threadId: "thread-1", turnId: "turn-1" }],
    },
    {
      id: "playbook-1", type: "playbook", status: "pending", title: "桌面新版交付", scope: "project", trigger: "完成桌面功能更新", purpose: "交付用户可打开的新版",
      steps: [{ order: 1, action: "递增版本并打包", validation: "EXE 版本一致", sources: [{ evidenceId: "u2", quote: "版本不知道更新。", role: "user" }] }],
    },
  ];
  const html = renderApp(snapshot);
  assert.match(html, /用户规则候选/);
  assert.match(html, /功能更新交付前必须运行打包后测试/);
  assert.match(html, /测试完的测试结果也要发/);
  assert.match(html, /Playbook 候选/);
  assert.match(html, /递增版本并打包/);
  assert.match(html, /data-action="accept-knowledge" data-knowledge="rule-1"/);
  assert.match(html, /data-action="reject-knowledge" data-knowledge="playbook-1"/);
});

test("accepted rules and Playbooks remain visible in project details", () => {
  const { renderApp } = loadViewModule();
  const snapshot = fixture(true);
  snapshot.state.projects[0].ruleCards = [{ id: "rule-active", type: "rule", status: "active", title: "先打包后验收", scope: "project", kind: "must", statement: "必须验证最终 EXE。", sources: [] }];
  snapshot.state.projects[0].playbooks = [{ id: "playbook-active", type: "playbook", status: "active", version: 3, title: "桌面发布闭环", scope: "project", trigger: "发布新版", purpose: "可靠交付", steps: [{ order: 1, action: "运行 portable smoke", sources: [] }] }];
  const html = renderApp(snapshot);
  assert.match(html, /规则与 Playbook/);
  assert.match(html, /先打包后验收/);
  assert.match(html, /必须验证最终 EXE/);
  assert.match(html, /桌面发布闭环/);
  assert.match(html, /v3/);
});

test("renderer does not claim a Codex connection when Codex is unavailable", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(false));
  assert.match(html, /没有检测到 Codex/);
  assert.match(html, /没有检测到 Codex；关键词整理和手动整理需要先让 Codex 可用/);
  assert.match(html, /<div class="agent-connection" aria-label="没有检测到 Codex"><span class="agent-light"><\/span>/);
  assert.doesNotMatch(html, /<div class="agent-connection"[^>]*>.*agent-light agent-light--on/s);
});

test("renderer has no guide panel or locale toggle", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(true));
  assert.doesNotMatch(html, /getting-started|guide-|小助手|下一步与诊断|我来带路/);
  assert.doesNotMatch(html, /data-action="guide-/);
});

test("renderer puts project tools in the top bar and removes stale shortcuts", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(true));
  const topbar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf("</header>"));
  assert.match(topbar, /data-action="project-tools"/);
  assert.doesNotMatch(topbar, /data-action="refresh"|data-action="open-codex-project"|data-action="new-conversation"/);
  assert.match(html, /id="project-tools-dialog"/);
  assert.match(html, /data-action="remove-project">移出项目（可恢复）/);
  assert.doesNotMatch(html, /data-action="new-conversation"|id="conversation-dialog"/);
});

test("renderer hides archived projects and exposes restore list from project tools", () => {
  const { renderApp } = loadViewModule();
  const state = fixture(true);
  const archived = { ...state.state.projects[0], id: "project-archived", name: "旧归档项目", status: "archived", archive: { archivedAt: "2026-10-09T12:00:00.000Z", reason: "测试完成" } };
  state.state.projects.push(archived);
  const html = renderApp(state);
  const rail = html.slice(html.indexOf('<nav aria-label="项目列表">'), html.indexOf("</nav>"));
  assert.doesNotMatch(rail, /旧归档项目/);
  assert.match(html, /data-action="open-archived-projects">已归档项目（1）/);
  assert.match(html, /id="archived-projects-dialog"/);
  assert.match(html, /旧归档项目/);
  assert.match(html, /归档于/);
  assert.match(html, /data-action="restore-project" data-project="project-archived"/);
});

test("renderer shows timed out tasks as retryable", () => {
  const { renderApp } = loadViewModule();
  const state = fixture(true);
  state.state.projects[0].tasks.unshift({
    id: "task-timeout", title: "已超时任务", workstream: "general", criteria: [], agent: "codex", sessionPolicy: "warm", status: "timed_out", baseRevision: 3, createdAt: "2026-10-09T00:00:00.000Z",
    run: { id: "run-timeout", sessionId: "session-timeout", baseRevision: 3, startedAt: "2026-10-08T00:00:00.000Z", status: "timed_out", phase: "timed_out", error: "任务超过 24 小时 lease" },
  });
  const html = renderApp(state);
  assert.match(html, /已超时，可重试/);
  assert.match(html, /任务超过 24 小时 lease/);
  assert.match(html, /data-action="dispatch" data-task="task-timeout"/);
});

test("renderer tolerates legacy tasks without criteria or candidate arrays", () => {
  const { renderApp } = loadViewModule();
  const state = fixture(true);
  const project = state.state.projects[0];
  project.tasks[0].criteria = undefined;
  project.tasks[0].status = "review";
  project.tasks[0].candidate = { summary: "旧格式候选", nextStep: "", completed: [], remaining: [] };
  delete state.git;
  delete state.agents;
  assert.doesNotThrow(() => renderApp(state));
  const html = renderApp(state);
  assert.match(html, /尚未填写验收条件/);
  assert.match(html, /没有附加证据/);
});

test("failed import tasks keep the actionable failure visible after the dialog closes", () => {
  const { renderApp } = loadViewModule();
  const state = fixture(true);
  const task = state.state.projects[0].tasks[0];
  task.workstream = "codex-project-import";
  task.status = "failed";
  task.run = { ...(task.run || {}), status: "failed", phase: "failed", error: "官方 Project 根目录不一致" };
  const html = renderApp(state);
  assert.match(html, /官方 Project 根目录不一致/);
  assert.match(html, /重试 Codex 回填/);
});

test("awaiting visible import keeps an exact prompt recopy action", () => {
  const { renderApp } = loadViewModule();
  const state = fixture(true);
  const project = state.state.projects[0];
  const task = project.tasks[0];
  task.workstream = "codex-project-import";
  task.status = "awaiting_result";
  task.run = { ...(task.run || {}), status: "awaiting_user", userActionRequired: true, externalThreadId: "visible-import" };
  const html = renderApp(state);
  assert.match(html, /复制整理指令/);
});

test("renderer submission contract sanitizes dependency ids and calls Section assignment API", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  assert.match(source, /selectProjectEntryMode/);
  assert.match(source, /window\.harness\.createBlankProject/);
  assert.doesNotMatch(source, /window\.harness\.createConnectedProject/);
  assert.ok(source.includes("自动创建尚未接通"));
  assert.ok(source.includes("已准备项目初始化；标准对话等待初始化结果回写"));
  assert.match(source, /window\.harness\.importCodexProject\(\{ name: projectName/);
  assert.doesNotMatch(source, /if \(mode === "import"\)[\s\S]{0,900}window\.harness\.addProjectByName/);
  assert.match(source, /targetProjectId: projectImportTargetId/);
  assert.match(source, /data\.get\("entryMode"\)/);
  assert.match(source, /data\.getAll\("dependsOn"\)/);
  assert.match(source, /filter\(\(id\) => project\.tasks\.some\(\(task\) => task\.id === id\)\)/);
  assert.match(source, /window\.harness\.assignTaskToSection\(project\.id, taskId, sectionId\)/);
  assert.match(source, /selectedOptions/);
  assert.match(source, /selectedValues/);
  assert.match(source, /任务已创建；尚未注入 Agent/);
  assert.match(source, /官方 Project 已确认；请在现有 Codex Desktop 窗口刷新或手动核对侧栏/);
});
