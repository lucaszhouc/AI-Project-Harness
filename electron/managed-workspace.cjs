const fs = require("node:fs");
const path = require("node:path");

const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

function safeWorkspaceSlug(name) {
  const original = String(name || "").normalize("NFKC").trim();
  if (!original) throw new Error("Project name is required");
  let slug = original
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 80)
    .replace(/[. ]+$/g, "") || "project";
  if (RESERVED_WINDOWS_NAMES.test(slug)) slug = `${slug}-project`;
  return slug;
}

function createManagedWorkspace({ dataRoot, name, fileSystem = fs } = {}) {
  const root = path.resolve(String(dataRoot || ""));
  if (!root || root === path.parse(root).root) throw new Error("Harness dataRoot is required");
  const workspaceRoot = path.join(root, "workspaces");
  fileSystem.mkdirSync(workspaceRoot, { recursive: true });
  const slug = safeWorkspaceSlug(name);
  for (let index = 1; index <= 10000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = path.join(workspaceRoot, `${slug}${suffix}`);
    try {
      fileSystem.mkdirSync(candidate);
      return { path: candidate, created: true, slug: `${slug}${suffix}` };
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Unable to allocate a unique managed workspace");
}

module.exports = { createManagedWorkspace, safeWorkspaceSlug };
