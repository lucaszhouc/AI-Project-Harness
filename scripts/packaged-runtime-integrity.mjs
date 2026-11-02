#!/usr/bin/env node
/** Verify that the unpacked ASAR contains the exact runtime just tested. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const asarPath = path.join(root, "release", "win-unpacked", "resources", "app.asar");
if (!fs.existsSync(asarPath)) throw new Error(`Packaged ASAR missing: ${asarPath}`);

function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? listFiles(relativePath) : [relativePath];
  });
}

const files = [...listFiles("electron"), ...listFiles("dist")];
const externalResourceFiles = [
  ...listFiles("integrations").map(source => ({ source, packaged: path.join("resources", source) })),
  ...listFiles("protocol").map(source => ({ source, packaged: path.join("resources", source) })),
  ...listFiles("electron").map(source => ({ source, packaged: path.join("resources", "harness-runtime", source) })),
  { source: "integrations/harness-runtime-package.json", packaged: path.join("resources", "harness-runtime", "package.json") },
];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const rows = files.map((relativePath) => {
  const source = fs.readFileSync(path.join(root, relativePath));
  let packaged;
  let error;
  try { packaged = asar.extractFile(asarPath, relativePath); }
  catch (cause) { error = cause instanceof Error ? cause.message : String(cause); packaged = Buffer.alloc(0); }
  return {
    file: relativePath,
    equal: !error && sha256(source) === sha256(packaged),
    sourceSha256: sha256(source),
    packagedSha256: sha256(packaged),
    bytes: packaged.length,
    ...(error ? { error } : {}),
  };
});
const externalRows = externalResourceFiles.map(({ source, packaged }) => {
  const sourceBytes = fs.readFileSync(path.join(root, source));
  const packagedPath = path.join(root, "release", "win-unpacked", packaged);
  const packagedBytes = fs.existsSync(packagedPath) ? fs.readFileSync(packagedPath) : Buffer.alloc(0);
  return {
    file: packaged,
    sourceFile: source,
    equal: packagedBytes.length > 0 && sha256(sourceBytes) === sha256(packagedBytes),
    sourceSha256: sha256(sourceBytes),
    packagedSha256: packagedBytes.length ? sha256(packagedBytes) : null,
    bytes: packagedBytes.length,
  };
});
const markers = {
  desktopNativeAdapter: asar.extractFile(asarPath, "electron/codex-adapter.cjs").toString("utf8").includes("desktop-native-new-thread-deep-link"),
  sidebarVerificationState: asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8").includes("desktop-restart-required"),
  dispatchAuditEvent: asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8").includes("task.dispatched"),
  nativeImportBoundary: asar.extractFile(asarPath, "electron/main.cjs").toString("utf8").includes('desktopNativeBlocked("导入已选 Codex 对话"'),
  activeThreadDeferred: asar.extractFile(asarPath, "electron/task-open.cjs").toString("utf8").includes("active-thread-deferred"),
  importReviewGate: asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8").includes("recordCodexImportCandidate"),
  knowledgeCompiler: (() => {
    const compiler = asar.extractFile(asarPath, "electron/knowledge-compiler.cjs").toString("utf8");
    const machine = asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8");
    return compiler.includes("KNOWLEDGE_USER_SOURCE_REQUIRED")
      && machine.includes("recordKnowledgeCandidates")
      && machine.includes("acceptKnowledgeCandidate");
  })(),
  epipeProtection: asar.extractFile(asarPath, "electron/diagnostics.cjs").toString("utf8").includes("EPIPE"),
};
const protocolPath = path.join(root, "release", "win-unpacked", "resources", "protocol", "harness-import.schema.json");
const protocol = {
  path: protocolPath,
  exists: fs.existsSync(protocolPath),
  equal: fs.existsSync(protocolPath) && sha256(fs.readFileSync(protocolPath)) === sha256(fs.readFileSync(path.join(root, "protocol", "harness-import.schema.json"))),
};
const report = { version: packageJson.version, asarPath, rows: [...rows, ...externalRows], markers, protocol };
if ([...rows, ...externalRows].some((row) => !row.equal) || Object.values(markers).some((value) => !value) || !protocol.exists || !protocol.equal) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_FAIL: packaged runtime does not match source\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: packaged-runtime-integrity\n`);
}
