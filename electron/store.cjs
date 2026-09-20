const fs = require("node:fs");
const path = require("node:path");
const machine = require("./state-machine.cjs");
const { persistContextPackets } = require("./context-packets.cjs");
const { persistProjectLedger } = require("./project-ledger.cjs");
const { listArchiveManifests } = require("./archive.cjs");
const { syncSqliteIndex } = require("./sqlite-index.cjs");
const { acquireStateLock, releaseStateLock } = require("./state-lock.cjs");

function autoReviewLegacyCandidates(state) {
  let changed = false;
  for (const project of state?.projects || []) {
    for (const task of project.tasks || []) {
      // Profiles created before Review Agent automation have a candidate in
      // `review` without review metadata. Re-run the same deterministic review
      // path used for live harness-result events during startup migration.
      if (task.status !== "review" || !task.candidate || task.review) continue;
      try {
        machine.autoReviewTaskResult(state, project.id, task.id);
        changed = true;
      } catch {
        // Keep the legacy candidate visible if its schema is incomplete; the
        // normal recovery UI can still surface and repair it.
      }
    }
  }
  return changed;
}

class HarnessStore {
  constructor(filePath, projectPath, options = {}) {
    this.filePath = filePath;
    this.projectPath = projectPath;
    this.journalPath = options.journalPath || `${filePath}.jsonl`;
    this.persistJournal = options.persistJournal !== false;
    this.journalMaxBytes = Number(options.journalMaxBytes || 16 * 1024 * 1024);
    this.journalRotations = Number(options.journalRotations || 3);
    this.contextRoot = options.contextRoot;
    this.sqlitePath = options.sqlitePath;
    // Long-lived profiles must keep their derived history bounded by default;
    // callers may explicitly disable this only for migration/debug fixtures.
    this.boundHistory = options.boundHistory !== false;
    this.initialStateMode = options.initialStateMode === "empty" ? "empty" : "self-hosted-fixture";
    this.lockPath = options.lockPath || `${this.filePath}.lock`;
    this.lockTimeoutMs = Number(options.lockTimeoutMs || 8000);
    this.lockStaleMs = Number(options.lockStaleMs || 30000);
    this._lock = undefined;
    this.state = this.load();
    this.lastKnownMtimeMs = this.readMtime();
    if (this.contextRoot) {
      let archiveChanged = false;
      for (const project of this.state.projects || []) {
        const manifests = listArchiveManifests(this.contextRoot, { projectId: project.id });
        if (JSON.stringify(project.archiveManifests || []) !== JSON.stringify(manifests)) {
          project.archiveManifests = manifests;
          archiveChanged = true;
        }
      }
      if (archiveChanged) this.write(this.state);
    }
    if (autoReviewLegacyCandidates(this.state)) this.write(this.state);
    // Existing profiles may predate context packets. Generate them once at
    // startup so every project has a durable CTO and bounded Review packet.
    if (this.contextRoot && persistContextPackets(this.state, this.contextRoot)) this.write(this.state);
    if (this.sqlitePath) {
      try { this.sqliteStatus = syncSqliteIndex(this.sqlitePath, this.state); } catch { this.sqliteStatus = { available: false, path: this.sqlitePath }; }
    }
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      const recovered = this.recoverFromJournal();
      if (recovered) {
        this.write(recovered);
        return recovered;
      }
      const initial = this.initialStateMode === "empty" ? machine.createEmptyState() : machine.createInitialState(this.projectPath);
      this.write(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) throw new Error("Unsupported state schema");
      let migrated = false;
      for (const project of parsed.projects) {
        project.tasks ||= [];
        project.sessions ||= [];
        project.checkpoints ||= [];
        project.decisions ||= [];
        project.events ||= [];
        project.objective ||= { id: require("node:crypto").randomUUID(), title: "建立第一个可验收任务", status: "active" };
        const before = JSON.stringify(project.controlSessions || null);
        machine.ensureProjectControlSessions(project);
        const beforeSections = JSON.stringify(project.sections || null);
        const beforeShape = JSON.stringify({ status: project.status, techStack: project.techStack, constraints: project.constraints, gitPolicy: project.gitPolicy, objectives: project.objectives, tasks: project.tasks, sections: project.sections });
        machine.ensureProjectSections(project);
        machine.ensureObjectives(project);
        project.status ||= "active";
        project.techStack ||= [];
        project.constraints ||= [];
        project.gitPolicy ||= { mode: "evidence-only", commitOnAccept: false };
        project.gitPolicy.mode ||= "evidence-only";
        project.gitPolicy.commitOnAccept = Boolean(project.gitPolicy.commitOnAccept);
        if (project.codexProjectId && !String(project.codexProjectId).startsWith("local-") && !project.codexProjectSync) {
          machine.setCodexProjectSync(parsed, project.id, {
            officialProjectId: project.codexProjectId,
            checkedAt: project.updatedAt,
          });
          migrated = true;
        }
        for (const task of project.tasks || []) {
          task.reviewMode ||= "user";
          if (!["codex", "claude", "hermes"].includes(task.agent)) task.agent = "codex";
        }
        for (const section of project.sections || []) {
          section.taskIds ||= [];
          section.approvalMode ||= "user";
          section.status ||= "idle";
          section.maxTasks ||= section.kind === "one-shot" ? 1 : 20;
          section.maxContextChars ||= 12000;
        }
        for (const session of project.sessions || []) {
          session.taskIds ||= [];
          session.maxAcceptedTasks ||= 5;
          session.maxRevisionLag ||= 3;
          session.acceptedTaskCount ||= 0;
        }
        if (this.boundHistory) {
          const beforeHistory = JSON.stringify({ events: project.events, checkpoints: project.checkpoints, decisions: project.decisions, objectives: project.objectives, sessions: project.sessions });
          machine.boundProjectHistory(project);
          if (beforeHistory !== JSON.stringify({ events: project.events, checkpoints: project.checkpoints, decisions: project.decisions, objectives: project.objectives, sessions: project.sessions })) migrated = true;
        }
        for (const session of project.sessions) {
          if (!session.role) {
            session.role = session.id === project.controlSessions?.ctoId ? "cto"
              : session.id === project.controlSessions?.reviewId ? "review" : "task";
            migrated = true;
          }
        }
        if (before !== JSON.stringify(project.controlSessions || null)) migrated = true;
        if (beforeSections !== JSON.stringify(project.sections || null)) migrated = true;
        if (beforeShape !== JSON.stringify({ status: project.status, techStack: project.techStack, constraints: project.constraints, gitPolicy: project.gitPolicy, objectives: project.objectives, tasks: project.tasks, sections: project.sections })) migrated = true;
      }
      if (migrated) this.write(parsed);
      return parsed;
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try { fs.renameSync(this.filePath, backup); } catch {
        // Keep going when a profile is read-only; journal/seed recovery below
        // still gives the user a usable local state instead of a crash.
      }
      const recovered = this.recoverFromJournal();
      if (recovered) {
        this.write(recovered);
        return recovered;
      }
      const initial = this.initialStateMode === "empty" ? machine.createEmptyState() : machine.createInitialState(this.projectPath);
      this.write(initial);
      return initial;
    }
  }

  readMtime() {
    try { return fs.statSync(this.filePath).mtimeMs; } catch { return 0; }
  }

  /** Reload a state written by the standalone CLI/MCP bridge. Atomic rename
   * means the reader sees either the old or new complete snapshot. */
  reloadExternal(force = false) {
    const mtime = this.readMtime();
    if (!mtime || (!force && mtime <= Number(this.lastKnownMtimeMs || 0))) return false;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) return false;
      for (const project of parsed.projects) {
        project.tasks ||= [];
        project.sessions ||= [];
        project.checkpoints ||= [];
        project.decisions ||= [];
        project.events ||= [];
        project.status ||= "active";
        project.techStack ||= [];
        project.constraints ||= [];
        project.gitPolicy ||= { mode: "evidence-only", commitOnAccept: false };
        if (project.codexProjectId && !String(project.codexProjectId).startsWith("local-") && !project.codexProjectSync) {
          machine.setCodexProjectSync(parsed, project.id, { officialProjectId: project.codexProjectId, checkedAt: project.updatedAt });
        }
        machine.ensureProjectControlSessions(project);
        machine.ensureProjectSections(project);
        machine.ensureObjectives(project);
        for (const task of project.tasks) task.reviewMode ||= "user";
        for (const section of project.sections || []) { section.taskIds ||= []; section.approvalMode ||= "user"; }
        if (this.boundHistory) machine.boundProjectHistory(project);
      }
      // Preserve the object identity held by active Agent monitors while
      // replacing its complete contents with the external snapshot.
      for (const key of Object.keys(this.state || {})) delete this.state[key];
      Object.assign(this.state, parsed);
      this.lastKnownMtimeMs = mtime;
      return true;
    } catch {
      return false;
    }
  }

  recoverFromJournal() {
    const candidates = [this.journalPath, ...Array.from({ length: this.journalRotations }, (_, index) => `${this.journalPath}.${index + 1}`)];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/).filter(Boolean);
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const entry = JSON.parse(lines[index]);
          if (entry?.state?.schemaVersion === 1 && Array.isArray(entry.state.projects)) return entry.state;
        }
      } catch {
        // Try the next rotated journal; a truncated tail must not block recovery.
      }
    }
    return undefined;
  }

  write(nextState = this.state) {
    const lock = this._lock ? undefined : acquireStateLock(this.lockPath, { timeoutMs: this.lockTimeoutMs, staleMs: this.lockStaleMs });
    try {
      this._writeUnlocked(nextState);
    } finally {
      if (lock) releaseStateLock(lock);
    }
  }

  _writeUnlocked(nextState = this.state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (this.boundHistory) for (const project of nextState.projects || []) machine.boundProjectHistory(project);
    if (this.contextRoot) {
      try {
        persistContextPackets(nextState, this.contextRoot);
      } catch {
        // Context projections are derived artifacts. A failed projection must
        // never prevent the primary state and replay journal from being saved.
      }
      try {
        persistProjectLedger(nextState, this.contextRoot);
      } catch {
        // The detached ledger is a derived view; state durability wins if the
        // data disk is temporarily unavailable.
      }
    }
    const serialized = `${JSON.stringify(nextState, null, 2)}\n`;
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, serialized, "utf8");
    fs.renameSync(temporary, this.filePath);
    this.lastKnownMtimeMs = this.readMtime();
    if (this.persistJournal) {
      try {
        const line = `${JSON.stringify({ at: new Date().toISOString(), schemaVersion: nextState.schemaVersion, state: nextState })}\n`;
        let size = 0;
        try { size = fs.statSync(this.journalPath).size; } catch {}
        if (size + Buffer.byteLength(line, "utf8") > this.journalMaxBytes) {
          const oldest = `${this.journalPath}.${this.journalRotations + 1}`;
          if (fs.existsSync(oldest)) { try { fs.rmSync(oldest, { force: true }); } catch {} }
          for (let index = this.journalRotations - 1; index >= 1; index -= 1) {
            const from = `${this.journalPath}.${index}`;
            const to = `${this.journalPath}.${index + 1}`;
            if (fs.existsSync(from)) {
              try { fs.renameSync(from, to); } catch {}
            }
          }
          if (fs.existsSync(this.journalPath)) {
            try { fs.renameSync(this.journalPath, `${this.journalPath}.1`); } catch {}
          }
        }
        fs.appendFileSync(this.journalPath, line, "utf8");
      } catch {
        // A journal failure must not make the primary state write disappear.
      }
    }
    if (this.sqlitePath) {
      try { this.sqliteStatus = syncSqliteIndex(this.sqlitePath, nextState); } catch { this.sqliteStatus = { available: false, path: this.sqlitePath }; }
    }
  }

  update(mutator) {
    const lock = acquireStateLock(this.lockPath, { timeoutMs: this.lockTimeoutMs, staleMs: this.lockStaleMs });
    this._lock = lock;
    try {
      // Always transact against the newest complete snapshot. Atomic rename
      // makes this read all-or-nothing while the lock prevents another
      // Harness writer from changing it before our write.
      this.reloadExternal(true);
      const result = mutator(this.state);
      this._writeUnlocked(this.state);
      return result;
    } finally {
      this._lock = undefined;
      releaseStateLock(lock);
    }
  }
}

module.exports = { HarnessStore };
