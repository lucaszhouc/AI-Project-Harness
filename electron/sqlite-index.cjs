const fs = require("node:fs");
const path = require("node:path");

function openDatabase(filePath) {
  try {
    // Node 24 exposes node:sqlite; Electron builds that do not ship it simply
    // use the existing JSON source of truth and report this projection as
    // unavailable.
    const { DatabaseSync } = require("node:sqlite");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, status TEXT, revision INTEGER, updated_at TEXT, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT, title TEXT, section_id TEXT, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT, kind TEXT, status TEXT, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER, accepted_at TEXT, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, at TEXT, type TEXT, detail TEXT, payload_json TEXT NOT NULL);
    `);
    return db;
  } catch {
    return undefined;
  }
}

function syncSqliteIndex(filePath, state) {
  if (!filePath || !state?.projects) return { available: false, path: filePath };
  const db = openDatabase(filePath);
  if (!db) return { available: false, path: filePath };
  try {
    const insertProject = db.prepare("INSERT INTO projects (id,name,path,status,revision,updated_at,payload_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,status=excluded.status,revision=excluded.revision,updated_at=excluded.updated_at,payload_json=excluded.payload_json");
    const insertTask = db.prepare("INSERT INTO tasks (id,project_id,status,title,section_id,payload_json) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,status=excluded.status,title=excluded.title,section_id=excluded.section_id,payload_json=excluded.payload_json");
    const insertSection = db.prepare("INSERT INTO sections (id,project_id,name,kind,status,payload_json) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,kind=excluded.kind,status=excluded.status,payload_json=excluded.payload_json");
    const insertCheckpoint = db.prepare("INSERT INTO checkpoints (id,project_id,revision,accepted_at,payload_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,revision=excluded.revision,accepted_at=excluded.accepted_at,payload_json=excluded.payload_json");
    const insertEvent = db.prepare("INSERT OR IGNORE INTO events (id,project_id,at,type,detail,payload_json) VALUES (?,?,?,?,?,?)");
    const apply = () => {
      for (const project of state.projects) {
        insertProject.run(project.id, project.name, project.path, project.status || "active", Number(project.revision || 0), project.updatedAt || "", JSON.stringify(project));
        for (const task of project.tasks || []) insertTask.run(task.id, project.id, task.status, task.title, task.sectionId || null, JSON.stringify(task));
        for (const section of project.sections || []) insertSection.run(section.id, project.id, section.name, section.kind, section.status, JSON.stringify(section));
        for (const checkpoint of project.checkpoints || []) insertCheckpoint.run(checkpoint.id, project.id, Number(checkpoint.revision || 0), checkpoint.acceptedAt || "", JSON.stringify(checkpoint));
        for (const event of project.events || []) insertEvent.run(event.id, project.id, event.at || "", event.type || "", event.detail || "", JSON.stringify(event));
      }
    };
    db.exec("BEGIN");
    try { apply(); db.exec("COMMIT"); } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    db.close();
    return { available: true, path: filePath };
  } catch (error) {
    try { db.close(); } catch {}
    return { available: false, path: filePath, error: String(error?.message || error) };
  }
}

function readSqliteSummary(filePath) {
  const db = openDatabase(filePath);
  if (!db) return { available: false, path: filePath };
  try {
    const summary = {
      available: true,
      path: filePath,
      projects: Number(db.prepare("SELECT COUNT(*) AS count FROM projects").get().count || 0),
      tasks: Number(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count || 0),
      checkpoints: Number(db.prepare("SELECT COUNT(*) AS count FROM checkpoints").get().count || 0),
      events: Number(db.prepare("SELECT COUNT(*) AS count FROM events").get().count || 0),
    };
    db.close();
    return summary;
  } catch (error) {
    try { db.close(); } catch {}
    return { available: false, path: filePath, error: String(error?.message || error) };
  }
}

module.exports = { openDatabase, syncSqliteIndex, readSqliteSummary };
