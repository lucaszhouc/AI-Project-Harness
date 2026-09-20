import "./base.css";
import "./app.css";
import type { CandidateResult, Snapshot, Task } from "./types";
import { renderApp } from "./view";
import { userFacingErrorDetails, userFacingErrorMessage } from "./ipc-error-message.mjs";
import { completedOnboardingState, escapeOnboardingHtml, failedOnboardingState, progressOnboardingState, renderOnboardingStatus } from "./onboarding-ui.mjs";
import { localizeAppHtml } from "./app-copy.mjs";

const rootCandidate = document.querySelector<HTMLDivElement>("#app");
if (!rootCandidate) throw new Error("App root not found");
const root: HTMLDivElement = rootCandidate;

let snapshot: Snapshot;
let pendingRuntimeSnapshot: Snapshot | undefined;
let pointerInteractionActive = false;
let scrollInteractionActive = false;
let scrollInteractionTimer: number | undefined;
let busy = false;
let detailsOpen = false;
let projectSearchQuery = "";
let activeToast: { message: string; kind: "ok" | "error"; expiresAt: number } | undefined;
let toastTimer: number | undefined;
let projectImportTargetId: string | undefined;
let projectImportSourceId: string | undefined;
let connectedProjectId: string | undefined;
let activeGuideProbeSubject: string | undefined;
let onboardingState: ReturnType<typeof progressOnboardingState> | ReturnType<typeof failedOnboardingState> | ReturnType<typeof completedOnboardingState> | { status: "idle" } = { status: "idle" };

function currentLocale(): "zh-CN" | "en" {
  return snapshot?.guide?.locale === "en" ? "en" : "zh-CN";
}

function uiText(value: string): string {
  return localizeAppHtml(value, currentLocale());
}

function shouldAcceptSnapshot(next: Snapshot): boolean {
  if (!snapshot) return true;
  if (Number.isFinite(Number(next.sequence)) && Number.isFinite(Number(snapshot.sequence))
    && Number(next.sequence) < Number(snapshot.sequence)) return false;
  const currentProject = snapshot.state.projects.find((project) => project.id === snapshot.state.selectedProjectId);
  const nextProject = next.state.projects.find((project) => project.id === next.state.selectedProjectId);
  if (!currentProject || !nextProject || currentProject.id !== nextProject.id) return true;
  if (Number(nextProject.revision || 0) < Number(currentProject.revision || 0)) return false;
  if (Number(nextProject.revision || 0) === Number(currentProject.revision || 0)
    && nextProject.updatedAt && currentProject.updatedAt
    && String(nextProject.updatedAt) < String(currentProject.updatedAt)) return false;
  return true;
}

function setSnapshot(next: Snapshot): boolean {
  if (!shouldAcceptSnapshot(next)) return false;
  snapshot = next;
  pendingRuntimeSnapshot = undefined;
  return true;
}

function selectedProject() {
  return snapshot.state.projects.find((project) => project.id === snapshot.state.selectedProjectId) || snapshot.state.projects[0];
}

function render() {
  root.innerHTML = renderApp(snapshot, detailsOpen);
  restoreActiveToast();
  const search = document.querySelector<HTMLInputElement>("#project-search");
  if (search) {
    search.value = projectSearchQuery;
    const query = projectSearchQuery.normalize("NFKC").trim().toLowerCase();
    document.querySelectorAll<HTMLElement>(".project-item").forEach((item) => {
      item.hidden = Boolean(query && !item.textContent?.toLowerCase().includes(query));
    });
  }
}

function restoreActiveToast() {
  if (!activeToast || activeToast.expiresAt <= Date.now()) return;
  const element = document.querySelector<HTMLDivElement>("#toast");
  if (!element) return;
  element.textContent = activeToast.message;
  element.className = `toast toast--visible toast--${activeToast.kind}`;
}

type OpenDialogState = {
  id: string;
  values: Array<{
    name: string;
    value: string;
    selectedValues?: string[];
    checked?: boolean;
    selectionStart?: number | null;
    selectionEnd?: number | null;
    selectionDirection?: "forward" | "backward" | "none" | null;
    scrollTop?: number;
    scrollLeft?: number;
  }>;
  focusName?: string;
};

type FocusedElementState = {
  id?: string;
  action?: string;
  task?: string;
  project?: string;
  name?: string;
  ariaLabel?: string;
  className?: string;
  preserveFocusKey?: string;
};

type ScrollPosition = {
  selector: string;
  index: number;
  top: number;
  left: number;
};

type OpenDetailsState = string[];

const scrollableSelectors = [".work-surface", ".project-rail nav", ".drawer-scroll"];

function captureOpenDialog(): OpenDialogState | undefined {
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (!dialog) return undefined;
  const values: OpenDialogState["values"] = [];
  dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]").forEach((control) => {
    const isCheckbox = control instanceof HTMLInputElement && control.type === "checkbox";
    const isMultipleSelect = control instanceof HTMLSelectElement && control.multiple;
    values.push({
      name: control.name,
      value: control.value,
      ...(isMultipleSelect ? { selectedValues: Array.from(control.selectedOptions).map((option) => option.value) } : {}),
      ...(isCheckbox ? { checked: control.checked } : {}),
      ...("selectionStart" in control ? {
        selectionStart: control.selectionStart,
        selectionEnd: control.selectionEnd,
        selectionDirection: control.selectionDirection,
      } : {}),
      scrollTop: control.scrollTop,
      scrollLeft: control.scrollLeft,
    });
  });
  const active = document.activeElement as HTMLElement | null;
  return { id: dialog.id, values, focusName: active?.getAttribute("name") || undefined };
}

