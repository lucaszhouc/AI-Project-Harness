#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { HarnessStore } = require("../electron/store.cjs");
const machine = require("../electron/state-machine.cjs");
const protocol = require("../electron/harness-protocol.cjs");
const archive = require("../electron/archive.cjs");
const bundles = require("../electron/project-bundle.cjs");

const CLI_LIST_LIMITS = { projects: 200, archives: 100 };
function clip(value, max = 1000) {
  const text = String(value ?? "").replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "[已脱敏]").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function args(argv) {
  const output = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) output[item.slice(2)] = argv[++index] || "";
    else output._.push(item);
  }
  return output;
}

function dataRoot() {
  return path.resolve(process.env.APH_DATA_ROOT || (process.env.APH_USER_DATA ? process.env.APH_USER_DATA : "E:\\_Codex数据\\AI-Project-Harness"));
}

function loadStore() {
  const root = dataRoot();
  return new HarnessStore(path.join(root, "harness-state.json"), process.cwd(), { journalPath: path.join(root, "harness-state.jsonl"), contextRoot: root });
}

function projectRef(store, ref) {
  const value = String(ref || "").trim();
  const exact = store.state.projects.find((project) => project.id === value || project.name.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const folded = value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const candidates = store.state.projects.filter((project) => project.name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").includes(folded));
  if (candidates.length === 1) return candidates[0];
  throw new Error("Project not found or ambiguous");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

async function main() {
  const input = args(process.argv.slice(2));
  const command = input._[0] || "context";
  if (["help", "--help", "-h"].includes(command)) {
    process.stdout.write("AI Project Harness CLI\n  list\n  context --project <id-or-name>\n  ledger --project <id-or-name> [--maxChars 12000]\n  activity --project <id-or-name> [--limit 50]\n  result --project <id> --task <id> --file result.json\n  event --project <id> --task <id> --file event.json\n  decision --project <id> --file decision.json\n  section --project <id> --file section.json\n  status --project <id> --value active|paused|completed|archived\n  import --project <id> --file transcript.jsonl\n  export --project <id> --file project.aph-project.json\n  archives --project <id>\n  verify --project <id> --hash <sha256>\n");
    return;
  }
  const store = loadStore();
  const project = projectRef(store, input.project || store.state.selectedProjectId);
  let result;
  if (command === "list") {
    result = store.state.projects.slice(0, CLI_LIST_LIMITS.projects).map((item) => ({ id: clip(item.id, 120), name: clip(item.name, 240), status: clip(item.status, 60), revision: Number(item.revision || 0) }));
  } else if (command === "context") {
    result = protocol.buildProjectContext(project);
  } else if (command === "activity") {
    result = machine.getProjectActivity(project, { limit: Number(input.limit || 50) });
  } else if (command === "ledger") {
    const ledgerPath = project.ledger?.path || path.join(dataRoot(), "projects", project.id, "PROJECT-LEDGER.md");
    result = { path: ledgerPath, content: fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").slice(0, Math.max(1000, Math.min(24000, Number(input.maxChars) || 12000))) : "" };
  } else if (command === "result") {
    if (!input.task || !input.file) throw new Error("result requires --task and --file");
    result = protocol.applyHarnessResult(store.state, project.id, input.task, readJson(input.file));
    store.write();
  } else if (command === "event") {
    if (!input.task || !input.file) throw new Error("event requires --task and --file");
    result = protocol.applyHarnessEvent(store.state, project.id, input.task, readJson(input.file));
    store.write();
  } else if (command === "decision") {
    if (!input.file) throw new Error("decision requires --file");
    result = protocol.applyDecisionProposal(store.state, project.id, readJson(input.file));
    store.write();
  } else if (command === "section") {
    if (!input.file) throw new Error("section requires --file");
    result = machine.createSection(store.state, project.id, readJson(input.file));
    store.write();
  } else if (command === "status") {
    if (!input.value) throw new Error("status requires --value");
    result = machine.setProjectStatus(store.state, project.id, input.value);
    store.write();
  } else if (command === "import") {
    if (!input.file) throw new Error("import requires --file");
    result = await archive.importTranscript(input.file, dataRoot(), { projectId: project.id, maxBytes: Number(process.env.APH_MAX_TRANSCRIPT_BYTES || 0) });
    store.update((state) => {
      const target = machine.getProject(state, project.id);
      target.archiveManifests ||= [];
      if (!target.archiveManifests.some((item) => item.sha256 === result.manifest.sha256)) target.archiveManifests.unshift({ ...result.manifest, manifestPath: result.manifestPath });
      target.updatedAt = result.manifest.importedAt;
    });
  } else if (command === "archives") {
    result = archive.listArchiveManifests(dataRoot(), { projectId: project.id }).slice(0, CLI_LIST_LIMITS.archives).map((item) => ({ id: clip(item.id, 120), sha256: clip(item.sha256, 80), bytes: Number(item.bytes || 0), format: clip(item.format, 40), importedAt: clip(item.importedAt, 80), objectPath: clip(item.objectPath, 800) }));
  } else if (command === "verify") {
    if (!input.hash) throw new Error("verify requires --hash");
    const manifest = archive.listArchiveManifests(dataRoot(), { projectId: project.id }).find((item) => item.sha256 === input.hash);
    if (!manifest) throw new Error("Archive manifest not found");
    result = await archive.verifyArchiveObject(dataRoot(), manifest);
  } else if (command === "export") {
    if (!input.file) throw new Error("export requires --file");
    result = bundles.exportProjectBundle(project, input.file, { archives: archive.listArchiveManifests(dataRoot(), { projectId: project.id }) });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
