const fs = require("node:fs");
const path = require("node:path");
const machine = require("./state-machine.cjs");
const { persistContextPackets } = require("./context-packets.cjs");
const { persistProjectLedger } = require("./project-ledger.cjs");
const { listArchiveManifests } = require("./archive.cjs");
const { syncSqliteIndex } = require("./sqlite-index.cjs");
const { acquireStateLock, releaseStateLock } = require("./state-lock.cjs");

function protectLegacyCandidates(state) {
  let changed = false;
  for (const project of state?.projects || []) {
    for (const task of project.tasks || []) {
      // A storage migration may fill structure, but it must never create a new
      // business approval. Preserve old candidates for explicit user review.
      if (task.status !== "review" || !task.candidate || task.review) continue;
      task.review = {
        status: "legacy_unverified",
        agent: "codex",
        automatic: false,
        sessionId: project.controlSessions?.reviewId,
        reviewedAt: project.updatedAt,
        notes: "旧候选已保留，但迁移不会代替用户批准或补造验证证据。",
      };
      changed = true;
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
    this.lastKnownFingerprint = this.readFingerprint();
    this.lastCommittedState = structuredClone(this.state);
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
    if (protectLegacyCandidates(this.state)) this.write(this.state);
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
        if (!Number.isInteger(Number(project.contractRevision)) || Number(project.contractRevision) < 1) {
          project.contractRevision = 1;
          migrated = true;
        }
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
      let damagedProfilePath = this.filePath;
      try {
        fs.renameSync(this.filePath, backup);
        damagedProfilePath = backup;
      } catch {
        // Keep going when a profile is read-only; journal/seed recovery below
        // still gives the user a usable local state instead of a crash.
      }
      const recovered = this.recoverFromJournal();
      if (recovered) {
        this.write(recovered);
        return recovered;
      }
      const initial = this.initialStateMode === "empty" ? machine.createEmptyState() : machine.createInitialState(this.projectPath);
      initial.recovery = {
        mode: "safe-recovery",
        status: "unrecoverable",
        damagedProfilePath,
        detectedAt: new Date().toISOString(),
        detail: "检测到既有状态，但主文件和日志都无法恢复；已进入安全恢复模式，未把空状态冒充为原项目。",
      };
      this.write(initial);
      return initial;
    }
  }

  readMtime() {
    try { return fs.statSync(this.filePath).mtimeMs; } catch { return 0; }
  }

  readFingerprint() {
    try {
      const stat = fs.statSync(this.filePath);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "";
    }
  }

  replaceLiveState(nextState) {
    if (!this.state) {
      this.state = nextState;
      return;
    }
    for (const key of Object.keys(this.state)) delete this.state[key];
    Object.assign(this.state, nextState);
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
        project.contractRevision = Number.isInteger(Number(project.contractRevision)) && Number(project.contractRevision) > 0
          ? Number(project.contractRevision)
          : 1;
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
      this.lastKnownFingerprint = this.readFingerprint();
      this.lastCommittedState = structuredClone(parsed);
      return true;
    } catch {
      return false;
    }
  }

  recoverFromJournal() {
    const candidates = [this.journalPath, ...Array.from({ length: this.journalRotations }, (_, index) => `${this.journalPath}.${index + 1}`)];
    let skippedCorruptJournalLines = 0;
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      let lines;
      try {
        lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/).filter(Boolean);
      } catch {
        continue;
      }
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const entry = JSON.parse(lines[index]);
          if (entry?.state?.schemaVersion === 1 && Array.isArray(entry.state.projects)) {
            entry.state.recovery = {
              mode: "journal-recovery",
              status: "recovered",
              source: candidate,
              skippedCorruptJournalLines,
              recoveredAt: new Date().toISOString(),
            };
            return entry.state;
          }
        } catch {
          skippedCorruptJournalLines += 1;
        }
      }
    }
    return undefined;
  }

  write(nextState = this.state) {
    const lock = this._lock ? undefined : acquireStateLock(this.lockPath, { timeoutMs: this.lockTimeoutMs, staleMs: this.lockStaleMs });
    try {
      const fingerprint = this.readFingerprint();
      if (!this._lock && this.lastKnownFingerprint && fingerprint && fingerprint !== this.lastKnownFingerprint) {
        this.reloadExternal(true);
        throw new Error("STATE_CONFLICT: durable state changed since this writer last loaded it");
      }
      this._writeUnlocked(nextState);
      this.lastCommittedState = structuredClone(nextState);
    } catch (error) {
      if (this.lastCommittedState) this.replaceLiveState(structuredClone(this.lastCommittedState));
      throw error;
    } finally {
      if (lock) releaseStateLock(lock);
    }
  }

  _writeUnlocked(nextState = this.state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (this.boundHistory) for (const project of nextState.projects || []) machine.boundProjectHistory(project);
    const commitPrimary = (content, required) => {
      const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        fs.writeFileSync(temporary, content, "utf8");
        fs.renameSync(temporary, this.filePath);
        return true;
      } catch (error) {
        try { fs.rmSync(temporary, { force: true }); } catch {}
        if (required) throw error;
        return false;
      }
    };
    const committedSerialized = `${JSON.stringify(nextState, null, 2)}\n`;
    commitPrimary(committedSerialized, true);
    this.lastKnownMtimeMs = this.readMtime();
    this.lastKnownFingerprint = this.readFingerprint();
    if (this.contextRoot) {
      try {
        persistContextPackets(nextState, this.contextRoot);
      } catch {
        // Context projections are derived artifacts. A failed projection must
        // never turn an already committed primary state into a failed command.
      }
      try {
        persistProjectLedger(nextState, this.contextRoot);
      } catch {
        // The detached ledger is a derived view; state durability wins if the
        // data disk is temporarily unavailable.
      }
    }
    const projectedSerialized = `${JSON.stringify(nextState, null, 2)}\n`;
    if (projectedSerialized !== committedSerialized && commitPrimary(projectedSerialized, false)) {
      this.lastKnownMtimeMs = this.readMtime();
      this.lastKnownFingerprint = this.readFingerprint();
    }
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
      const draft = structuredClone(this.state);
      const result = mutator(draft);
      this._writeUnlocked(draft);
      this.replaceLiveState(draft);
      this.lastCommittedState = structuredClone(draft);
      return result;
    } finally {
      this._lock = undefined;
      releaseStateLock(lock);
    }
  }
}

module.exports = { HarnessStore };
