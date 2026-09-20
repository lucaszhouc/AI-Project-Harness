const { detectCommand } = require("./command-runtime.cjs");

const capabilityTemplates = {
  codex: {
    label: "Codex",
    default: true,
    capabilities: ["discover", "project", "launch", "stream", "open-thread", "skill-injection", "result-parse"],
    mode: "后台可用",
    protocolVersion: "agent-adapter-v1",
  },
  claude: {
    label: "Claude Code",
    default: false,
    capabilities: ["discover", "open-project", "user-invoked-skill", "result-parse"],
    mode: "用户主动",
    protocolVersion: "agent-adapter-v1",
  },
  hermes: {
    label: "Hermes",
    default: false,
    capabilities: ["discover", "open-project", "user-invoked-skill", "result-parse"],
    mode: "适配器预留",
    protocolVersion: "agent-adapter-v1",
  },
};

async function detectAgentCapabilities({ detect = detectCommand } = {}) {
  const entries = await Promise.all(Object.keys(capabilityTemplates).map(async (id) => {
    const command = await detect(id);
    const template = capabilityTemplates[id];
    return [id, { ...template, installed: Boolean(command?.installed), path: command?.path || "" }];
  }));
  return Object.fromEntries(entries);
}

module.exports = { capabilityTemplates, detectAgentCapabilities };