function restoreOpenDialog(state?: OpenDialogState) {
  if (!state) return;
  const dialog = document.querySelector<HTMLDialogElement>(`#${CSS.escape(state.id)}`);
  if (!dialog) return;
  state.values.forEach(({ name, value, selectedValues, checked, selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft }) => {
    const control = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`);
    if (!control) return;
    if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = checked ?? value === "true";
    else if (control instanceof HTMLSelectElement && control.multiple && selectedValues) {
      Array.from(control.options).forEach((option) => { option.selected = selectedValues.includes(option.value); });
    }
    else control.value = value;
    if (selectionStart !== undefined && selectionStart !== null && selectionEnd !== undefined && selectionEnd !== null
      && "setSelectionRange" in control) {
      control.setSelectionRange(selectionStart, selectionEnd, selectionDirection || "none");
    }
    if (scrollTop !== undefined) control.scrollTop = scrollTop;
    if (scrollLeft !== undefined) control.scrollLeft = scrollLeft;
  });
  dialog.showModal();
  if (state.id === "project-dialog") {
    dialog.addEventListener("cancel", keepBusyProjectDialogOpen);
    syncProjectOnboardingUi();
    const mode = state.values.find((item) => item.name === "entryMode")?.value;
    if (mode === "blank" || mode === "import") selectProjectEntryMode(mode);
  }
  if (state.focusName) dialog.querySelector<HTMLElement>(`[name="${CSS.escape(state.focusName)}"]`)?.focus();
}

function captureFocusedElement(): FocusedElementState | undefined {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || active === document.documentElement) return undefined;
  return {
    id: active.id || undefined,
    action: active.dataset.action,
    task: active.dataset.task,
    project: active.dataset.project,
    name: active.getAttribute("name") || undefined,
    ariaLabel: active.getAttribute("aria-label") || undefined,
    className: active.className || undefined,
    preserveFocusKey: active.dataset.preserveFocusKey,
  };
}

function restoreFocusedElement(state?: FocusedElementState) {
  if (!state) return;
  let target: HTMLElement | null = state.id ? document.getElementById(state.id) : null;
  if (!target && state.action) {
    const classes = state.className
      ?.split(/\s+/)
      .filter(Boolean)
      .map((name) => `.${CSS.escape(name)}`)
      .join("") || "";
    const selector = [`[data-action="${CSS.escape(state.action)}"]${classes}`,
      state.task ? `[data-task="${CSS.escape(state.task)}"]` : "",
      state.project ? `[data-project="${CSS.escape(state.project)}"]` : "",
    ].join("");
    target = document.querySelector<HTMLElement>(selector);
  }
  if (!target && state.name) target = document.querySelector<HTMLElement>(`[name="${CSS.escape(state.name)}"]`);
  if (!target && state.ariaLabel) target = document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(state.ariaLabel)}"]`);
  if (!target && state.preserveFocusKey) target = document.querySelector<HTMLElement>(`[data-preserve-focus-key="${CSS.escape(state.preserveFocusKey)}"]`);
  target?.focus({ preventScroll: true });
}

function captureScrollPositions(): ScrollPosition[] {
  return scrollableSelectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element, index) => ({
    selector,
    index,
    top: element.scrollTop,
    left: element.scrollLeft,
  })));
}

function restoreScrollPositions(positions: ScrollPosition[]) {
  positions.forEach(({ selector, index, top, left }) => {
    const element = document.querySelectorAll<HTMLElement>(selector).item(index);
    if (!element) return;
    element.scrollTop = top;
    element.scrollLeft = left;
  });
}

function captureOpenDetails(): OpenDetailsState {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-preserve-key][open]"))
    .map((element) => element.dataset.preserveKey)
    .filter((key): key is string => Boolean(key));
}

function restoreOpenDetails(keys: OpenDetailsState) {
  keys.forEach((key) => {
    document.querySelector<HTMLDetailsElement>(`details[data-preserve-key="${CSS.escape(key)}"]`)?.setAttribute("open", "");
  });
}

function renderPreservingUi() {
  const openDialog = captureOpenDialog();
  const focusedElement = captureFocusedElement();
  const scrollPositions = captureScrollPositions();
  const openDetails = captureOpenDetails();
  const currentSearch = document.querySelector<HTMLInputElement>("#project-search")?.value;
  if (currentSearch !== undefined) projectSearchQuery = currentSearch;
  render();
  restoreScrollPositions(scrollPositions);
  restoreOpenDetails(openDetails);
  restoreOpenDialog(openDialog);
  restoreFocusedElement(focusedElement);
}

function hasActiveUserInteraction() {
  if (pointerInteractionActive) return true;
  if (scrollInteractionActive) return true;
  if (document.querySelector("dialog[open]")) return true;
  const active = document.activeElement;
  return Boolean(active && active !== document.body && active !== document.documentElement
    && active instanceof HTMLElement
    && active.matches("input, textarea, select, [contenteditable=\"true\"], [role=\"textbox\"]"));
}

function flushPendingRuntimeSnapshot() {
  if (!pendingRuntimeSnapshot || hasActiveUserInteraction()) return;
  const next = pendingRuntimeSnapshot;
  pendingRuntimeSnapshot = undefined;
  setSnapshot(next);
  renderPreservingUi();
}

function toast(message: string, kind: "ok" | "error" = "ok") {
  message = uiText(message);
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  activeToast = { message, kind, expiresAt: Date.now() + 2600 };
  const element = document.querySelector<HTMLDivElement>("#toast");
  if (!element) return;
  element.textContent = message;
  element.className = `toast toast--visible toast--${kind}`;
  toastTimer = window.setTimeout(() => {
    activeToast = undefined;
    toastTimer = undefined;
    document.querySelector<HTMLDivElement>("#toast")?.classList.remove("toast--visible");
  }, 2600);
}

