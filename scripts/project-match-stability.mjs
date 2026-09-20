import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listRecentCodexCwds } = require("../electron/codex-adapter.cjs");
const { resolveProjectByName } = require("../electron/project-discovery.cjs");

function findCodexExecutable() {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(locator, ["codex"], { encoding: "utf8", windowsHide: true });
  const matches = output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return matches.find((item) => item.toLowerCase().endsWith(".exe"))
    || matches.find((item) => item.toLowerCase().endsWith(".cmd"))
    || matches[0];
}

function shuffled(values, seed) {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = ((state * 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

const scenarios = [
  { query: "AI Projec Harnes", expected: "AI-Project-Harness" },
  { query: "my workflo", expected: "my-workflow" },
  { query: "账号运莹", expected: "账号运营" },
  { query: "聊天项目", expected: "聊天" },
  { query: "求职项目", expected: "求职" },
  { query: "Local Chat", expected: "iva-local-chat" },
];
const repeats = Number.parseInt(process.env.APH_STABILITY_REPEATS || "32", 10);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 1000) {
  throw new Error("APH_STABILITY_REPEATS 必须是 1–1000 的整数");
}

const executable = findCodexExecutable();
const recentCwds = await listRecentCodexCwds({ executable, cwd: process.cwd() });
if (!recentCwds.length) throw new Error("Codex app-server 没有返回近期项目工作目录");

const baselines = new Map();
const results = [];
let driftCount = 0;
for (const scenario of scenarios) {
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    let resolved;
    let ambiguity;
    try {
      resolved = resolveProjectByName({
        name: scenario.query,
        recentCwds: shuffled(recentCwds, (attempt + 1) * 7919),
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (error?.code !== "PROJECT_AMBIGUOUS"
        || !message.toLocaleLowerCase().includes(scenario.expected.toLocaleLowerCase())) throw error;
      ambiguity = message;
    }
    const signature = ambiguity
      ? `PROJECT_AMBIGUOUS|${ambiguity}`
      : `${resolved.path.toLocaleLowerCase()}|${resolved.match.kind}|${resolved.match.score}`;
    const baseline = baselines.get(scenario.query);
    if (!baseline) baselines.set(scenario.query, signature);
    if (baseline && baseline !== signature) driftCount += 1;
    if (!ambiguity && resolved.name.toLocaleLowerCase() !== scenario.expected.toLocaleLowerCase()) {
      throw new Error(`${scenario.query} 错配到 ${resolved.name}（预期 ${scenario.expected}）`);
    }
    if (attempt === 0) {
      results.push(ambiguity
        ? { query: scenario.query, matched: null, kind: "safe-ambiguity", score: null, detail: ambiguity }
        : {
          query: scenario.query,
          matched: resolved.name,
          kind: resolved.match.kind,
          score: resolved.match.score,
        });
    }
  }
}

let shortInputRejected = false;
try {
  resolveProjectByName({ name: "x", recentCwds });
} catch (error) {
  shortInputRejected = error?.code === "PROJECT_NOT_FOUND" || error?.code === "PROJECT_AMBIGUOUS";
}
if (!shortInputRejected) throw new Error("单字符低置信输入没有被安全门拒绝");
if (driftCount) throw new Error(`候选顺序造成 ${driftCount} 次结果漂移`);

const report = {
  source: "Codex app-server thread/list",
  recentCwdCount: recentCwds.length,
  scenarios: scenarios.length,
  repeatsPerScenario: repeats,
  totalResolutions: scenarios.length * repeats,
  driftCount,
  shortInputRejected,
  results,
};

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (process.env.APH_STABILITY_REPORT) {
  const reportPath = path.resolve(process.env.APH_STABILITY_REPORT);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportText, "utf8");
}
process.stdout.write(reportText);
