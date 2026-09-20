export const COPY_VERSION = 1;

export const COPY = Object.freeze({
  "guide.title": { "zh-CN": "小助手", en: "Getting started" },
  "guide.open": { "zh-CN": "小助手", en: "Getting started" },
  "guide.close": { "zh-CN": "关闭小助手", en: "Close guide" },
  "guide.createBlank": { "zh-CN": "新建项目", en: "Create blank project" },
  "guide.importRegistered": { "zh-CN": "从 Codex 导入", en: "Import a registered Codex project" },
  "guide.recheck": { "zh-CN": "再检查一下", en: "Check again" },
  "guide.connect": { "zh-CN": "连接 Codex", en: "Connect Codex" },
  "guide.dispatch": { "zh-CN": "开始任务", en: "Dispatch task" },
  "guide.skip": { "zh-CN": "稍后处理", en: "Do this later" },
  "guide.locate": { "zh-CN": "带我去", en: "Show me where" },
  "guide.unknown": { "zh-CN": "还没检查", en: "Not checked" },
  "guide.checking": { "zh-CN": "正在看看", en: "Checking" },
  "guide.verified": { "zh-CN": "可以啦", en: "Verified" },
  "guide.needsAction": { "zh-CN": "需要你处理一下", en: "Needs your action" },
  "review.accept": { "zh-CN": "接受结果并更新项目", en: "Accept and advance HEAD" },
  "review.reject": { "zh-CN": "拒绝结果", en: "Reject result" },
  "review.requestChanges": { "zh-CN": "退回修改", en: "Request changes" },
});

export function getCopy(locale, key) {
  const entry = COPY[key];
  if (!entry) return key;
  return entry[locale === "en" ? "en" : "zh-CN"];
}

export function validateCopyParity(copy = COPY) {
  const failures = [];
  for (const [key, entry] of Object.entries(copy)) {
    if (!entry || typeof entry["zh-CN"] !== "string" || !entry["zh-CN"].trim()) failures.push(`${key}:zh-CN`);
    if (!entry || typeof entry.en !== "string" || !entry.en.trim()) failures.push(`${key}:en`);
  }
  return failures;
}

export const CONTROL_REGISTRY = Object.freeze({
  "project.create-blank": { guideTarget: "project-create-blank", labels: COPY["guide.createBlank"], consequence: "local-write", successEvidence: "local projectId + revision + source=blank" },
  "project.import-registered": { guideTarget: "project-import-registered", labels: COPY["guide.importRegistered"], consequence: "confirmed-external-read", successEvidence: "selected Codex Project evidence + import taskId" },
  "project.connect": { guideTarget: "project-connect-codex", labels: COPY["guide.connect"], consequence: "confirmed-external-write", successEvidence: "operationId + official Project/control-thread receipts" },
  "task.dispatch": { guideTarget: "task-dispatch", labels: COPY["guide.dispatch"], consequence: "confirmed-agent-turn", successEvidence: "runId + dispatch event" },
  "review.accept": { guideTarget: "review-accept", labels: COPY["review.accept"], consequence: "advance-harness-head", successEvidence: "accepted checkpoint + incremented revision" },
  "review.reject": { guideTarget: "review-reject", labels: COPY["review.reject"], consequence: "harness-state-only", successEvidence: "rejected candidate + unchanged revision" },
});
