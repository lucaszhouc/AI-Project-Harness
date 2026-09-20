function selectedProject(facts = {}) {
  const projects = Array.isArray(facts.projects) ? facts.projects : [];
  return projects.find((project) => project.id === facts.selectedProjectId) || projects[0];
}

function nextGuideRecommendation(facts = {}) {
  const project = selectedProject(facts);
  if (!project) return { stepId: "project", status: "guiding", actionId: "project.create-blank", guideTarget: "project-create-blank", reasonKey: "no-project", blocking: false };
  if (project.status === "archived") return { stepId: "project", status: "blocked", actionId: "project.restore", guideTarget: "project-restore", reasonKey: "archived-project", blocking: true, projectId: project.id };
  const tasks = Array.isArray(project.tasks) ? project.tasks : [];
  const review = tasks.find((task) => task.status === "review");
  if (review) return { stepId: "review", status: "waiting_user", actionId: "review.open", guideTarget: `review-${review.id}`, reasonKey: review.reviewMode === "auto" ? "explicit-auto-review" : "human-review-required", blocking: false, projectId: project.id, taskId: review.id };
  const running = tasks.find((task) => ["in_progress", "awaiting_result"].includes(task.status));
  if (running) return { stepId: "task", status: "waiting_user", actionId: "task.view-status", guideTarget: `task-${running.id}`, reasonKey: "task-running", blocking: false, projectId: project.id, taskId: running.id };
  const ready = tasks.find((task) => ["ready", "changes_requested", "failed"].includes(task.status));
  if (ready) return { stepId: "task", status: "guiding", actionId: "task.dispatch", guideTarget: `task-dispatch-${ready.id}`, reasonKey: "ready-requires-explicit-dispatch", blocking: false, projectId: project.id, taskId: ready.id };
  const connected = Boolean(project.codexProjectId || project.source?.kind === "connected");
  if (!connected) return { stepId: "codex", status: "guiding", actionId: "project.connect", guideTarget: "project-connect-codex", reasonKey: "connection-optional", blocking: false, projectId: project.id };
  return { stepId: "task", status: "guiding", actionId: "task.create", guideTarget: "task-create", reasonKey: "project-ready", blocking: false, projectId: project.id };
}

function reconcileGuideState(guide, facts = {}) {
  const sequence = Math.max(Number(guide.sequence || 0), Number(facts.sequence || 0));
  let changed = false;
  const project = selectedProject(facts);
  const observedAt = new Date().toISOString();
  guide.completionEvidence ||= [];
  const record = (evidence) => {
    const key = [evidence.stepId, evidence.projectId, evidence.taskId, evidence.runId, evidence.probeId].filter(Boolean).join(":");
    if (!guide.completionEvidence.some((item) => item.key === key)) { guide.completionEvidence.push({ key, sequence, observedAt, ...evidence }); changed = true; }
  };
  if (project) {
    if (guide.steps.project?.status !== "completed") { guide.steps.project = { ...(guide.steps.project || { id: "project" }), status: "completed", updatedAt: observedAt }; changed = true; }
    record({ stepId: "project", projectId: project.id, source: "project-state", evidenceRef: `project:${project.id}@R${Number(project.revision || 0)}` });
    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    for (const task of tasks) {
      record({ stepId: "task-created", projectId: project.id, taskId: task.id, runId: task.run?.id, source: "project-state", evidenceRef: `task:${task.id}:${task.status}` });
      if (task.status === "accepted") record({ stepId: "review", projectId: project.id, taskId: task.id, runId: task.run?.id, source: "accepted-checkpoint", evidenceRef: `project:${project.id}@R${Number(project.revision || 0)}` });
    }
  } else if (guide.steps.project?.status !== "guiding") { guide.steps.project = { ...guide.steps.project, status: "guiding", updatedAt: observedAt }; changed = true; }
  const loginProbe = guide.probes?.["codex-login"];
  if (loginProbe?.status === "ok") {
    if (guide.steps.codex?.status !== "completed") { guide.steps.codex = { ...(guide.steps.codex || { id: "codex" }), status: "completed", updatedAt: observedAt }; changed = true; }
    record({ stepId: "codex", probeId: loginProbe.id, source: "capability-probe", evidenceRef: `probe:${loginProbe.id}`, expiresAt: loginProbe.expiresAt });
  } else if (guide.steps.codex) {
    const status = loginProbe?.status === "checking" ? "running" : "guiding";
    if (guide.steps.codex.status !== status) { guide.steps.codex = { ...guide.steps.codex, status, updatedAt: observedAt }; changed = true; }
  }
  guide.completionEvidence = guide.completionEvidence.slice(-200);
  if (changed) { guide.sequence = sequence; guide.updatedAt = observedAt; }
  return guide;
}

module.exports = { nextGuideRecommendation, reconcileGuideState };
