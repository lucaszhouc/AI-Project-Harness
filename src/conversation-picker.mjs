function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function renderConversationPickerLoading() {
  return '<div class="conversation-picker-state" role="status"><strong>正在读取未归档对话…</strong><small>只读取 Codex 的会话索引，不会打开正文。</small></div>';
}

export function renderConversationPickerError(error) {
  const message = error instanceof Error ? error.message : String(error || "读取失败");
  return `<div class="conversation-picker-state conversation-picker-state--error" role="alert"><strong>暂时没读到对话</strong><small>${escapeHtml(message)}</small><button type="button" class="text-action" data-action="reload-conversation-index">重新读取</button></div>`;
}

export function renderConversationPicker(index) {
  const groups = Array.isArray(index?.groups) ? index.groups : [];
  if (!groups.length || !Number(index?.total || 0)) {
    return '<div class="conversation-picker-state"><strong>没有找到可选择的未归档对话</strong><small>Codex 中出现新的本地对话后，可以回来重新读取。</small></div>';
  }
  return groups.map((group) => {
    const items = Array.isArray(group?.items) ? group.items : [];
    if (!items.length) return "";
    const rows = items.map((entry) => {
      const selectable = entry?.selectable !== false;
      return `<label class="conversation-choice${selectable ? "" : " conversation-choice--disabled"}"><input type="checkbox" name="threadIds" value="${escapeHtml(entry?.id)}"${selectable ? "" : " disabled"}/><span class="conversation-choice__check" aria-hidden="true"></span><span class="conversation-choice__copy"><strong>${escapeHtml(entry?.title || "未命名对话")}</strong>${entry?.preview ? `<small>${escapeHtml(entry.preview)}</small>` : ""}<i>${escapeHtml(formatTime(entry?.recencyAt || entry?.updatedAt || entry?.createdAt))}${selectable ? "" : " · 本地记录不可读取"}</i></span></label>`;
    }).join("");
    return `<section class="conversation-group" data-conversation-group="${escapeHtml(group?.kind || "loose")}"><header><span>${escapeHtml(group?.label || "其他")}</span><b>${items.length}</b></header><div class="conversation-group__items">${rows}</div></section>`;
  }).join("");
}
