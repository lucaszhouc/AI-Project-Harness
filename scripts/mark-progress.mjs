#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.APH_AUTOCLEVER_ROOT || "E:\\_iva_workspace\\ai-project-harness-full\\autoclever");
const progressPath = path.join(root, "progress.json");
const eventsPath = path.join(root, "events.jsonl");
const [stage = "", detail = "", status = "running"] = process.argv.slice(2);
if (!stage) throw new Error("usage: node scripts/mark-progress.mjs <stage> <detail> [status]");
fs.mkdirSync(root, { recursive: true });
let progress = {};
try { progress = JSON.parse(fs.readFileSync(progressPath, "utf8")); } catch { progress = { run_id: `aph-${Date.now()}`, completed: [], failed: [] }; }
const at = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "long" }).format(new Date()).replace(" ", "T").replace(/\//g, "-").replace(" GMT+9", "+09:00");
progress.updated_at = at;
progress.status = status;
progress.next_action = detail;
if (status === "succeeded" || status === "complete") {
  progress.completed ||= [];
  if (!progress.completed.includes(stage)) progress.completed.push(stage);
} else if (status === "failed" || status === "blocked") {
  progress.failed ||= [];
  progress.failed.push({ stage, detail, at });
}
const temporary = `${progressPath}.tmp-${process.pid}-${Date.now()}`;
fs.writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
fs.renameSync(temporary, progressPath);
fs.appendFileSync(eventsPath, `${JSON.stringify({ at, type: "stage.update", stage, status, detail })}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ progressPath, eventsPath, stage, status, at })}\n`);
