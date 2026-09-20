const test = require("node:test");
const assert = require("node:assert/strict");

const { renderGuide } = require("../src/guide-view.mjs");

test("guide is non-modal, bilingual, accessible and anchored to real targets", () => {
  const html = renderGuide({ locale: "zh-CN", dismissed: false, sessionId: "g1", probes: { "codex-cli": { status: "missing", safeSummary: "未检测到 Codex" } } }, { stepId: "project", actionId: "project.create-blank", guideTarget: "project-create-blank", reasonKey: "no-project" });
  assert.match(html, /<aside[^>]+class="getting-started"/);
  assert.match(html, /aria-labelledby="guide-title"/);
  assert.match(html, /data-guide-target-ref="project-create-blank"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /新建项目/);
  assert.match(html, /先建个项目吧/);
  assert.doesNotMatch(html, /事务|当前持久状态|不以点击冒充完成/);
  assert.doesNotMatch(html, /FAQ|textarea|guide-question|semantic/i);
  assert.doesNotMatch(html, /<dialog/);
});

test("collapsed guide remains reopenable and English copy matches actions", () => {
  const html = renderGuide({ locale: "en", dismissed: true, sessionId: "g1", probes: {} }, { stepId: "task", actionId: "task.dispatch", guideTarget: "task-dispatch" });
  assert.match(html, /Getting started/);
  assert.match(html, /data-action="guide-open"/);
  assert.match(html, /Dispatch task/);
});
