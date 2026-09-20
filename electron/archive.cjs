const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");

const ARCHIVE_VERSION = 1;
const MAX_MANIFESTS = 10000;

function archiveRoot(dataRoot) {
  return path.join(path.resolve(dataRoot), "archive");
}

function objectPath(dataRoot, hash) {
  const normalized = String(hash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("Invalid archive object hash");
  return path.join(archiveRoot(dataRoot), "objects", normalized.slice(0, 2), normalized);
}

function atomicWrite(filePath, content, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fileSystem.writeFileSync(temporary, content, "utf8");
  fileSystem.renameSync(temporary, filePath);
}

function formatForPath(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  return "text";
}

/**
 * Import a potentially very large transcript without buffering it in memory.
 * The raw bytes are stored by SHA-256, so importing the same snapshot twice
 * only creates a second lightweight manifest and reuses the object.
 */
async function importTranscript(filePath, dataRoot, { projectId, label, sourceId, sourceType, maxBytes = 0, onProgress = () => {}, fileSystem = fs } = {}) {
  const source = path.resolve(String(filePath || ""));
  if (!source || !fileSystem.existsSync(source)) throw new Error("Transcript file not found");
  const stat = fileSystem.statSync(source);
  if (!stat.isFile()) throw new Error("Transcript path is not a file");
  const root = archiveRoot(dataRoot);
  const tempDir = path.join(root, "tmp");
  fileSystem.mkdirSync(tempDir, { recursive: true });
  const temporary = path.join(tempDir, `${process.pid}-${Date.now()}-${crypto.randomUUID()}.payload`);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let lineCount = 0;
  let messageCount = 0;
  let resultCount = 0;
  let lastResult;
  let lastProgressAt = 0;
  const input = fileSystem.createReadStream(source);
  const output = fileSystem.createWriteStream(temporary, { flags: "wx" });
  let limitError;
  input.on("data", (chunk) => {
    bytes += chunk.length;
    if (maxBytes > 0 && bytes > maxBytes) {
      const error = new Error(`Transcript exceeds the configured ${maxBytes} byte limit`);
      limitError = error;
      input.destroy();
      output.destroy();
      return;
    }
    hash.update(chunk);
    if (Date.now() - lastProgressAt >= 500) {
      lastProgressAt = Date.now();
      try { onProgress({ bytes, maxBytes, source: path.basename(source) }); } catch {}
    }
  });
  const lineReader = readline.createInterface({ input, crlfDelay: Infinity });
  lineReader.on("line", (line) => {
    lineCount += 1;
    if (line.length > 0) messageCount += 1;
    // Keep only a tiny structured signal in the manifest; the original line
    // remains in the content-addressed object for exact recovery.
    if (line.length <= 200000) {
      const match = line.match(/```harness-result\s*([\s\S]*?)```/i);
      if (match) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (parsed && typeof parsed === "object" && parsed.summary) {
            resultCount += 1;
            lastResult = { summary: String(parsed.summary).slice(0, 800), nextStep: String(parsed.nextStep || "").slice(0, 500) };
          }
        } catch {
          // Incomplete blocks are retained in the raw object and can be
          // re-parsed on a later import; they do not invalidate the archive.
        }
      }
    }
  });
  try {
    await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error || limitError || new Error("Transcript stream failed")); } };
    input.once("error", fail);
    output.once("error", fail);
    input.once("close", () => { if (limitError) fail(limitError); });
    output.once("close", () => { if (limitError) fail(limitError); });
    lineReader.once("error", fail);
    output.once("finish", () => { if (!settled) { settled = true; resolve(); } });
    input.pipe(output);
    });
  } catch (error) {
    try { fileSystem.unlinkSync(temporary); } catch {}
    throw error;
  }
  lineReader.close();
  try { onProgress({ bytes, maxBytes, source: path.basename(source), done: true }); } catch {}
  const digest = hash.digest("hex");
  const target = objectPath(dataRoot, digest);
  fileSystem.mkdirSync(path.dirname(target), { recursive: true });
  let deduplicated = false;
  if (fileSystem.existsSync(target)) {
    deduplicated = true;
    try { fileSystem.unlinkSync(temporary); } catch {}
  } else {
    try {
      fileSystem.renameSync(temporary, target);
    } catch (error) {
      if (!fileSystem.existsSync(target)) throw error;
      deduplicated = true;
      try { fileSystem.unlinkSync(temporary); } catch {}
    }
  }
  const importedAt = new Date().toISOString();
  const scope = projectId ? crypto.createHash("sha1").update(String(projectId)).digest("hex").slice(0, 10) : "global";
  const manifestId = `archive-${scope}-${digest.slice(0, 24)}`;
  const manifest = {
    version: ARCHIVE_VERSION,
    id: manifestId,
    projectId: projectId ? String(projectId) : undefined,
    label: String(label || path.basename(source)).slice(0, 240),
    sourceId: sourceId ? String(sourceId).slice(0, 200) : undefined,
    sourceType: sourceType ? String(sourceType).slice(0, 80) : undefined,
    sourceName: path.basename(source),
    format: formatForPath(source),
    bytes,
    lineCount,
    messageCount,
    resultCount,
    ...(lastResult ? { lastResult } : {}),
    sha256: digest,
    objectPath: target,
    deduplicated,
    importedAt,
  };
  const manifestDir = path.join(root, "manifests");
  fileSystem.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${manifest.id}.json`);
  if (fileSystem.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fileSystem.readFileSync(manifestPath, "utf8"));
      const merged = {
        ...existing,
        ...(existing.sourceId || !manifest.sourceId ? {} : { sourceId: manifest.sourceId }),
        ...(existing.sourceType || !manifest.sourceType ? {} : { sourceType: manifest.sourceType }),
      };
      if (JSON.stringify(existing) !== JSON.stringify(merged)) atomicWrite(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, fileSystem);
      return { manifest: merged, manifestPath, deduplicated: true };
    } catch {
      // Replace a corrupt manifest with the newly verified one below.
    }
  }
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, fileSystem);
  return { manifest, manifestPath, deduplicated };
}

function listArchiveManifests(dataRoot, { projectId, fileSystem = fs } = {}) {
  const dir = path.join(archiveRoot(dataRoot), "manifests");
  if (!fileSystem.existsSync(dir)) return [];
  return fileSystem.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .slice(0, MAX_MANIFESTS)
    .map((name) => {
      try { return JSON.parse(fileSystem.readFileSync(path.join(dir, name), "utf8")); } catch { return null; }
    })
    .filter((manifest) => manifest && (!projectId || manifest.projectId === projectId))
    .sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
}

async function readArchiveObject(dataRoot, hash) {
  return fsp.readFile(objectPath(dataRoot, hash));
}

async function verifyArchiveObject(dataRoot, manifest) {
  if (!manifest?.sha256) throw new Error("Archive manifest hash is required");
  const file = objectPath(dataRoot, manifest.sha256);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => { hash.update(chunk); bytes += chunk.length; });
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  const digest = hash.digest("hex");
  return { valid: digest === String(manifest.sha256).toLowerCase() && (!manifest.bytes || Number(manifest.bytes) === bytes), bytes, sha256: digest };
}

module.exports = { ARCHIVE_VERSION, archiveRoot, objectPath, importTranscript, listArchiveManifests, readArchiveObject, verifyArchiveObject, atomicWrite };
