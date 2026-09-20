import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdownReport, runCommandStep, summarizeResults } from "./qualification-core.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const reportRoot = path.resolve(process.env.APH_QUALIFICATION_DIR || path.join(root, "qa", "qualification"));
const runRoot = path.join(reportRoot, runId);
const logDir = path.join(runRoot, "logs");
const args = new Set(process.argv.slice(2));
const skipCleanInstall = args.has("--skip-clean-install");
const skipPackage = args.has("--skip-package");
const skipRealCodex = args.has("--skip-real-codex");
const npm = (id, label, npmArgs, options = {}) => ({ id, label, command: "npm", args: npmArgs, ...options });
const node = (id, label, nodeArgs, options = {}) => ({ id, label, command: process.execPath, args: nodeArgs, ...options });

const steps = [
  ...skipCleanInstall ? [] : [npm("clean-install", "Clean dependency install", ["ci"], { severity: "P0", timeoutMs: 10 * 60_000 })],
  npm("release-gate", "Static checks, build, tests, renderer and Electron smoke", ["run", "check:release"], { severity: "P0", timeoutMs: 12 * 60_000 }),
  node("release-contracts", "Release state, workflow, failure, restart, storage and path contracts", ["--test", "tests/release-qualification.test.cjs", "tests/qualification-core.test.cjs"], { severity: "P0", timeoutMs: 5 * 60_000 }),
  npm("discovery-stability", "Real-machine project discovery stability", ["run", "test:discovery-stability"], { severity: "P1", required: false, timeoutMs: 3 * 60_000 }),
  ...skipPackage ? [] : [
    npm("windows-package", "Windows portable package", ["run", "package:win"], { severity: "P0", timeoutMs: 20 * 60_000 }),
    npm("packaged-integrity", "Packaged ASAR matches tested runtime", ["run", "check:packaged-integrity"], { severity: "P0" }),
    npm("package-audit", "Release artifact contents and secret scan", ["run", "audit:package"], { severity: "P0" }),
    npm("portable-launch", "Portable launch and durable state", ["run", "smoke:portable"], { severity: "P0", timeoutMs: 3 * 60_000 }),
    npm("packaged-ui", "Packaged UI smoke", ["run", "smoke:packaged-ui"], { severity: "P0", timeoutMs: 3 * 60_000 }),
    node("packaged-electron", "Packaged Electron workflow smoke", ["scripts/app-smoke.mjs"], {
      severity: "P0",
      timeoutMs: 3 * 60_000,
      env: {
        APH_ELECTRON_EXECUTABLE: path.join(root, "release", "win-unpacked", "AI Project Harness.exe"),
        APH_SMOKE_REPORT: path.join(runRoot, "packaged-electron-report.json"),
      },
    }),
    npm("missing-codex", "Packaged cold start without Codex", ["run", "smoke:missing-codex"], {
      severity: "P0",
      timeoutMs: 3 * 60_000,
      env: {
        APH_ELECTRON_EXECUTABLE: path.join(root, "release", "win-unpacked", "AI Project Harness.exe"),
        APH_MISSING_CODEX_REPORT: path.join(runRoot, "missing-codex-report.json"),
      },
    }),
    ...skipRealCodex ? [] : [npm("packaged-codex-readonly", "Packaged adapter with real Codex read-only", ["run", "smoke:codex-packaged"], {
      severity: "P1",
      required: false,
      timeoutMs: 3 * 60_000,
    })],
  ],
];

fs.mkdirSync(runRoot, { recursive: true });
const results = [];
for (const step of steps) {
  process.stdout.write(`QUALIFICATION_START: ${step.id} — ${step.label}\n`);
  const result = await runCommandStep(step, { root, logDir });
  results.push(result);
  process.stdout.write(`QUALIFICATION_${result.status}: ${step.id} (exit ${result.exitCode}) — ${result.logPath}\n`);
}

const summary = summarizeResults(results);
const generatedAt = new Date().toISOString();
const manualGates = [
  "Windows Sandbox round 1: copy only the final portable EXE; launch without Codex; then follow the public README and complete one real workflow.",
  "Windows Sandbox round 2: destroy the first Sandbox, create a fresh one, and repeat from the release artifact.",
  "Real Codex E2E: Harness → real test repository → code change → Review → explicit human Accept → restart → verify Project State.",
  "Human first-run/error UX and 30–60 minute normal-use pass covering CTO → Task → Reject → Retry → Review → Accept → next task.",
];
const report = { generatedAt, runId, root, summary, results, manualGates };
const markdown = renderMarkdownReport(report);
for (const [target, contents] of [
  [path.join(runRoot, "qualification-report.json"), `${JSON.stringify(report, null, 2)}\n`],
  [path.join(runRoot, "qualification-report.md"), markdown],
  [path.join(reportRoot, "latest.json"), `${JSON.stringify(report, null, 2)}\n`],
  [path.join(reportRoot, "latest.md"), markdown],
]) fs.writeFileSync(target, contents, "utf8");

process.stdout.write(`QUALIFICATION_SUMMARY: PASS ${summary.counts.PASS} / FAIL ${summary.counts.FAIL} / WARN ${summary.counts.WARN}\n`);
process.stdout.write(`RELEASE_BLOCKED: ${summary.releaseBlocked ? "YES" : "NO"}\n`);
process.stdout.write(`QUALIFICATION_REPORT: ${path.join(runRoot, "qualification-report.md")}\n`);
if (summary.releaseBlocked) process.exitCode = 1;
