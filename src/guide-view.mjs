import { getCopy } from "./guide-copy.mjs";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

const ACTION_COPY_KEYS = Object.freeze({
  "project.create-blank": "guide.createBlank",
  "project.import-registered": "guide.importRegistered",
  "project.connect": "guide.connect",
  "project.restore": "guide.needsAction",
  "task.create": "guide.needsAction",
  "task.dispatch": "guide.dispatch",
  "task.view-status": "guide.needsAction",
  "review.open": "guide.needsAction",
});

function statusLabel(locale, status) {
  if (status === "checking") return getCopy(locale, "guide.checking");
  if (status === "ok") return getCopy(locale, "guide.verified");
  if (["missing", "unauth", "unsupported", "error", "stale"].includes(status)) return getCopy(locale, "guide.needsAction");
  return getCopy(locale, "guide.unknown");
}

export function renderGuide(guide = {}, recommendation = {}) {
  const locale = guide.locale === "en" ? "en" : "zh-CN";
  const actionLabel = getCopy(locale, ACTION_COPY_KEYS[recommendation.actionId] || "guide.needsAction");
  if (guide.dismissed) {
    return `<aside class="getting-started getting-started--collapsed" aria-label="${escapeHtml(getCopy(locale, "guide.title"))}"><button type="button" class="guide-collapsed" data-action="guide-open"><span>${escapeHtml(getCopy(locale, "guide.open"))}</span><strong>${escapeHtml(actionLabel)}</strong></button></aside>`;
  }
  const probes = Object.values(guide.probes || {}).slice(0, 4);
  const probeHtml = probes.map((probe) => `<li><span>${escapeHtml(statusLabel(locale, probe.status))}</span><small>${escapeHtml(probe.safeSummary || probe.subject || "")}</small></li>`).join("");
  const reason = locale === "en"
    ? recommendation.reasonKey === "no-project" ? "Create a local project first. Connecting Codex remains optional." : "This recommendation follows the current persisted state."
    : recommendation.reasonKey === "no-project" ? "先建个项目吧。之后要不要连接 Codex，都由你决定。" : "我会看着当前状态，告诉你下一步怎么做。";
  return `<aside class="getting-started" aria-labelledby="guide-title" data-guide-session="${escapeHtml(guide.sessionId || "")}">
    <header><div><span>${escapeHtml(locale === "en" ? "CURRENT STEP" : "我来带路")}</span><h2 id="guide-title">${escapeHtml(getCopy(locale, "guide.title"))}</h2></div><div class="guide-header-actions"><button type="button" data-action="guide-locale" aria-label="${locale === "en" ? "切换到中文" : "Switch to English"}">${locale === "en" ? "中文" : "EN"}</button><button type="button" data-action="guide-close" aria-label="${escapeHtml(getCopy(locale, "guide.close"))}">×</button></div></header>
    <div class="guide-live" role="status" aria-live="polite"><strong>${escapeHtml(actionLabel)}</strong><p>${escapeHtml(reason)}</p></div>
    ${probeHtml ? `<ul class="guide-probes">${probeHtml}</ul>` : ""}
    <div class="guide-actions"><button type="button" class="action action--accept guide-primary" data-action="guide-locate" data-guide-target-ref="${escapeHtml(recommendation.guideTarget || "")}">${escapeHtml(getCopy(locale, "guide.locate"))}</button><button type="button" class="action action--quiet" data-action="guide-recheck">${escapeHtml(getCopy(locale, "guide.recheck"))}</button><button type="button" class="text-action guide-cancel" data-action="guide-cancel-probe">${escapeHtml(locale === "en" ? "Cancel check" : "先停一下")}</button></div>
  </aside>`;
}
