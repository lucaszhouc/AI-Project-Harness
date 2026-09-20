const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BUNDLE_VERSION = 1;

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

function sanitizedProject(project) {
  return JSON.parse(JSON.stringify(project));
}

function buildBundle(project, { archives = [], exportedAt = new Date().toISOString() } = {}) {
  return {
    version: BUNDLE_VERSION,
    type: "ai-project-harness-project",
    exportedAt,
    project: sanitizedProject(project),
    archiveRefs: archives.map((item) => ({ id: item.id, sha256: item.sha256, bytes: item.bytes, format: item.format, importedAt: item.importedAt })),
  };
}

function exportProjectBundle(project, targetPath, options = {}) {
  if (!project || !targetPath) throw new Error("Project and target path are required");
  const bundle = buildBundle(project, options);
  atomicWrite(path.resolve(targetPath), `${JSON.stringify(bundle, null, 2)}\n`);
  return { path: path.resolve(targetPath), sha256: crypto.createHash("sha256").update(JSON.stringify(bundle)).digest("hex"), bundle };
}

function validateBundle(bundle) {
  if (!bundle || bundle.type !== "ai-project-harness-project" || bundle.version !== BUNDLE_VERSION || !bundle.project?.id || !bundle.project?.path) throw new Error("Invalid Harness project bundle");
  return bundle;
}

function importProjectBundle(state, bundle, { replace = false } = {}) {
  validateBundle(bundle);
  const incoming = sanitizedProject(bundle.project);
  const existingIndex = state.projects.findIndex((project) => project.id === incoming.id || path.resolve(project.path).toLowerCase() === path.resolve(incoming.path).toLowerCase());
  if (existingIndex >= 0 && !replace) {
    state.selectedProjectId = state.projects[existingIndex].id;
    return { project: state.projects[existingIndex], imported: false, reason: "already-exists" };
  }
  if (existingIndex >= 0) state.projects.splice(existingIndex, 1);
  state.projects.push(incoming);
  state.selectedProjectId = incoming.id;
  return { project: incoming, imported: true };
}

module.exports = { BUNDLE_VERSION, buildBundle, exportProjectBundle, validateBundle, importProjectBundle };
