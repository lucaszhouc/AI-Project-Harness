import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function summarizeResults(results) {
  const counts = { PASS: 0, FAIL: 0, WARN: 0 };
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  const blockingSteps = results
    .filter((result) => result.status === "FAIL" && result.required !== false)
    .map((result) => result.id);
  return { counts, releaseBlocked: blockingSteps.length > 0, blockingSteps };
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMarkdownReport({ generatedAt, root, summary, results, manualGates }) {
  const lines = [
    "# First Release Qualification",
    "",
    `Generated: ${generatedAt}`,
    `Repository: ${root}`,
    `Release blocked: ${summary.releaseBlocked ? "YES" : "NO"}`,
    `Automated results: PASS ${summary.counts.PASS} / FAIL ${summary.counts.FAIL} / WARN ${summary.counts.WARN}`,
    "",
    "| Status | Priority | Gate | Required | Command | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of results) {
    lines.push(`| ${result.status} | ${result.severity} | ${markdownCell(result.label)} | ${result.required === false ? "no" : "yes"} | \`${markdownCell(result.command)}\` | ${markdownCell(result.logPath)} |`);
    if (result.status !== "PASS" && result.reproduction) lines.push(`\nReproduce **${result.label}**: ${result.reproduction}`);
  }
  lines.push("", "## Manual gates — pending", "");
  for (const gate of manualGates) lines.push(`- [ ] ${gate}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function resolveStepInvocation(
  step,
  {
    platform = process.platform,
    npmExecPath = process.env.npm_execpath,
    nodeExecutable = process.execPath,
  } = {},
) {
  if (step.command === "npm" && platform === "win32") {
    if (!npmExecPath) throw new Error("npm_execpath is unavailable; run qualification through `npm run qualify:release`");
    return { executable: nodeExecutable, args: [npmExecPath, ...(step.args || [])] };
  }
  return { executable: step.command, args: step.args || [] };
}

export async function runCommandStep(step, { root, logDir }) {
  const startedAt = new Date().toISOString();
  const logPath = path.join(logDir, `${step.id}.log`);
  fs.mkdirSync(logDir, { recursive: true });
  const invocation = resolveStepInvocation(step);
  const command = [step.command, ...(step.args || [])].join(" ");

  const exitCode = await new Promise((resolve) => {
    const output = fs.createWriteStream(logPath, { flags: "w" });
    const child = spawn(invocation.executable, invocation.args, {
      cwd: root,
      env: { ...process.env, ...(step.env || {}) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      output.end();
      resolve(code ?? 1);
    };
    const timer = step.timeoutMs
      ? setTimeout(() => {
        output.write(`\nQUALIFICATION_TIMEOUT after ${step.timeoutMs}ms\n`);
        child.kill();
      }, step.timeoutMs)
      : null;
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    child.on("error", (error) => {
      output.write(`\nSPAWN_ERROR: ${error.stack || error.message}\n`);
      if (timer) clearTimeout(timer);
      finish(1);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      finish(code);
    });
  });

  const required = step.required !== false;
  const status = exitCode === 0 ? "PASS" : required ? "FAIL" : "WARN";
  return {
    ...step,
    command,
    required,
    status,
    exitCode,
    startedAt,
    completedAt: new Date().toISOString(),
    logPath,
    reproduction: step.reproduction || `From ${root}, run: ${command}`,
  };
}
