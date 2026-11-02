import { userFacingErrorDetails } from "./ipc-error-message.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function progressOnboardingState(progress) {
  return {
    status: "progress",
    stage: String(progress?.stage || "starting"),
    label: String(progress?.label || "正在准备…"),
    detail: progress?.detail ? String(progress.detail) : "",
  };
}

export function completedOnboardingState(result) {
  if (result?.blankOnly) {
    return {
      status: "completed",
      message: result?.desktopOpened === false ? "项目已创建，但 Desktop 原生项目入口没有打开。" : "项目已创建，请在 Desktop 原生项目入口中继续。",
    };
  }
  if (result?.desktopOpened === false) {
    return {
      status: "warning",
      message: String(result.desktopWarning?.message || "项目已经准备好，但 Codex 没有自动打开。你可以再试一次。"),
      errorId: result.desktopWarning?.errorId ? String(result.desktopWarning.errorId) : undefined,
    };
  }
  if (result?.userActionRequired) {
    if (result?.selectedThreadCount !== undefined) {
      return {
        status: "notice",
        kind: "user-action",
        message: "整理对话已经打开。默认整理任务和用户追加要求已准备好，请发送已复制的整理指令；完成后 Harness 会等待审核并写入项目知识包。",
      };
    }
    return {
      status: "notice",
      kind: "user-action",
      message: "原生 Codex 对话已经打开。请把已复制的任务包粘贴进去并发送；Harness 不会启动第二个隐藏执行器。",
    };
  }
  if (result?.desktopProjectRestartRequired) {
    return {
      status: "notice",
      kind: "project-restart",
      message: String(result.desktopProjectWarning || "连接已经完成。请在现有 Codex Desktop 窗口刷新或手动核对侧栏。"),
    };
  }
  return { status: "completed" };
}

export function renderOnboardingStatus(state) {
  if (!state || state.status === "idle") return "";
  if (state.status === "progress") {
    return `<section class="onboarding-feedback onboarding-feedback--progress" aria-live="polite">
      <div class="onboarding-feedback__heading"><strong>${escapeHtml(state.label)}</strong><span>正在处理 · 总量未知</span></div>
      ${state.detail ? `<p>${escapeHtml(state.detail)}</p>` : ""}
    </section>`;
  }
  if (state.status === "error") {
    return `<section class="onboarding-feedback onboarding-feedback--error" role="alert">
      <span class="onboarding-feedback__kicker">这一步没完成</span>
      <strong>${escapeHtml(state.message)}</strong>
      <div class="onboarding-error-meta">
        ${state.errorId ? `<code>${escapeHtml(state.errorId)}</code>` : ""}
        <button type="button" class="text-action" data-action="open-error-log">打开错误日志</button>
      </div>
    </section>`;
  }
  if (state.status === "warning" || state.status === "notice") {
    const notice = state.status === "notice";
    return `<section class="onboarding-feedback ${notice ? "onboarding-feedback--notice" : "onboarding-feedback--error"}" role="${notice ? "status" : "alert"}">
      <span class="onboarding-feedback__kicker">${notice ? "已经连接，侧栏待核对" : "已经连接，但 Codex 没有打开"}</span>
      <strong>${escapeHtml(state.message)}</strong>
      ${notice ? "" : `<div class="onboarding-error-meta">
        ${state.errorId ? `<code>${escapeHtml(state.errorId)}</code>` : ""}
        <button type="button" class="text-action" data-action="open-error-log">打开错误日志</button>
      </div>`}
    </section>`;
  }
  return "";
}

export function failedOnboardingState(error) {
  const details = userFacingErrorDetails(error);
  return { status: "error", ...details };
}

export { escapeHtml as escapeOnboardingHtml };
