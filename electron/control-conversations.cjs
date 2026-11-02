const fs = require('node:fs');
const machine = require('./state-machine.cjs');
const { openCodexDesktop } = require('./codex-adapter.cjs');

function needsProjectInitialization(project) {
  if (!project.path) return false;
  const onboarding = (project.tasks || []).filter(task => task.workstream === 'project-onboarding');
  if (onboarding.some(task => task.status !== 'accepted')) return true;
  if (onboarding.some(task => task.status === 'accepted')) return false;
  return fs.readdirSync(project.path).some(name => !['.git', '.gitkeep', '.DS_Store', 'desktop.ini', 'Thumbs.db'].includes(name));
}

function controlPrompt(project, role, packetPath) {
  if (!packetPath || !fs.existsSync(packetPath)) throw new Error(`${role} 上下文文件尚未写入`);
  return [`${project.name} · ${role === 'cto' ? 'CTO · 项目核心' : 'Review · 项目审核'}`,
    `HARNESS_PROJECT_ID: ${project.id}`, `SESSION_ROLE: ${role}`,
    `请读取项目上下文文件：${packetPath}`, '按该文件中的角色职责继续。'].join('\n');
}

function createStandardControlOpener({ store, openExternal, copyPrompt, openDesktop = openCodexDesktop }) {
  const inflight = new Map();
  return function openControls(projectId, { roles = ['review', 'cto'], force = false } = {}) {
    if (inflight.has(projectId)) return inflight.get(projectId);
    const pending = (async () => {
      const project = machine.getProject(store.state, projectId);
      if (!project.path) return { opened: [], skipped: 'project-path-missing' };
      if (project.status !== 'active') return { opened: [], skipped: 'project-inactive' };
      if (needsProjectInitialization(project)) return { opened: [], skipped: 'initialization-required' };
      const opened = [];
      for (const role of [...new Set(roles)].filter(role => ['review', 'cto'].includes(role))) {
        const latest = machine.getProject(store.state, projectId);
        const session = latest.sessions.find(item => item.role === role);
        if (!session) throw new Error(`${role} 控制会话不存在`);
        if (!force && (session.externalThreadId || session.externalThreadStatus === 'pending')) continue;
        try {
          const packetPath = latest.contextPackets?.[role]?.path;
          const prompt = controlPrompt(latest, role, packetPath);
          // Each draft owns its prompt. The second role cannot overwrite the first role's clipboard-only payload.
          if (session.externalThreadId) copyPrompt?.(prompt);
          const result = await openDesktop('', latest.path, { threadId: session.externalThreadId, prompt, openExternal });
          if (!result.opened) throw new Error(result.error || 'Desktop 入口未能打开');
          store.update(state => machine.markControlSessionRequested(state, projectId, role, packetPath));
          opened.push({ role, ...result, requested: true, verified: false, userActionRequired: !session.externalThreadId, threadId: session.externalThreadId });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          store.update(state => {
            const target = machine.getProject(state, projectId).sessions.find(item => item.role === role);
            target.externalThreadStatus = target.externalThreadId ? 'bound' : 'failed';
            target.externalThreadError = detail;
          });
          opened.push({ role, opened: false, requested: false, verified: false, error: detail });
        }
      }
      return { opened, ...(opened.length ? {} : { skipped: 'already-requested-or-bound' }) };
    })().finally(() => inflight.delete(projectId));
    inflight.set(projectId, pending);
    return pending;
  };
}

module.exports = { needsProjectInitialization, controlPrompt, createStandardControlOpener };
