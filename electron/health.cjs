const fs = require("node:fs");

function projectHealth(project, { git, github, sqlite, fileSystem = fs } = {}) {
  const checks = {
    state: Boolean(project?.id && project?.path),
    context: Boolean(project?.contextPackets?.cto?.path && fileSystem.existsSync(project.contextPackets.cto.path)
      && project?.contextPackets?.review?.path && fileSystem.existsSync(project.contextPackets.review.path)),
    ledger: Boolean(project?.ledger?.path && fileSystem.existsSync(project.ledger.path)),
    git: Boolean(git?.available),
    github: github?.remote ? (github.detailsLoaded === false ? "remote-only" : "ok") : "none",
    sqlite: sqlite?.available === false ? "fallback-json" : "ok",
    // Desktop 原生控制面 confirmation proves only the durable backend row. Until a
    // live Desktop ProjectsManager bridge (or a user cold-start check) proves
    // sidebar visibility, health must remain attention instead of claiming a
    // visible Project.
    codexProject: project?.codexProjectId
      ? (project.codexProjectSync?.state === "desktop-registered" ? "desktop-registered" : false)
      : "none",
  };
  const failures = Object.entries(checks).filter(([, value]) => value === false).map(([key]) => key);
  return { status: failures.length ? "attention" : "ok", checks, failures, checkedAt: new Date().toISOString() };
}

module.exports = { projectHealth };