async function execute<T>(operation: () => Promise<T>, success?: string, onError?: (error: unknown) => void): Promise<T | undefined> {
  if (busy) return undefined;
  busy = true;
  document.body.classList.add("is-busy");
  try {
    const result = await operation();
    if (success) toast(success);
    return result;
  } catch (error) {
    if (onError) onError(error);
    else toast(userFacingErrorMessage(error), "error");
    return undefined;
  } finally {
    busy = false;
    document.body.classList.remove("is-busy");
  }
}

function syncProjectOnboardingUi() {
  const form = document.querySelector<HTMLFormElement>("#project-form");
  const status = document.querySelector<HTMLDivElement>("#project-onboarding-status");
  if (!form || !status) return;
  const inProgress = onboardingState.status === "progress";
  const mode = form.dataset.mode;
  status.innerHTML = uiText(renderOnboardingStatus(onboardingState));
  status.hidden = onboardingState.status === "idle";
  form.setAttribute("aria-busy", String(inProgress));
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("input, button, textarea, select").forEach((control) => {
    const panel = control.closest<HTMLElement>("[data-project-mode-panel]");
    control.disabled = inProgress || Boolean(panel && panel.dataset.projectModePanel !== mode);
  });
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) {
    submit.disabled = inProgress || (mode !== "blank" && mode !== "import");
    submit.textContent = uiText(inProgress
      ? "正在处理…"
      : onboardingState.status === "error"
        ? "重新尝试"
        : onboardingState.status === "warning"
          ? "重新打开 Codex"
          : mode === "blank"
            ? "新建项目"
            : mode === "import"
              ? "开始导入"
               : "选择方式后继续");
  }
}

function openTaskDialog() {
  const dialog = document.querySelector<HTMLDialogElement>("#task-dialog");
  dialog?.showModal();
  dialog?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
}

function keepBusyProjectDialogOpen(event: Event) {
  if (onboardingState.status === "progress") event.preventDefault();
}

function openProjectDialog() {
  const dialog = document.querySelector<HTMLDialogElement>("#project-dialog");
  onboardingState = { status: "idle" };
  connectedProjectId = undefined;
  projectImportTargetId = undefined;
  projectImportSourceId = undefined;
  const form = dialog?.querySelector<HTMLFormElement>("#project-form");
  if (form) {
    form.reset();
    form.dataset.mode = "";
    const entryMode = form.querySelector<HTMLInputElement>('input[name="entryMode"]');
    if (entryMode) entryMode.value = "";
    form.querySelectorAll<HTMLButtonElement>('[data-action="select-project-mode"]').forEach((button) => button.setAttribute("aria-pressed", "false"));
    form.querySelectorAll<HTMLElement>("[data-project-mode-panel]").forEach((panel) => {
      panel.hidden = true;
      panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]").forEach((control) => { control.disabled = true; });
    });
    const hint = form.querySelector<HTMLElement>("#project-entry-hint");
    if (hint) { hint.dataset.mode = ""; hint.textContent = "选择一种方式后继续。"; }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = "选择方式后继续"; }
  }
  dialog?.addEventListener("cancel", keepBusyProjectDialogOpen);
  dialog?.showModal();
  syncProjectOnboardingUi();
  dialog?.querySelector<HTMLButtonElement>('[data-action="select-project-mode"]')?.focus();
}

function selectProjectEntryMode(mode: "blank" | "import") {
  const form = document.querySelector<HTMLFormElement>("#project-form");
  if (!form) return;
  form.dataset.mode = mode;
  const entryMode = form.querySelector<HTMLInputElement>('input[name="entryMode"]');
  if (entryMode) entryMode.value = mode;
  form.querySelectorAll<HTMLButtonElement>('[data-action="select-project-mode"]').forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.setAttribute("aria-pressed", String(selected));
  });
  form.querySelectorAll<HTMLElement>("[data-project-mode-panel]").forEach((panel) => {
    const selected = panel.dataset.projectModePanel === mode;
    panel.hidden = !selected;
    panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]").forEach((control) => {
      control.disabled = !selected;
    });
  });
  const hint = form.querySelector<HTMLElement>("#project-entry-hint");
  if (hint) {
    hint.dataset.mode = mode;
    hint.textContent = mode === "blank"
      ? "先保存项目资料；这一步不会连接 Codex。"
      : "选择一个现有的 Codex 项目，把其中的项目信息导入 Harness。";
  }
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) {
    submit.disabled = false;
    submit.textContent = mode === "blank" ? "新建项目" : "开始导入";
  }
  const focusName = mode === "blank" ? "blankName" : "importName";
  form.querySelector<HTMLInputElement>(`[name="${focusName}"]`)?.focus();
}

function resultTemplate(task: Task): CandidateResult {
  const criteria = Array.isArray(task.criteria) ? task.criteria : [];
  return {
    summary: "",
    completed: [],
    remaining: [],
    nextStep: "",
    acceptance: criteria.map((criterion) => ({ criterion, status: "pending" })),
    evidence: [{ type: "git", value: "commit hash, diff path, or test command" }],
  };
}

function openResultDialog(taskId: string) {
  const project = selectedProject();
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const dialog = document.querySelector<HTMLDialogElement>("#result-dialog");
  const idInput = dialog?.querySelector<HTMLInputElement>('input[name="taskId"]');
  const textArea = dialog?.querySelector<HTMLTextAreaElement>('textarea[name="result"]');
  if (idInput) idInput.value = task.id;
  if (textArea) textArea.value = JSON.stringify(resultTemplate(task), null, 2);
  dialog?.showModal();
  textArea?.focus();
}

