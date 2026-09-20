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
  const localRequire = (specifier) => ["./guide-view.mjs", "./app-copy.mjs"].includes(specifier)
    ? require(path.join(__dirname, "..", "src", specifier.slice(2)))
    : require(specifier);
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
      detail: "请完全退出 Codex Desktop 后重新打开，再核对侧栏。",
    },
  };
  return {
    state: { schemaVersion: 1, selectedProjectId: projectId, projects: [project] },
    git: { [projectId]: { available: false, checkedAt: "2026-09-04T00:00:00.000Z" } },
    github: {},
    agents: {
      codex: { installed: codexInstalled, path: codexInstalled ? "C:\\fixture\\codex.exe" : "" },
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
  assert.match(html, /官方 Project 已创建 · 待冷启动核对/);
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
  assert.match(codexHtml, /开始任务（注入 Codex）/);
  assert.match(codexHtml, /title="开始任务后注入 Codex"/);
});

test("project onboarding clearly separates blank creation from Codex project import", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(true));

  assert.match(html, /id="project-dialog"/);
  assert.match(html, /data-action="select-project-mode" data-mode="blank"/);
  assert.match(html, /data-action="select-project-mode" data-mode="import"/);
  assert.match(html, /新建项目/);
  assert.match(html, /不会连接 Codex，也不会读取代码或历史记录/);
  assert.match(html, /从 Codex 导入/);
  assert.match(html, /只会读取你选中的项目/);
  assert.doesNotMatch(html, /独立事务|已登记|Project \/ cwd|Agent turn|按标题猜测/);
  assert.match(html, /name="entryMode"/);
  assert.match(html, /选择一种方式后继续/);
  assert.match(html, /type="submit" class="action action--accept" disabled>选择方式后继续/);
});

test("renderer does not claim a Codex connection when Codex is unavailable", () => {
  const { renderApp } = loadViewModule();
  const html = renderApp(fixture(false));
  assert.match(html, /没有检测到 Codex/);
  assert.match(html, /没有检测到 Codex，但你仍然可以先新建项目/);
  assert.match(html, /<div class="agent-connection" aria-label="没有检测到 Codex"><span class="agent-light"><\/span>/);
  assert.doesNotMatch(html, /<div class="agent-connection"[^>]*>.*agent-light agent-light--on/s);
});

test("English locale switches the complete core workflow, not only the guide", () => {
  const { renderApp } = loadViewModule();
  const state = fixture(true);
  state.guide = { ...(state.guide || {}), locale: "en", dismissed: false, sessionId: "guide-en", probes: {}, operations: {}, completionEvidence: [], steps: {}, schemaVersion: 1, copyVersion: 1, sequence: 1 };
  const html = renderApp(state);

  for (const phrase of [
    "Getting started",
    "Add project",
    "Create project",
    "Import from Codex",
    "New task",
    "Project details",
    "Task list",
    "No results need your review",
  ]) assert.match(html, new RegExp(phrase));

  assert.doesNotMatch(html, /小助手|添加项目|新建项目|从 Codex 导入|新建任务|项目详情|任务列表|目前没有需要确认的结果|接受并推进 HEAD/);

  const englishOnly = fixture(true);
  englishOnly.guide = { ...state.guide };
  const project = englishOnly.state.projects[0];
  project.name = "Sample project";
  project.goal = "Sample goal";
  project.objective.title = "Sample objective";
  project.codexProjectSync.detail = "Restart note";
  project.tasks.forEach((task, index) => {
    task.title = `Sample task ${index}`;
    task.workstream = "sample-workstream";
    task.criteria = ["Sample acceptance check"];
  });
  project.sections.forEach((section, index) => { section.name = `Sample section ${index}`; });
  project.sessions.forEach((session, index) => { session.title = `Sample session ${index}`; });
  const englishOnlyHtml = renderApp(englishOnly).replaceAll("中文", "");
  assert.doesNotMatch(englishOnlyHtml, /\p{Script=Han}/u, "English UI contains an untranslated framework label");
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

test("renderer submission contract sanitizes dependency ids and calls Section assignment API", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  assert.match(source, /selectProjectEntryMode/);
  assert.match(source, /window\.harness\.createBlankProject/);
  assert.doesNotMatch(source, /window\.harness\.createConnectedProject/);
  assert.match(source, /本地项目已创建；没有搜索历史或连接 Agent/);
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
  assert.match(source, /官方 Project 已确认；请完全退出 Codex Desktop/);
});
