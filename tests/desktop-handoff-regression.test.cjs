const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const machine = require('../electron/state-machine.cjs');
const { HarnessStore } = require('../electron/store.cjs');
const { openCodexDesktop } = require('../electron/codex-adapter.cjs');
const { createProjectOnboarding } = require('../electron/project-onboarding.cjs');

test('new Desktop draft carries its exact role prompt without claiming a created thread', async () => {
  const prompt = 'Review · 项目审核\n读取 E:\\项目 & 文档\\review-context.md';
  let url;
  const result = await openCodexDesktop('', 'E:\\项目 & 文档', { prompt, openExternal: async value => { url = new URL(value); } });
  assert.equal(url.searchParams.get('prompt'), prompt);
  assert.equal(result.verified, false);
  assert.equal(result.threadId, undefined);
});

test('onboarding uses one awaiting-user run, copies that run and survives retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-onboard-regression-'));
  try {
    const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
    const store = new HarnessStore(path.join(root, 'state.json'), workspace, { initialStateMode: 'empty', contextRoot: root });
    const prompts = []; const requests = [];
    const onboard = createProjectOnboarding({ store, getCodex: async () => ({ installed: true, native: true }),
      resolveProject: () => ({ path: workspace, name: 'fixture' }), skillPath: __filename,
      copyPrompt: p => prompts.push(p), buildSnapshot: async () => ({ state: store.state }),
      ensureProjectFolder: async () => ({ opened: true }),
      openDesktop: async (_e, _p, options) => { requests.push(options); return { opened: true }; },
    });
    const first = await onboard('fixture'); const runId = first.snapshot.state.projects[0].tasks[0].run.id;
    const second = await onboard('fixture');
    const project = store.state.projects[0];
    assert.equal(project.tasks.length, 1);
    assert.equal(project.tasks[0].run.id, runId);
    assert.equal(project.tasks[0].run.status, 'awaiting_user');
    assert.equal(first.taskId, second.taskId);
    assert.ok(prompts[0].includes(runId));
    assert.equal(requests[0].prompt, prompts[0]);
    assert.equal(project.tasks[0].run.userPrompt, prompts[0]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unverified control id does not become ready or silently change its project', () => {
  const state = machine.createInitialState('C:\\fixture'); const project = state.projects[0];
  project.codexProjectId = 'desktop-project';
  const session = machine.attachControlSessionThread(state, project.id, 'review', { threadId: 'thread-a', projectId: 'desktop-project' });
  assert.equal(session.externalThreadStatus, 'bound');
  assert.throws(() => machine.attachControlSessionThread(state, project.id, 'review', { threadId: 'thread-a', projectId: 'wrong-project' }), /PROJECT_MISMATCH/);
  assert.throws(() => machine.attachControlSessionThread(state, project.id, 'cto', { threadId: 'thread-a', projectId: 'desktop-project' }), /THREAD_ALREADY_BOUND/);
  assert.throws(() => machine.attachControlSessionThread(state, project.id, 'review', { threadId: 'thread-b', expectedThreadId: 'stale' }), /REBIND_REQUIRED/);
  machine.attachControlSessionThread(state, project.id, 'review', { threadId: 'thread-b', expectedThreadId: 'thread-a' });
  const events = project.events.length;
  machine.attachControlSessionThread(state, project.id, 'review', { threadId: 'thread-b', expectedThreadId: 'thread-a' });
  assert.equal(project.events.length, events);
  assert.equal(session.externalThreadId, 'thread-b');
  assert.equal(session.externalThreadStatus, 'bound');
});

test('old false-ready sessions migrate without losing ids or manufacturing evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-control-migration-'));
  try {
    const file = path.join(root, 'state.json');
    const first = new HarnessStore(file, root);
    first.update(state => {
      const cto = state.projects[0].sessions.find(s => s.role === 'cto');
      cto.externalThreadStatus = 'ready'; cto.lastOpenedAt = '2026-10-24T10:00:00Z';
      const review = state.projects[0].sessions.find(s => s.role === 'review');
      review.externalThreadStatus = 'ready'; review.externalThreadId = 'legacy-review';
    });
    const second = new HarnessStore(file, root);
    const sessions = second.state.projects[0].sessions;
    assert.equal(sessions.find(s => s.role === 'cto').externalThreadStatus, 'pending');
    assert.equal(sessions.find(s => s.role === 'cto').lastOpenedAt, undefined);
    assert.equal(sessions.find(s => s.role === 'review').externalThreadStatus, 'bound');
    assert.equal(sessions.find(s => s.role === 'review').externalThreadId, 'legacy-review');
    const before = fs.readFileSync(file, 'utf8'); new HarnessStore(file, root);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
