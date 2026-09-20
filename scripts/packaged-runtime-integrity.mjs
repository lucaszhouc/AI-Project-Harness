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

const files = [
  "electron/codex-adapter.cjs",
  "electron/codex-import.cjs",
  "electron/agent-run-monitor.cjs",
  "electron/archive.cjs",
  "electron/project-discovery.cjs",
  "electron/runtime-paths.cjs",
  "electron/codex-projects.cjs",
  "electron/main.cjs",
  "electron/store.cjs",
  "electron/state-machine.cjs",
  "electron/project-onboarding.cjs",
  "electron/onboarding-ipc.cjs",
];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const rows = files.map((relativePath) => {
  const source = fs.readFileSync(path.join(root, relativePath));
  const packaged = asar.extractFile(asarPath, relativePath);
  return {
    file: relativePath,
    equal: sha256(source) === sha256(packaged),
    sourceSha256: sha256(source),
    packagedSha256: sha256(packaged),
    bytes: packaged.length,
  };
});
const markers = {
  controlThreadSeed: (() => {
    const adapter = asar.extractFile(asarPath, "electron/codex-adapter.cjs").toString("utf8");
    return adapter.includes("CONTROL_THREAD_CONFIG")
      && adapter.includes("CONTROL_THREAD_EFFORT")
      && adapter.includes('request("turn/start"');
  })(),
  legacyWriteOptIn: asar.extractFile(asarPath, "electron/codex-projects.cjs").toString("utf8").includes("APH_ENABLE_CODEX_LEGACY_STATE_SYNC"),
  sidebarVerificationState: asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8").includes("desktop-restart-required"),
  dispatchAuditEvent: asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8").includes("task.dispatched"),
  dedicatedImportMode: asar.extractFile(asarPath, "electron/main.cjs").toString("utf8").includes("launchHarnessImport"),
  importReviewGate: asar.extractFile(asarPath, "electron/state-machine.cjs").toString("utf8").includes("recordCodexImportCandidate"),
};
const protocolPath = path.join(root, "release", "win-unpacked", "resources", "protocol", "harness-import.schema.json");
const protocol = {
  path: protocolPath,
  exists: fs.existsSync(protocolPath),
  equal: fs.existsSync(protocolPath) && sha256(fs.readFileSync(protocolPath)) === sha256(fs.readFileSync(path.join(root, "protocol", "harness-import.schema.json"))),
};
const report = { version: packageJson.version, asarPath, rows, markers, protocol };
if (rows.some((row) => !row.equal) || Object.values(markers).some((value) => !value) || !protocol.exists || !protocol.equal) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_FAIL: packaged runtime does not match source\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSMOKE_PASS: packaged-runtime-integrity\n`);
}
