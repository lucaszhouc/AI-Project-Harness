import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

export function inspectTextEntry(_entry, text, { repositoryRoot = projectRoot } = {}) {
  const findings = [];
  const normalizedRoot = repositoryRoot.replaceAll("\\", "/").toLowerCase();
  const normalizedText = String(text).replaceAll("\\", "/").toLowerCase();
  if (/c:\/+users\/+[^/]+\/+/.test(normalizedText) || normalizedText.includes(normalizedRoot)) {
    findings.push("development-machine absolute path");
  }
  if (/\b(?:sk-[a-z0-9_-]{20,}|hf_[a-z0-9]{20,})\b/i.test(text)) findings.push("secret-shaped token");
  if (/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|OR_KEY|HF_TOKEN)\s*=\s*[^\s"']+/i.test(text)) {
    findings.push("inline secret assignment");
  }
  return findings;
}

function isTextEntry(entry) {
  return /(?:^|\/)(?:package\.json|[^/]+\.(?:cjs|mjs|js|json|html|css|md|txt|yaml|yml))$/i.test(entry);
}

export async function auditPackage({ root = projectRoot, reportPath = path.join(projectRoot, "qa", "package-audit-report.json") } = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const releaseRoot = path.join(root, "release");
  const portablePath = path.join(releaseRoot, `AI-Project-Harness-${packageJson.version}-portable.exe`);
  const unpackedRoot = path.join(releaseRoot, "win-unpacked");
  const executablePath = path.join(unpackedRoot, "AI Project Harness.exe");
  const asarPath = path.join(unpackedRoot, "resources", "app.asar");
  const skillPath = path.join(unpackedRoot, "resources", "integrations", "codex", "skills", "ai-project-harness", "SKILL.md");
  const requiredArtifacts = [portablePath, executablePath, asarPath, skillPath];
  const missingArtifacts = requiredArtifacts.filter((target) => !fs.existsSync(target));
  if (missingArtifacts.length) throw new Error(`Missing packaged artifacts: ${missingArtifacts.join(", ")}`);
  if (fs.statSync(portablePath).size < 1024 * 1024) throw new Error("Portable artifact is unexpectedly small");

  const asar = require("@electron/asar");
  const entries = asar.listPackage(asarPath).map((rawEntry) => {
    const archivePath = rawEntry.replace(/^[/\\]+/, "");
    return { archivePath, normalizedPath: archivePath.replaceAll("\\", "/") };
  });
  const forbiddenEntries = entries
    .map((entry) => entry.normalizedPath)
    .filter((entry) => /(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:qa|tests?)(?:\/|$)/i.test(entry));
  const findings = [];
  for (const entry of entries.filter((candidate) => isTextEntry(candidate.normalizedPath))) {
    const content = asar.extractFile(asarPath, entry.archivePath);
    for (const finding of inspectTextEntry(entry.normalizedPath, content.toString("utf8"), { repositoryRoot: root })) {
      findings.push({ entry: entry.normalizedPath, finding });
    }
  }
  if (forbiddenEntries.length || findings.length) {
    throw new Error(`Package audit failed: ${JSON.stringify({ forbiddenEntries, findings })}`);
  }

  const report = {
    pass: true,
    generatedAt: new Date().toISOString(),
    portablePath,
    portableBytes: fs.statSync(portablePath).size,
    executablePath,
    asarPath,
    asarEntries: entries.length,
    skillPath,
    forbiddenEntries,
    findings,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nPACKAGE_AUDIT_PASS: ${reportPath}\n`);
  return report;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) await auditPackage();
