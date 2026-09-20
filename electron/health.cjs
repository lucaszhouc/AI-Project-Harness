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
    codexProject: project?.codexProjectId
      ? (["app-server-confirmed", "desktop-registered"].includes(project.codexProjectSync?.state) ? project.codexProjectSync.state : false)
      : "none",
  };
  const failures = Object.entries(checks).filter(([, value]) => value === false).map(([key]) => key);
  return { status: failures.length ? "attention" : "ok", checks, failures, checkedAt: new Date().toISOString() };
}

module.exports = { projectHealth };
