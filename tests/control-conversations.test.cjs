const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HarnessStore } = require('../electron/store.cjs');
const machine = require('../electron/state-machine.cjs');
const { createStandardControlOpener, needsProjectInitialization } = require('../electron/control-conversations.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-controls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
  const store = new HarnessStore(path.join(root, 'state.json'), workspace, { initialStateMode: 'empty', contextRoot: root });
  const project = store.update(state => machine.createBlankProject(state, { name: 'Controls', path: workspace }));
  return { root, workspace, store, project };
}

test('standard requests carry separate persisted contexts and deduplicate concurrent/restarted requests', async t => {
  const { store, project } = fixture(t); const urls = [];
  const open = createStandardControlOpener({ store, openExternal: async uri => urls.push(new URL(uri)) });
  await Promise.all([open(project.id), open(project.id)]);
  assert.equal(urls.length, 2);
  assert.match(urls[0].searchParams.get('prompt'), /SESSION_ROLE: review/);
  assert.match(urls[1].searchParams.get('prompt'), /SESSION_ROLE: cto/);
  assert.ok(urls[0].searchParams.get('prompt').includes(store.state.projects[0].contextPackets.review.path));
  await createStandardControlOpener({ store, openExternal: async uri => urls.push(new URL(uri)) })(project.id);
  assert.equal(urls.length, 2);
  assert.ok(store.state.projects[0].sessions.every(s => s.externalThreadStatus === 'pending'));
});

test('partial Desktop failure retries only the failed role, and force opens a bound id', async t => {
  const { store, project } = fixture(t); const urls = []; let fail = true;
  const open = createStandardControlOpener({ store, openExternal: async uri => {
    urls.push(new URL(uri)); if (fail && new URL(uri).searchParams.get('prompt')?.includes('SESSION_ROLE: review')) throw Error('protocol failed');
  } });
  const first = await open(project.id);
  assert.equal(first.opened[0].opened, false); assert.equal(first.opened[1].opened, true);
  fail = false; await open(project.id); assert.equal(urls.length, 3);
  store.update(state => machine.attachControlSessionThread(state, project.id, 'review', { threadId: 'existing-review' }));
  await open(project.id, { roles: ['review'], force: true });
  assert.equal(urls.at(-1).pathname, '/existing-review');
  assert.equal(store.state.projects[0].sessions.find(s => s.role === 'review').externalThreadStatus, 'bound');
});

test('nonempty workspace waits for accepted initialization and written context', async t => {
  const { store, project, workspace } = fixture(t); const urls = [];
  fs.writeFileSync(path.join(workspace, 'README.md'), 'existing project');
  assert.equal(needsProjectInitialization(store.state.projects[0]), true);
  const open = createStandardControlOpener({ store, openExternal: async uri => urls.push(uri) });
  assert.equal((await open(project.id)).skipped, 'initialization-required');
  const task = store.update(state => machine.createAndDispatchOnboarding(state, project.id, { userInvoked: true })).task;
  store.update(state => machine.submitTaskResult(state, project.id, task.id, { summary: 'Project scanned', evidence: [{ type: 'file', value: path.join(workspace, 'README.md') }] }));
  assert.equal((await open(project.id)).skipped, 'initialization-required');
  store.update(state => machine.acceptTaskResult(state, project.id, task.id));
  await open(project.id); assert.equal(urls.length, 2);
});

test('missing path, inactive project and missing context cannot report successful creation', async t => {
  const { store, project } = fixture(t); let count = 0;
  const open = createStandardControlOpener({ store, openExternal: async () => { count++; } });
  store.update(state => { state.projects[0].status = 'archived'; });
  assert.equal((await open(project.id)).skipped, 'project-inactive');
  store.update(state => { state.projects[0].status = 'active'; });
  store.state.projects[0].contextPackets.review.path = path.join(store.contextRoot, 'missing.md');
  const result = await open(project.id, { roles: ['review'] });
  assert.equal(result.opened[0].opened, false); assert.equal(count, 0);
  store.update(state => { state.projects[0].path = ''; });
  assert.equal((await open(project.id)).skipped, 'project-path-missing');
});
