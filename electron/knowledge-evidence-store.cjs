const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function persistKnowledgeEvidence(dataRoot, projectId, packet, { fileSystem = fs } = {}) {
  if (!dataRoot || !projectId || !packet || typeof packet !== "object") throw new Error("KNOWLEDGE_EVIDENCE_ARGUMENTS_REQUIRED");
  const target = path.join(path.resolve(dataRoot), "projects", String(projectId), "knowledge", "evidence-index.json");
  const content = `${JSON.stringify(packet, null, 2)}\n`;
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fileSystem.mkdirSync(path.dirname(target), { recursive: true });
  fileSystem.writeFileSync(temporary, content, "utf8");
  fileSystem.renameSync(temporary, target);
  return {
    path: target,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
    userEvidenceCount: Array.isArray(packet.userEvidence) ? packet.userEvidence.length : 0,
    agentEvidenceCount: Array.isArray(packet.agentEvidence) ? packet.agentEvidence.length : 0,
    actionCount: Array.isArray(packet.actions) ? packet.actions.length : 0,
    episodeCount: Array.isArray(packet.episodes) ? packet.episodes.length : 0,
  };
}

module.exports = { persistKnowledgeEvidence };
