const fs = require("node:fs");
const path = require("node:path");

const SOURCE_PRIORITY = { harness: 3, codex: 2, root: 1 };
const MAX_ROOT_ENTRIES = 2000;
const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_DIRS = 6000;
const DEFAULT_SCAN_ROOTS = ["E:\\_iva_workspace", "E:\\_Codex项目", "E:\\Cloudflare"];
const IGNORED_DIRECTORIES = new Set([
  ".git", ".svn", ".hg", "node_modules", "dist", "build", "release", "coverage",
  ".cache", ".next", ".vite", "vendor", "__pycache__", "backup", "backups", "qa",
]);
const boundedCandidateCache = new Map();

function normalizeProjectName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("请输入项目名称");
  if (name.length > 120) throw new Error("项目名称不能超过 120 个字符");
  if (name === "." || name === ".." || /[\\/:]/.test(name)) throw new Error("这里只需要项目名称，不需要输入路径");
  return name;
}

function isDirectory(target, fileSystem = fs) {
  try {
    return fileSystem.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function pathExists(target, fileSystem = fs) {
  try {
    fileSystem.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function findGitRoot(startPath, fileSystem = fs) {
  let current = path.resolve(startPath);
  if (!isDirectory(current, fileSystem)) current = path.dirname(current);
  for (let depth = 0; depth < 12; depth += 1) {
    if (pathExists(path.join(current, ".git"), fileSystem)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function foldProjectName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function projectNameTokens(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function acronym(value) {
  const tokens = projectNameTokens(value);
  if (tokens.length < 2) return "";
  return tokens.map((token) => [...token][0]).join("");
}

function levenshteinDistance(left, right) {
  const a = [...left];
  const b = [...right];
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function bigrams(value) {
  const characters = [...value];
  if (characters.length < 2) return characters;
  return characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`);
}

function diceSimilarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length && !b.length) return 1;
  const counts = new Map();
  for (const pair of a) counts.set(pair, (counts.get(pair) || 0) + 1);
  let overlap = 0;
  for (const pair of b) {
    const remaining = counts.get(pair) || 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(pair, remaining - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length || 1);
}

function longestCommonSubsequenceRatio(left, right) {
  const a = [...left];
  const b = [...right];
  let previous = new Array(b.length + 1).fill(0);
  for (const character of a) {
    const current = new Array(b.length + 1).fill(0);
    for (let index = 1; index <= b.length; index += 1) {
      current[index] = character === b[index - 1]
        ? previous[index - 1] + 1
        : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  return previous[b.length] / Math.max(a.length, b.length, 1);
}

function scoreProjectName(query, candidateName) {
  const queryRaw = String(query).normalize("NFKC").trim().toLowerCase();
  const candidateRaw = String(candidateName).normalize("NFKC").trim().toLowerCase();
  const queryFolded = foldProjectName(query);
  const candidateFolded = foldProjectName(candidateName);
  if (!queryFolded || !candidateFolded) return { score: 0, kind: "none" };
  if (queryRaw === candidateRaw) return { score: 1, kind: "exact" };
  if (queryFolded === candidateFolded) return { score: 0.98, kind: "normalized" };
  if (queryFolded.length >= 2 && queryFolded === acronym(candidateName)) return { score: 0.96, kind: "acronym" };
  if (candidateFolded.includes(queryFolded) || queryFolded.includes(candidateFolded)) {
    const ratio = Math.min(queryFolded.length, candidateFolded.length) / Math.max(queryFolded.length, candidateFolded.length);
    return { score: 0.88 + (0.08 * ratio), kind: "substring" };
  }
  const editSimilarity = 1 - (levenshteinDistance(queryFolded, candidateFolded) / Math.max(queryFolded.length, candidateFolded.length));
  const score = (0.55 * editSimilarity)
    + (0.3 * diceSimilarity(queryFolded, candidateFolded))
    + (0.15 * longestCommonSubsequenceRatio(queryFolded, candidateFolded));
  return { score: Math.max(0, Math.min(1, score)), kind: "fuzzy" };
}

function minimumConfidence(query) {
  const length = [...foldProjectName(query)].length;
  if (length <= 2) return 0.98;
  if (length === 3) return 0.78;
  if (length <= 5) return 0.72;
  return 0.68;
}

/**
 * Resolve a project from the already-materialized `project/list` response.
 * Unlike resolveProjectByName this function is intentionally an index lookup:
 * it never stats paths, scans roots, or consults recent CWDs. Each official
 * Project is reduced to its strongest name/id/root candidate and then ranked.
 */
function resolveCodexProjectByName({ name: input, projects = [] }) {
  const query = normalizeProjectName(input);
  const ranked = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project || typeof project !== "object" || !String(project.id || "").trim()) continue;
    const roots = Array.isArray(project.roots) ? project.roots : [];
    const usableRoots = roots
      .map((root) => typeof root === "string" ? { path: root } : root)
      .filter((root) => root && typeof root === "object" && String(root.path || "").trim());
    // A Project without roots is still searchable by its official name/id;
    // return a null root so callers can ask the Agent to discover its path.
    const rootCandidates = usableRoots.length ? usableRoots : [null];
    let best;
    for (const root of rootCandidates) {
      const rootPath = root?.path ? String(root.path) : "";
      const rootName = rootPath ? path.basename(rootPath.replace(/[\\/]+$/, "")) : "";
      const semanticAliases = [...new Set([
        ...candidateAliases(rootPath || String(project.name || "")),
        ...candidateAliases(String(project.name || "")),
      ])];
      const names = [
        { value: project.name, kind: "name" },
        { value: project.id, kind: "id" },
        { value: root?.name, kind: "root" },
        { value: rootName, kind: "root" },
        ...semanticAliases.map((value) => ({ value, kind: "alias" })),
      ].filter((entry) => String(entry.value || "").trim());
      const match = names
        .map((entry) => ({ value: entry.value, kind: entry.kind, ...scoreProjectName(query, entry.value) }))
        .sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind))[0];
      if (!match) continue;
      const candidate = {
        project,
        root,
        match: { query, score: Number(match.score.toFixed(4)), kind: match.kind, matchedName: match.value },
      };
      if (!best || candidate.match.score > best.match.score
        || (candidate.match.score === best.match.score && String(rootPath).localeCompare(String(best.root?.path || "")) < 0)) best = candidate;
    }
    if (best) ranked.push(best);
  }
  ranked.sort((left, right) => right.match.score - left.match.score
    || String(left.project.name || left.project.id).localeCompare(String(right.project.name || right.project.id), "en", { sensitivity: "base" })
    || String(left.project.id).localeCompare(String(right.project.id)));
  if (!ranked.length) throw discoveryError(`未找到 Codex Project“${query}”。`, "PROJECT_NOT_FOUND");

  const exact = ranked.filter((candidate) => candidate.match.score >= 0.98
    && [candidate.project.name, candidate.project.id, candidate.match.matchedName]
      .some((value) => foldProjectName(value) === foldProjectName(query)));
  if (exact.length > 1) {
    throw discoveryError(`发现多个同名 Codex Project，无法安全自动选择：${exact.map((item) => item.project.name || item.project.id).join("；")}`, "PROJECT_AMBIGUOUS");
  }
  if (exact.length === 1) return exact[0];

  const top = ranked[0];
  const threshold = minimumConfidence(query);
  if (top.match.score < threshold) {
    const suggestions = ranked.slice(0, 3).map((item) => item.project.name || item.project.id).join("；");
    throw discoveryError(`未能可靠定位 Codex Project“${query}”。你是不是想找：${suggestions}`, "PROJECT_NOT_FOUND");
  }
  const close = ranked.filter((candidate) => candidate.match.score >= threshold
    && top.match.score - candidate.match.score < 0.07);
  const distinctProjects = new Set(close.map((candidate) => String(candidate.project.id)));
  if (distinctProjects.size > 1) {
    throw discoveryError(`发现多个近似 Codex Project，无法安全自动选择：${close.map((item) => item.project.name || item.project.id).join("；")}`, "PROJECT_AMBIGUOUS");
  }
  return top;
}

/** Select one root from an already-resolved official Codex Project. A caller
 * may supply an explicit/previously-bound path; otherwise only a single root
 * or one uniquely high-confidence root-name match is accepted. */
function selectCodexProjectRoot({ project, query, matchedName, requestedPath } = {}) {
  const roots = (Array.isArray(project?.roots) ? project.roots : [])
    .map((entry) => typeof entry === "string" ? entry : entry?.path)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const explicit = String(requestedPath || "").trim();
  if (explicit) {
    const normalized = path.resolve(explicit).toLowerCase();
    const exact = roots.find((value) => path.resolve(value).toLowerCase() === normalized);
    if (!exact) throw discoveryError("指定目录不属于该 Codex Project，已停止导入以避免串库", "PROJECT_ROOT_MISMATCH");
    return exact;
  }
  if (roots.length <= 1) return roots[0] || "";
  const referenceNames = [project?.name, query, matchedName].filter(Boolean);
  const ranked = roots.map((rootPath) => {
    const rootName = path.basename(rootPath.replace(/[\\/]+$/, ""));
    const score = referenceNames.reduce((best, name) => Math.max(best, scoreProjectName(name, rootName).score), 0);
    return { rootPath, score };
  }).sort((left, right) => right.score - left.score || left.rootPath.localeCompare(right.rootPath, "en", { sensitivity: "base" }));
  if (ranked[0].score >= 0.9 && ranked[0].score - ranked[1].score >= 0.07) return ranked[0].rootPath;
  throw discoveryError(`Codex Project“${project?.name || "未命名"}”包含多个根目录，无法安全自动选择：${roots.join("；")}`, "PROJECT_ROOT_AMBIGUOUS");
}

function discoveryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function discoveryRoots(projects, recentCwds, envValue = process.env.APH_PROJECT_ROOTS || "", fileSystem = fs) {
  const roots = [];
  for (const project of projects || []) roots.push(path.dirname(path.resolve(project.path)));
  for (const cwd of recentCwds || []) {
    roots.push(path.dirname(path.resolve(cwd)));
    const gitRoot = findGitRoot(cwd, fileSystem);
    if (gitRoot) roots.push(path.dirname(gitRoot));
  }
  for (const root of String(envValue).split(path.delimiter).map((item) => item.trim()).filter(Boolean)) roots.push(path.resolve(root));
  return [...new Map(roots.map((root) => [root.toLowerCase(), root])).values()];
}

function listProjectDirectories(root, fileSystem = fs) {
  try {
    return fileSystem.readdirSync(root, { withFileTypes: true })
      .filter((entry) => typeof entry === "string" ? isDirectory(path.join(root, entry), fileSystem) : entry.isDirectory())
      .map((entry) => path.join(root, typeof entry === "string" ? entry : entry.name))
      .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }))
      .slice(0, MAX_ROOT_ENTRIES);
  } catch {
    return [];
  }
}

function listNestedGitProjects(root, fileSystem = fs) {
  return listProjectDirectories(root, fileSystem)
    .filter((projectPath) => pathExists(path.join(projectPath, ".git"), fileSystem));
}

function hasProjectMarker(projectPath, fileSystem = fs) {
  if (pathExists(path.join(projectPath, ".git"), fileSystem)) return true;
  const markers = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "README.md", "AGENTS.md", ".project"];
  if (markers.some((marker) => pathExists(path.join(projectPath, marker), fileSystem))) return true;
  return ["src", "site", "website", "app", "final"].some((name) => isDirectory(path.join(projectPath, name), fileSystem));
}

function listBoundedProjectCandidates(root, fileSystem = fs, depth = 0, output = [], visited = new Set()) {
  if (depth > MAX_SCAN_DEPTH || output.length >= MAX_SCAN_DIRS || !isDirectory(root, fileSystem)) return output;
  const key = path.resolve(root).toLowerCase();
  if (visited.has(key)) return output;
  visited.add(key);
  let entries;
  try {
    entries = fileSystem.readdirSync(root, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (!name || IGNORED_DIRECTORIES.has(name.toLowerCase()) || name.startsWith(".")) continue;
    const target = path.join(root, name);
    const directory = typeof entry === "string" ? isDirectory(target, fileSystem) : entry.isDirectory();
    if (!directory) continue;
    const marked = hasProjectMarker(target, fileSystem);
    if (marked) output.push(target);
    // Only descend through a directory that looks like a project container.
    // This keeps nested workspaces bounded while still finding project roots
    // such as my-workflow/iva-local-chat and portfolio/*/site.
    if (marked && depth < MAX_SCAN_DEPTH) listBoundedProjectCandidates(target, fileSystem, depth + 1, output, visited);
    if (output.length >= MAX_SCAN_DIRS) break;
  }
  return output;
}

function cachedBoundedProjectCandidates(root, fileSystem = fs) {
  const key = `${fileSystem === fs ? "native" : "custom"}:${path.resolve(root).toLowerCase()}`;
  const cached = boundedCandidateCache.get(key);
  if (cached && Date.now() - cached.at < 15000) return cached.paths;
  const paths = listBoundedProjectCandidates(root, fileSystem);
  boundedCandidateCache.set(key, { at: Date.now(), paths });
  return paths;
}

function candidateAliases(candidatePath) {
  const segments = path.resolve(candidatePath).split(/[\\/]+/).filter(Boolean);
  const foldedPath = segments.join(" ").toLowerCase();
  const aliases = [];
  if (/(personal[-_ ]?website|个人网站|个人作品集|portfolio[-_ ]?layered[-_ ]?hero)/i.test(foldedPath)) aliases.push("个人网站", "portfolio", "website");
  else if (/(portfolio|website)/i.test(foldedPath)) aliases.push("portfolio", "website");
  if (/(本地聊天)/i.test(foldedPath)) aliases.push("本地聊天");
  return aliases;
}

function resolveProjectByName({ name: input, projects = [], recentCwds = [], envValue, scanEnvValue = process.env.APH_PROJECT_SCAN_ROOTS, defaultScanRoots = DEFAULT_SCAN_ROOTS, fileSystem = fs }) {
  const query = normalizeProjectName(input);
  const candidates = new Map();
  const addCandidate = (candidate, source) => {
    if (!candidate || !isDirectory(candidate, fileSystem)) return;
    const resolved = path.resolve(candidate);
    const candidateKey = resolved.toLocaleLowerCase();
    const existing = candidates.get(candidateKey);
    if (!existing || SOURCE_PRIORITY[source] > SOURCE_PRIORITY[existing.source]) {
      const previous = candidates.get(candidateKey);
      const stats = (() => { try { return fileSystem.statSync(resolved); } catch { return undefined; } })();
      candidates.set(candidateKey, {
        name: path.basename(resolved),
        path: resolved,
        source,
        aliases: candidateAliases(resolved),
        modifiedAt: stats?.mtimeMs || 0,
        ...(previous && source === previous.source ? previous : {}),
      });
    }
  };

  for (const project of projects) addCandidate(project.path, "harness");
  for (const cwd of recentCwds) {
    addCandidate(cwd, "codex");
    const gitRoot = findGitRoot(cwd, fileSystem);
    addCandidate(gitRoot, "codex");
    for (const nestedRoot of new Set([path.resolve(cwd), gitRoot].filter(Boolean))) {
      for (const projectPath of listNestedGitProjects(nestedRoot, fileSystem)) addCandidate(projectPath, "root");
    }
  }
  const tempRoot = require("node:os").tmpdir().toLowerCase();
  const usesTempFixture = [...(projects || []).map((project) => project.path), ...(recentCwds || [])]
    .some((candidate) => path.resolve(String(candidate || "")).toLowerCase().startsWith(tempRoot));
  // Recent Codex cwd entries are an index, not an exhaustive project root.
  // Keep scanning the bounded default roots as well so a project that has not
  // appeared in a recent thread (for example the personal website workspace)
  // is still discoverable. Tests and isolated fixtures can provide their own
  // defaults; temporary fixtures intentionally skip machine-wide roots.
  const hasExplicitRoots = Boolean(String(envValue || "").trim() || String(scanEnvValue || "").trim());
  const fallbackRoots = !usesTempFixture && !hasExplicitRoots
    ? (defaultScanRoots || []).filter((root) => isDirectory(root, fileSystem))
    : [];
  const searchRoots = [...new Map([
    ...discoveryRoots(projects, recentCwds, envValue, fileSystem).map((root) => [path.resolve(root).toLowerCase(), root]),
    ...(recentCwds || []).map((root) => [path.resolve(root).toLowerCase(), path.resolve(root)]),
    ...String(scanEnvValue || "").split(path.delimiter).map((root) => root.trim()).filter(Boolean)
      .map((root) => [path.resolve(root).toLowerCase(), path.resolve(root)]),
    ...fallbackRoots.map((root) => [path.resolve(root).toLowerCase(), path.resolve(root)]),
  ]).values()];
  for (const root of searchRoots) {
    const configuredRoots = String(envValue || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
    const configuredScanRoots = String(scanEnvValue || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
    const allowBoundedScan = configuredRoots.length || configuredScanRoots.length || recentCwds.length > 0 || projects.length === 0 || !usesTempFixture;
    const rootsToScan = allowBoundedScan && (configuredRoots.length || configuredScanRoots.length || fileSystem !== fs || usesTempFixture)
      ? [root]
      : allowBoundedScan
        ? [root, ...(recentCwds.length === 0 ? DEFAULT_SCAN_ROOTS.filter((item) => isDirectory(item, fileSystem)) : [])]
        : [];
    for (const scanRoot of rootsToScan) {
      if (allowBoundedScan) for (const projectPath of cachedBoundedProjectCandidates(scanRoot, fileSystem)) addCandidate(projectPath, "root");
      for (const projectPath of listProjectDirectories(scanRoot, fileSystem)) {
        // Explicit roots are commonly used as a lightweight index in tests and
        // user configs, so retain their direct folders. Recent-Codex roots are
        // broad workspaces; only accept folders that look like real projects.
        if (configuredRoots.length || hasProjectMarker(projectPath, fileSystem)) addCandidate(projectPath, "root");
      }
    }
  }

  const ranked = [...candidates.values()]
    .map((candidate) => {
      const names = [candidate.name, ...(candidate.aliases || [])];
      const best = names.map((value) => ({ value, ...scoreProjectName(query, value) }))
        .sort((left, right) => right.score - left.score)[0];
      const aliasBoost = best?.value === "个人网站" && best.score >= 0.8
        ? Math.min(0.025, candidate.modifiedAt / 1e15)
        : 0;
      return { ...candidate, match: { query, ...best, score: Math.min(1, best.score + aliasBoost), matchedName: best.value } };
    })
    .sort((left, right) => right.match.score - left.match.score
      || left.name.localeCompare(right.name, "en", { sensitivity: "base" })
      || left.path.localeCompare(right.path, "en", { sensitivity: "base" }));

  if (!ranked.length) {
    throw discoveryError(`未找到项目“${query}”。Harness 已检查现有项目、Codex 最近任务和默认项目根目录。`, "PROJECT_NOT_FOUND");
  }

  const rawQuery = query.normalize("NFKC").toLowerCase();
  const exactMatches = ranked.filter((candidate) => [candidate.name, ...(candidate.aliases || [])]
    .some((value) => value.normalize("NFKC").toLowerCase() === rawQuery));
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw discoveryError(`发现多个同名项目，无法安全自动选择：${exactMatches.map((item) => item.path).join("；")}`, "PROJECT_AMBIGUOUS");
  }
  const registeredMatch = ranked.filter((candidate) => candidate.source === "harness" && candidate.match.score >= 0.9);
  if (registeredMatch.length === 1) {
    registeredMatch[0].match.score = Number(registeredMatch[0].match.score.toFixed(4));
    return registeredMatch[0];
  }

  const top = ranked[0];
  const threshold = minimumConfidence(query);
  if (top.match.score < threshold) {
    const suggestions = ranked.slice(0, 3).map((candidate) => `${candidate.name}（${candidate.path}）`).join("；");
    throw discoveryError(`未能可靠定位项目“${query}”。你是不是想找：${suggestions}`, "PROJECT_NOT_FOUND");
  }

  const closeMatches = ranked.filter((candidate) => candidate.match.score >= threshold && top.match.score - candidate.match.score < 0.07);
  if (closeMatches.length > 1) {
    throw discoveryError(`发现多个近似项目，无法安全自动选择：${closeMatches.map((item) => `${item.name}（${item.path}）`).join("；")}`, "PROJECT_AMBIGUOUS");
  }
  top.match.score = Number(top.match.score.toFixed(4));
  return top;
}

module.exports = { discoveryRoots, findGitRoot, foldProjectName, normalizeProjectName, resolveProjectByName, resolveCodexProjectByName, selectCodexProjectRoot, scoreProjectName };
