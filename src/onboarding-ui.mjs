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
    progress: Math.max(0, Math.min(100, Number(progress?.progress) || 0)),
    label: String(progress?.label || "正在准备…"),
    detail: progress?.detail ? String(progress.detail) : "",
  };
}

export function completedOnboardingState(result) {
  if (result?.desktopOpened === false) {
    return {
      status: "warning",
      message: String(result.desktopWarning?.message || "项目已经准备好，但 Codex 没有自动打开。你可以再试一次。"),
      errorId: result.desktopWarning?.errorId ? String(result.desktopWarning.errorId) : undefined,
    };
  }
  if (result?.desktopProjectRestartRequired) {
    return {
      status: "notice",
      kind: "project-restart",
      message: String(result.desktopProjectWarning || "连接已经完成。请彻底退出 Codex Desktop 后重新打开，确认项目出现在侧栏。"),
    };
  }
  return { status: "completed" };
}

export function renderOnboardingStatus(state) {
  if (!state || state.status === "idle") return "";
  if (state.status === "progress") {
    return `<section class="onboarding-feedback onboarding-feedback--progress" aria-live="polite">
      <div class="onboarding-feedback__heading"><strong>${escapeHtml(state.label)}</strong><span>${state.progress}%</span></div>
      <div class="onboarding-progress" role="progressbar" aria-label="${escapeHtml(state.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${state.progress}"><i style="width:${state.progress}%"></i></div>
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
      <span class="onboarding-feedback__kicker">${notice ? "已经连接，请重新打开 Codex" : "已经连接，但 Codex 没有打开"}</span>
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