document.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const close = target.closest<HTMLElement>("[data-close]");
  if (close) {
    close.closest<HTMLDialogElement>("dialog")?.close();
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const taskId = button.dataset.task;
  const sectionId = button.dataset.section;
  const sessionId = button.dataset.session;
  const archiveHash = button.dataset.hash;

  if (action === "select-project-mode" && (button.dataset.mode === "blank" || button.dataset.mode === "import")) {
    selectProjectEntryMode(button.dataset.mode);
    return;
  }

  if (action === "guide-open" || action === "guide-close") {
    const result = await execute(() => window.harness.guideUpdate({ dismissed: action === "guide-close" }));
    if (result) { setSnapshot(result); renderPreservingUi(); }
    return;
  }
  if (action === "guide-locale") {
    const result = await execute(() => window.harness.guideUpdate({ locale: snapshot.guide?.locale === "en" ? "zh-CN" : "en" }));
    if (result) { setSnapshot(result); renderPreservingUi(); }
    return;
  }
  if (action === "guide-locate") {
    const targetId = button.dataset.guideTargetRef;
    const guideTarget = targetId ? document.querySelector<HTMLElement>(`[data-guide-target="${CSS.escape(targetId)}"]`) : null;
    if (guideTarget) { guideTarget.scrollIntoView({ block: "center", behavior: "smooth" }); guideTarget.focus({ preventScroll: true }); }
    else toast("当前界面没有这个控件；请先完成前置步骤。", "error");
    return;
  }
  if (action === "guide-recheck") {
    button.disabled = true;
    let latest: Snapshot | undefined;
    try {
      for (const subject of ["codex-desktop", "codex-cli", "codex-login", "app-server"] as const) {
        activeGuideProbeSubject = subject;
        const result = await window.harness.guideProbe(subject);
        latest = result.snapshot;
        if (result.probe.errorCode === "PROBE_CANCELLED") break;
      }
      if (latest) { setSnapshot(latest); renderPreservingUi(); toast("检查完成"); }
    } catch (error) { toast(userFacingErrorMessage(error), "error"); }
    finally { activeGuideProbeSubject = undefined; button.disabled = false; }
    return;
  }
  if (action === "guide-cancel-probe") {
    if (!activeGuideProbeSubject) { toast("现在没有正在进行的检查"); return; }
    const result = await window.harness.guideCancelProbe(activeGuideProbeSubject);
    toast(result.cancelled ? "检查已停止，正在运行的任务不会受到影响" : "检查已经结束");
    return;
  }

  if (action === "open-details") {
    detailsOpen = true;
    render();
    document.querySelector<HTMLButtonElement>('.project-drawer [data-action="close-details"]')?.focus();
    return;
  }
  if (action === "close-details") {
    detailsOpen = false;
    render();
    document.querySelector<HTMLButtonElement>('[data-action="open-details"]')?.focus();
    return;
  }
  if (action === "open-codex-project") {
    const project = selectedProject();
    const result = await execute(() => window.harness.openCodexProject(project.id));
    if (result) {
      setSnapshot(result.snapshot);
      renderPreservingUi();
      toast(result.message, result.opened ? "ok" : "error");
    }
    return;
  }
  if (action === "open-cto") {
    const project = selectedProject();
    const result = await execute(() => window.harness.openCto(project.id));
    if (result) {
      setSnapshot(result.snapshot);
      renderPreservingUi();
      toast(result.message, result.opened ? "ok" : "error");
    }
    return;
  }
  if (action === "new-conversation") {
    const dialog = document.querySelector<HTMLDialogElement>("#conversation-dialog");
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    return;
  }
  if (action === "sync-codex") {
    const currentProject = selectedProject();
    const result = await execute(() => window.harness.syncCodexProject(currentProject.id));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      const refreshed = result.state.projects.find((item) => item.id === currentProject.id);
      toast(refreshed?.codexProjectSync?.state === "desktop-registered"
        ? "Codex Project 与 CTO / Review 已创建并归组"
        : refreshed?.codexProjectSync?.state === "desktop-restart-required"
          ? "官方 Project 已确认；请完全退出 Codex Desktop 后重开，再核对侧栏"
          : "Codex Project 已同步");
    }
    return;
  }
  if (action === "toggle-pin") {
    const result = await execute(() => window.harness.toggleWindowPin());
    if (result) { setSnapshot(result.snapshot); renderPreservingUi(); toast(result.alwaysOnTop ? "面板已置顶" : "已取消置顶"); }
    return;
  }
  if (action === "new-task") return openTaskDialog();
  if (action === "submit-result" && taskId) return openResultDialog(taskId);
  if (action === "open-agent" && taskId) {
    const project = selectedProject();
    const result = await execute(() => window.harness.openAgentTask(project.id, taskId));
    if (result) {
      setSnapshot(result.snapshot);
      renderPreservingUi();
      toast(result.message, result.opened ? "ok" : "error");
    }
    return;
  }
  if (action === "open-session" && sessionId) {
    const currentProject = selectedProject();
    const result = await execute(() => window.harness.openProjectSession(currentProject.id, sessionId));
    if (result) {
      setSnapshot(result.snapshot);
      renderPreservingUi();
      toast(result.message, result.opened ? "ok" : "error");
    }
    return;
  }
  if (action === "open-workspace" && taskId) {
    const currentProject = selectedProject();
    const result = await execute(() => window.harness.openTaskWorkspace(currentProject.id, taskId));
    if (result) toast(result.opened ? "已打开项目工作区；请在对应 Agent 中使用 Harness Skill" : `无法打开工作区：${result.error || "未知错误"}`, result.opened ? "ok" : "error");
    return;
  }
  if (action === "add-project") return openProjectDialog();
  if (action === "connect-codex") {
    const currentProject = selectedProject();
    const confirmed = window.confirm(uiText("要把这个项目连接到 Codex 吗？连接后，Harness 会为它准备必要的 Codex 项目和管理对话，可能会使用你的 Codex 额度。即使连接失败，当前项目也会保留。"));
    if (!confirmed) return;
    const result = await execute(() => window.harness.connectCodexProject(currentProject.id, {
      operationId: `connect:${currentProject.id}`,
      targetFingerprint: `project:${currentProject.id}`,
      confirmedAt: new Date().toISOString(),
    }));
    if (result) { setSnapshot(result.snapshot); renderPreservingUi(); toast("Codex 连接已建立"); }
    return;
  }
  if (action === "import-into-project") {
    const currentProject = selectedProject();
    openProjectDialog();
    projectImportTargetId = currentProject.id;
    projectImportSourceId = currentProject.codexProjectId;
    selectProjectEntryMode("import");
    const importName = document.querySelector<HTMLInputElement>('#project-dialog input[name="importName"]');
    if (importName) importName.value = currentProject.name;
    return;
  }
  if (action === "open-error-log") {
    await execute(() => window.harness.showErrorLog(), "已在文件夹中定位错误日志");
    return;
  }
  if (action === "select-project" && button.dataset.project) {
    const result = await execute(() => window.harness.selectProject(button.dataset.project!));
    if (result) {
      setSnapshot(result);
      detailsOpen = false;
      render();
    }
    return;
  }
  const project = selectedProject();
  if (action === "assign-section" && taskId) {
    const task = project.tasks.find((item) => item.id === taskId);
    const dialog = document.querySelector<HTMLDialogElement>("#section-assignment-dialog");
    if (!task || !dialog) return;
    const taskInput = dialog.querySelector<HTMLInputElement>('input[name="taskId"]');
    const sectionSelect = dialog.querySelector<HTMLSelectElement>('select[name="sectionId"]');
    const taskTitle = dialog.querySelector<HTMLElement>("#section-assignment-task-title");
    if (taskInput) taskInput.value = task.id;
    if (taskTitle) taskTitle.textContent = task.title;
    if (sectionSelect) sectionSelect.value = task.sectionId || "";
    dialog.showModal();
    sectionSelect?.focus();
    return;
  }
  if (action === "refresh") {
    const result = await execute(() => window.harness.refreshGit(project.id));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      toast("状态已手动刷新");
    }
    return;
  }
  if (action === "refresh-git") {
    const result = await execute(() => window.harness.refreshGit(project.id));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      toast("Git 状态已刷新");
    }
    return;
  }
  if (action === "refresh-github") {
    const result = await execute(() => window.harness.refreshGitHub(project.id));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      toast("GitHub 状态已刷新");
    }
    return;
  }
  if (action === "refresh-profile") {
    const result = await execute(() => window.harness.refreshProjectProfile(project.id));
    if (result) { setSnapshot(result); renderPreservingUi(); toast("开发环境画像已刷新"); }
    return;
  }
  if (action === "connect-github") {
    const dialog = document.querySelector<HTMLDialogElement>("#remote-dialog");
    const input = dialog?.querySelector<HTMLInputElement>('input[name="remoteUrl"]');
    if (input && project.githubSnapshot?.remote?.url) input.value = `${project.githubSnapshot.remote.url}.git`;
    dialog?.showModal();
    input?.focus();
    return;
  }
  if (action === "open-ledger") {
    const result = await execute(() => window.harness.openLedger(project.id));
    if (result) toast(result.opened ? "已打开动态项目白皮书" : `无法打开白皮书：${result.error || "未知错误"}`, result.opened ? "ok" : "error");
    return;
  }
  if (action === "open-project-path") {
    const result = await execute(() => window.harness.openProjectPath(project.id));
    if (result) toast(result.opened ? "已打开项目目录" : `无法打开项目目录：${result.error || "未知错误"}`, result.opened ? "ok" : "error");
    return;
  }
  if (action === "open-archive") {
    const result = await execute(() => window.harness.openArchive(project.id));
    if (result) toast(result.opened ? "已打开归档目录" : `无法打开归档目录：${result.error || "未知错误"}`, result.opened ? "ok" : "error");
    return;
  }
  if (action === "open-run-archive" && taskId) {
    const result = await execute(() => window.harness.openRunArchive(project.id, taskId));
    if (result) toast(result.opened ? "已打开该任务的原始运行归档" : `无法打开运行归档：${result.error || "未知错误"}`, result.opened ? "ok" : "error");
    return;
  }
  if (action === "verify-archive" && archiveHash) {
    const result = await execute(() => window.harness.verifyArchive(project.id, archiveHash));
    if (result) toast(result.valid ? `归档校验通过 · ${result.bytes.toLocaleString()} bytes` : "归档校验失败，请保留原始文件并检查磁盘", result.valid ? "ok" : "error");
    return;
  }
  if (action === "export-project") {
    const result = await execute(() => window.harness.exportProject(project.id));
    if (result) toast(result.canceled ? "已取消导出" : `项目包已导出${result.path ? `：${result.path}` : ""}`);
    return;
  }
  if (action === "import-project") {
    const result = await execute(() => window.harness.importProject());
    if (result) { setSnapshot(result.snapshot); detailsOpen = false; render(); toast(result.canceled ? "已取消导入" : "项目包已导入"); }
    return;
  }
  if (action === "import-archive") {
    const result = await execute(() => window.harness.importArchive(project.id));
    if (result) {
      setSnapshot(result.snapshot);
      renderPreservingUi();
      toast(result.canceled ? "已取消导入" : result.deduplicated ? "归档已存在，已复用内容对象" : "会话已无损归档");
    }
    return;
  }
  if (action === "archive-project") {
    const result = await execute(() => window.harness.archiveProject(project.id, "用户从项目详情归档"));
    if (result) { setSnapshot(result); detailsOpen = false; render(); toast("项目已归档，原始数据未删除"); }
    return;
  }
  if (action === "pause-project" || action === "resume-project") {
    const nextStatus = action === "pause-project" ? "paused" : "active";
    const result = await execute(() => window.harness.setProjectStatus(project.id, nextStatus));
    if (result) { setSnapshot(result); renderPreservingUi(); toast(nextStatus === "paused" ? "项目已暂停" : "项目已恢复运行"); }
    return;
  }
  if (action === "complete-objective") {
    const result = await execute(() => window.harness.setObjectiveStatus(project.id, "completed"));
    if (result) { setSnapshot(result); renderPreservingUi(); toast("Objective 已归档为完成"); }
    return;
  }
  if (action === "new-objective") {
    const dialog = document.querySelector<HTMLDialogElement>("#objective-dialog");
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    return;
  }
  if (action === "restore-project") {
    const result = await execute(() => window.harness.restoreProject(project.id));
    if (result) { setSnapshot(result); renderPreservingUi(); toast("项目已恢复"); }
    return;
  }
  if (action === "new-section") {
    const dialog = document.querySelector<HTMLDialogElement>("#section-dialog");
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    return;
  }
  if (action === "close-section" && sectionId) {
    const result = await execute(() => window.harness.closeSection(project.id, sectionId, "用户从项目详情关闭"));
    if (result) { setSnapshot(result); renderPreservingUi(); toast("Section 已关闭"); }
    return;
  }
  if (action === "archive-section" && sectionId) {
    const result = await execute(() => window.harness.archiveSection(project.id, sectionId, "用户从项目详情归档"));
    if (result) { setSnapshot(result); renderPreservingUi(); toast("Section 已归档"); }
    return;
  }
  if (action === "edit-contract") {
    const dialog = document.querySelector<HTMLDialogElement>("#contract-dialog");
    const fields: Record<string, string> = {
      projectPath: project.path || "",
      goal: project.goal || "",
      objectiveTitle: project.objective?.title || "",
      techStack: (project.techStack || []).join("\n"),
      constraints: (project.constraints || []).join("\n"),
      blockers: (project.blockers || []).join("\n"),
    };
    Object.entries(fields).forEach(([name, value]) => {
      const control = dialog?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (control) control.value = value;
    });
    const pathControl = dialog?.querySelector<HTMLInputElement>('input[name="projectPath"]');
    if (pathControl) pathControl.readOnly = project.source?.kind !== "blank";
    dialog?.showModal();
    dialog?.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.focus();
    return;
  }
  if (action === "apply-template") {
    const dialog = document.querySelector<HTMLDialogElement>("#template-dialog");
    dialog?.showModal();
    dialog?.querySelector<HTMLSelectElement>('select[name="templateId"]')?.focus();
    return;
  }
  if (action === "new-decision") {
    const dialog = document.querySelector<HTMLDialogElement>("#decision-dialog");
    dialog?.showModal();
    dialog?.querySelector<HTMLTextAreaElement>('textarea[name="title"]')?.focus();
    return;
  }
  if (action === "dispatch" && taskId) {
    const dispatchingImport = project.tasks.find((item) => item.id === taskId)?.workstream === "codex-project-import";
    const result = await execute(() => window.harness.dispatchTask(project.id, taskId));
    if (result) {
      setSnapshot(result.snapshot);
      renderPreservingUi();
      toast(dispatchingImport ? "Codex 项目回填已重新启动" : result.userActionRequired ? `${result.agent === "hermes" ? "Hermes" : "Claude Code"} 用户主动路径已准备，任务包已复制` : "任务已开始，任务包已复制");
    }
    return;
  }
  if (action === "stop-task" && taskId) {
    const result = await execute(() => window.harness.stopTask(project.id, taskId));
    if (result) { setSnapshot(result); renderPreservingUi(); toast("任务已停止，项目状态已保存"); }
    return;
  }
  if (action === "copy-packet" && taskId) {
    const result = await execute(() => window.harness.copyMissionPacket(project.id, taskId));
    if (result) toast("任务包已复制");
    return;
  }
  if (action === "accept" && taskId) {
    const acceptingImport = project.tasks.find((item) => item.id === taskId)?.workstream === "codex-project-import";
    const result = await execute(() => window.harness.acceptTaskResult(project.id, taskId));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      toast(acceptingImport ? "Codex 项目数据已审核并写入 Harness" : "结果已接受，Project HEAD 已推进");
    }
    return;
  }
  if (action === "request-changes" && taskId) {
    const revisingImport = project.tasks.find((item) => item.id === taskId)?.workstream === "codex-project-import";
    const result = await execute(() => window.harness.requestChanges(project.id, taskId));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      toast(revisingImport ? "已退回，点击任务可重新盘点 Codex Project" : "结果已退回修改");
    }
    return;
  }
  if (action === "reject" && taskId) {
    const rejectingImport = project.tasks.find((item) => item.id === taskId)?.workstream === "codex-project-import";
    const result = await execute(() => window.harness.rejectTask(project.id, taskId, "用户拒绝候选结果"));
    if (result) {
      setSnapshot(result);
      renderPreservingUi();
      toast(rejectingImport ? "导入候选已拒绝，原始 rollout 仍保留在归档" : "候选结果已拒绝，原始结果仍保留在项目归档");
    }
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const project = selectedProject();
  if (form.id === "project-form") {
    const data = new FormData(form);
    const mode = String(data.get("entryMode") || form.dataset.mode || "");
    if (mode !== "blank" && mode !== "import") {
      toast("请先选择“新建项目”或“从 Codex 导入”", "error");
      return;
    }
    if (mode === "blank") {
      const blankName = String(data.get("blankName") || "").trim();
      if (!blankName) { toast("请填写项目名称", "error"); return; }
      onboardingState = progressOnboardingState({ stage: "creating_project", progress: 40, label: "正在新建项目" });
      syncProjectOnboardingUi();
      const operationId = crypto.randomUUID();
      const result = await execute(() => window.harness.createBlankProject({
          name: blankName,
          path: String(data.get("blankPath") || "").trim(),
          goal: String(data.get("blankGoal") || "").trim(),
          techStack: String(data.get("blankTechStack") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          constraints: String(data.get("blankConstraints") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          operationId,
          targetFingerprint: `blank:${blankName.normalize("NFKC").toLowerCase()}:${operationId}`,
          confirmedAt: new Date().toISOString(),
        }), undefined, (error) => {
        onboardingState = failedOnboardingState(error);
        syncProjectOnboardingUi();
      });
      if (result) {
        onboardingState = { status: "completed" };
        setSnapshot(result.snapshot);
        form.closest<HTMLDialogElement>("dialog")?.close();
        form.reset();
        detailsOpen = false;
        render();
        toast("本地项目已创建；没有搜索历史或连接 Agent");
      }
      return;
    }
    const projectName = String(data.get("importName") || "").trim();
    if (!projectName) { toast("请填写 Codex 项目名称或简称", "error"); return; }
    onboardingState = progressOnboardingState({ stage: "starting", progress: 4, label: "正在准备…" });
    syncProjectOnboardingUi();
    const result = await execute(
      () => window.harness.importCodexProject({ name: projectName, ...(projectImportTargetId ? { targetProjectId: projectImportTargetId } : {}), ...(projectImportSourceId ? { codexProjectId: projectImportSourceId } : {}) }),
      undefined,
      (error) => {
        onboardingState = failedOnboardingState(error);
        syncProjectOnboardingUi();
      },
    );
    if (result) {
      setSnapshot(result.snapshot);
      onboardingState = completedOnboardingState(result);
      if (onboardingState.status === "warning") {
        syncProjectOnboardingUi();
        form.closest<HTMLDialogElement>("dialog")?.addEventListener("close", () => {
          detailsOpen = false;
          render();
        }, { once: true });
        return;
      }
      form.closest<HTMLDialogElement>("dialog")?.close();
      form.reset();
      projectImportTargetId = undefined;
      projectImportSourceId = undefined;
      detailsOpen = false;
      render();
      toast(`已定位 ${result.matchedProjectName || projectName}，Codex 项目回填已启动，完成后等待审核`);
    }
    return;
  }
  if (form.id === "task-form") {
    const data = new FormData(form);
    const dependencyIds = data.getAll("dependsOn")
      .map((value) => String(value))
      .filter((id) => project.tasks.some((task) => task.id === id))
      .slice(0, 20);
    const result = await execute(() => window.harness.createTask(project.id, {
      title: data.get("title"),
      workstream: data.get("workstream"),
      criteria: data.get("criteria"),
      agent: data.get("agent"),
      sessionPolicy: data.get("sessionPolicy"),
      sectionId: data.get("sectionId"),
      dependsOn: dependencyIds,
      reviewMode: data.get("reviewMode"),
      priority: data.get("priority"),
    }));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      renderPreservingUi();
      toast("任务已创建；尚未注入 Agent，请点击“开始任务”");
    }
  }
  if (form.id === "section-assignment-form") {
    const data = new FormData(form);
    const taskId = String(data.get("taskId") || "");
    const sectionId = String(data.get("sectionId") || "");
    if (!taskId || !sectionId) {
      toast("请选择目标 Section", "error");
      return;
    }
    const result = await execute(() => window.harness.assignTaskToSection(project.id, taskId, sectionId));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      renderPreservingUi();
      toast("任务已改派到 Section");
    }
    return;
  }
  if (form.id === "section-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.createSection(project.id, {
      name: data.get("name"),
      kind: data.get("kind"),
      agent: data.get("agent"),
      approvalMode: data.get("approvalMode"),
    }));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      form.reset();
      renderPreservingUi();
      toast("Section 已创建");
    }
  }
  if (form.id === "contract-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.updateProjectContract(project.id, {
      path: data.get("projectPath"),
      goal: data.get("goal"),
      objectiveTitle: data.get("objectiveTitle"),
      techStack: data.get("techStack"),
      constraints: data.get("constraints"),
      blockers: data.get("blockers"),
    }));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      renderPreservingUi();
      toast("项目契约已保存");
    }
    return;
  }
  if (form.id === "remote-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.setGitRemote(project.id, String(data.get("remoteUrl") || ""), String(data.get("remoteName") || "origin")));
    if (result) {
      setSnapshot(result.snapshot);
      form.closest<HTMLDialogElement>("dialog")?.close();
      renderPreservingUi();
      toast("GitHub 远端已保存");
    }
    return;
  }
  if (form.id === "template-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.applyTemplate(project.id, String(data.get("templateId") || "blank")));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      renderPreservingUi();
      toast("项目模板已应用");
    }
    return;
  }
  if (form.id === "decision-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.addDecision(project.id, { title: data.get("title"), rationale: data.get("rationale"), source: "user" }));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      form.reset();
      renderPreservingUi();
      toast("决策已记录");
    }
    return;
  }
  if (form.id === "conversation-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.newProjectConversation(project.id, {
      title: String(data.get("title") || ""),
      type: String(data.get("type") || "warm") === "disposable" ? "disposable" : "warm",
      agent: ["claude", "hermes"].includes(String(data.get("agent"))) ? String(data.get("agent")) as "claude" | "hermes" : "codex",
    }));
    if (result) {
      setSnapshot(result.snapshot);
      form.closest<HTMLDialogElement>("dialog")?.close();
      form.reset();
      renderPreservingUi();
      toast(result.opened ? "项目新对话已打开" : "项目新对话已创建，请稍后重试打开", result.opened ? "ok" : "error");
    }
    return;
  }
  if (form.id === "objective-form") {
    const data = new FormData(form);
    const result = await execute(() => window.harness.createObjective(project.id, {
      title: String(data.get("title") || ""),
      supersede: Boolean(data.get("supersede")),
    }));
    if (result) {
      setSnapshot(result);
      form.closest<HTMLDialogElement>("dialog")?.close();
      form.reset();
      renderPreservingUi();
      toast("Objective 已切换，旧目标保留在历史中");
    }
    return;
  }
  if (form.id === "result-form") {
    const data = new FormData(form);
    const taskId = String(data.get("taskId") || "");
    try {
      const payload = JSON.parse(String(data.get("result") || "{}")) as CandidateResult;
      const result = await execute(() => window.harness.submitTaskResult(project.id, taskId, payload));
      if (result) {
        setSnapshot(result);
        form.closest<HTMLDialogElement>("dialog")?.close();
        renderPreservingUi();
        toast("候选结果已送交审核");
      }
    } catch (error) {
      toast(`结果 JSON 无效 · ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id !== "project-search") return;
  projectSearchQuery = target.value;
  const query = target.value.normalize("NFKC").trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(".project-item").forEach((item) => {
    item.hidden = Boolean(query && !item.textContent?.toLowerCase().includes(query));
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && detailsOpen) {
    event.preventDefault();
    detailsOpen = false;
    render();
    document.querySelector<HTMLButtonElement>('[data-action="open-details"]')?.focus();
    return;
  }
  if (event.key.toLowerCase() === "n" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    openTaskDialog();
  }
});

window.harness.onProjectOnboardingProgress((progress) => {
  onboardingState = progressOnboardingState(progress);
  syncProjectOnboardingUi();
});

window.harness.onAgentRuntimeUpdate((update) => {
  if (!update?.snapshot) return;
  if (hasActiveUserInteraction()) {
    pendingRuntimeSnapshot = update.snapshot;
    return;
  }
  setSnapshot(update.snapshot);
  renderPreservingUi();
});

let lastArchiveToastAt = 0;
window.harness.onArchiveProgress?.((progress) => {
  const now = Date.now();
  if (!progress.done && now - lastArchiveToastAt < 1000) return;
  lastArchiveToastAt = now;
  const label = progress.done ? "会话归档完成" : `正在归档 ${progress.source || "会话"} · ${Math.round((progress.bytes || 0) / 1024 / 1024 * 10) / 10} MB`;
  toast(label);
});

document.addEventListener("focusout", () => queueMicrotask(flushPendingRuntimeSnapshot), true);
document.addEventListener("close", () => queueMicrotask(flushPendingRuntimeSnapshot), true);
document.addEventListener("pointerdown", () => { pointerInteractionActive = true; }, true);
document.addEventListener("pointerup", () => {
  pointerInteractionActive = false;
  window.setTimeout(flushPendingRuntimeSnapshot, 0);
}, true);
document.addEventListener("pointercancel", () => {
  pointerInteractionActive = false;
  window.setTimeout(flushPendingRuntimeSnapshot, 0);
}, true);
document.addEventListener("scroll", () => {
  scrollInteractionActive = true;
  if (scrollInteractionTimer) window.clearTimeout(scrollInteractionTimer);
  scrollInteractionTimer = window.setTimeout(() => {
    scrollInteractionTimer = undefined;
    scrollInteractionActive = false;
    flushPendingRuntimeSnapshot();
  }, 180);
}, true);

function rendererErrorDetails(error: unknown, stage: string) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return { message: normalized.message, stack: normalized.stack, stage };
}

window.addEventListener("error", (event) => {
  void window.harness.reportRendererError(rendererErrorDetails(event.error || event.message, "window.error")).catch(() => {});
});

window.addEventListener("unhandledrejection", (event) => {
  void window.harness.reportRendererError(rendererErrorDetails(event.reason, "unhandledrejection")).catch(() => {});
});

window.harness.snapshot()
  .then((initial) => {
    setSnapshot(initial);
    render();
  })
  .catch(async (error) => {
    const details = userFacingErrorDetails(error);
    let errorId = details.errorId;
    try {
      const reported = await window.harness.reportRendererError(rendererErrorDetails(error, "boot"));
      errorId ||= reported.errorId;
    } catch {
      // The diagnostics bridge itself is unavailable; keep the original boot error visible.
    }
    root.innerHTML = `<main class="fatal-empty"><h1>启动失败</h1><p>${escapeOnboardingHtml(details.message)}</p>${errorId ? `<code>${escapeOnboardingHtml(errorId)}</code>` : ""}<button class="action action--quiet" data-action="open-error-log">打开错误日志</button></main>`;
  });
