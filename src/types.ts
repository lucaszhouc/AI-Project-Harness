export type AgentId = "codex" | "claude" | "hermes";
export type SessionPolicy = "auto" | "warm" | "disposable";
export type TaskStatus = "backlog" | "ready" | "in_progress" | "awaiting_user" | "awaiting_result" | "review" | "changes_requested" | "accepted" | "failed" | "timed_out";
export type SectionKind = "main" | "reusable" | "one-shot";
export type SectionStatus = "idle" | "running" | "awaiting_approval" | "closed" | "archived";
export type CodexProjectSyncState = "not-created" | "desktop-registered" | "desktop-restart-required";
export interface Evidence {
  type: string;
  value: string;
}

export interface KnowledgeSource {
  evidenceId: string;
  quote: string;
  role?: "user" | "assistant" | "action" | "unknown";
  threadId?: string;
  turnId?: string;
}

export interface KnowledgeRule {
  id: string;
  type: "rule";
  status: "pending" | "accepted" | "rejected" | "active";
  title: string;
  scope: "task" | "project" | "domain" | "global";
  kind: "must" | "must_not" | "prefer" | "exception";
  statement: string;
  rationale?: string;
  trigger?: string;
  exceptions?: string[];
  confidence?: "low" | "medium" | "high";
  sources: KnowledgeSource[];
  rejectionReason?: string;
}

export interface PlaybookStep {
  order: number;
  action: string;
  validation?: string;
  failure?: string;
  sources: KnowledgeSource[];
}

export interface KnowledgePlaybook {
  id: string;
  type: "playbook";
  status: "pending" | "accepted" | "rejected" | "active";
  version: number;
  title: string;
  scope: "task" | "project" | "domain" | "global";
  trigger: string;
  purpose: string;
  prerequisites?: string[];
  prohibitions?: string[];
  exceptions?: string[];
  confidence?: "low" | "medium" | "high";
  steps: PlaybookStep[];
  sources?: KnowledgeSource[];
  rejectionReason?: string;
}

export type KnowledgeCandidate = KnowledgeRule | KnowledgePlaybook;

export interface CandidateResult {
  summary: string;
  completed: string[];
  remaining: string[];
  nextStep: string;
  acceptance: Array<{ criterion: string; status: string }>;
  evidence: Evidence[];
}

export interface Task {
  id: string;
  title: string;
  workstream: string;
  criteria: string[];
  agent: AgentId;
  sessionPolicy: SessionPolicy;
  status: TaskStatus;
  baseRevision: number;
  contractRevision?: number;
  createdAt: string;
  sectionId?: string;
  reviewMode?: "user" | "auto";
  priority?: "low" | "normal" | "high" | "urgent";
  dependsOn?: string[];
  sessionId?: string;
  /** Previous terminal runs retained when a timed-out/failed task is retried. */
  runHistory?: Array<Record<string, unknown>>;
  acceptedAt?: string;
  launchError?: string;
  run?: {
    id: string;
    sessionId: string;
    baseRevision: number;
    contractRevision?: number;
    startedAt: string;
    leaseStartedAt?: string;
    timeoutAt?: string;
    timeoutReason?: string;
    reportedStatus?: string;
    reportedAt?: string;
    status?: "starting" | "running" | "imported" | "completed" | "awaiting_review" | "awaiting_user" | "failed" | "timed_out" | "disconnected";
    phase?: string;
    progress?: number;
    processId?: number;
    eventCount?: number;
    lastEvent?: string;
    lastEventAt?: string;
    completedAt?: string;
    error?: string;
    resultSource?: "manual" | "agent-auto";
    reviewSessionId?: string;
    submittedAt?: string;
    externalThreadId?: string;
    externalTurnId?: string;
    externalAgent?: AgentId;
    externalProjectId?: string;
    desktopOpened?: boolean;
    userActionRequired?: boolean;
    /** Exact prompt prepared for a visible Codex handoff; survives clipboard changes. */
    userPrompt?: string;
    transcriptPath?: string;
    transcriptBytes?: number;
    archiveManifestId?: string;
    archiveSha256?: string;
  };
  candidate?: CandidateResult;
  rejectedCandidate?: CandidateResult;
  /** Full, bounded harness-import payload held behind the user review gate. */
  importCandidate?: Record<string, unknown>;
  rejectedImportCandidate?: Record<string, unknown>;
  importCandidateHash?: string;
  importAppliedAt?: string;
  review?: {
    status: "queued" | "approved" | "changes_requested" | "inconclusive" | "legacy_unverified";
    agent: AgentId | "rule-checker" | "user";
    rulesPassed?: boolean;
    evidenceVerified?: boolean;
    sessionId?: string;
    queuedAt?: string;
    reviewedAt?: string;
    acceptedAt?: string;
    notes?: string;
    automatic?: boolean;
  };
}

export interface Session {
  id: string;
  role?: "cto" | "review" | "task" | "conversation";
  title?: string;
  agent: AgentId;
  type: "warm" | "disposable";
  status: "warm" | "executing" | "awaiting_review" | "awaiting_result" | "retired";
  workstream: string;
  cursor: number;
  taskIds: string[];
  acceptedTaskCount?: number;
  maxAcceptedTasks?: number;
  maxRevisionLag?: number;
  createdAt: string;
  externalThreadId?: string;
  externalProjectId?: string;
  externalThreadStatus?: "pending" | "bound" | "ready" | "failed";
  externalThreadError?: string;
  lastReviewedAt?: string;
  lastOpenRequestedAt?: string;
  lastBoundAt?: string;
  lastOpenedAt?: string;
  pendingDraftPath?: string;
  lastUsedAt?: string;
  retiredReason?: string;
}

export interface Section {
  id: string;
  name: string;
  kind: SectionKind;
  role?: "steward" | "worker";
  agent: AgentId;
  status: SectionStatus | string;
  reusable?: boolean;
  approvalMode?: "user" | "auto";
  maxTasks?: number;
  maxContextChars?: number;
  taskIds: string[];
  useCount?: number;
  revision?: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  archivedAt?: string;
}

export interface ContextPacketMeta {
  path: string;
  hash: string;
  chars: number;
  revision: number;
  generatedAt: string;
}

export interface Checkpoint {
  id: string;
  parentRevision: number;
  revision: number;
  taskId: string;
  summary: string;
  nextStep: string;
  evidence: Evidence[];
  completed?: string[];
  remaining?: string[];
  source?: { agent?: AgentId; sessionId?: string; threadId?: string; turnId?: string };
  acceptedAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  status: string;
  revision: number;
  contractRevision?: number;
  goal: string;
  objective: { id: string; title: string; status: string };
  source?: { kind: string; label: string };
  /** How this project entered Harness; blank projects have no external data. */
  codexImport?: {
    status: "queued" | "preparing" | "running" | "awaiting_review" | "completed" | "failed";
    codexProjectId: string;
    requestedAt: string;
    taskId?: string;
    completedAt?: string;
    startedAt?: string;
    candidateAt?: string;
    candidateHash?: string;
    /** Content-addressed identity of the manually checked source set. */
    selectionKey?: string;
    sourceName?: string;
    sourceRoots?: string[];
    sourceThreads?: Array<{ id: string; name?: string; updatedAt?: number | string; recencyAt?: number | string; match?: string; score?: number; searchSnippet?: string; matchedTerms?: string[]; archived?: boolean }>;
    sourceThreadCount?: number;
    archiveStatus?: "running" | "completed" | "partial";
    archivedThreadCount?: number;
    archiveFailureCount?: number;
    archiveMissingCount?: number;
    archiveCompletedAt?: string;
    archiveQueue?: Array<{ id: string; name?: string; path: string }>;
    sourceGeneratedAt?: string;
    sourceLatestAt?: string;
    threadId?: string;
    failedAt?: string;
    detail?: string;
    error?: string;
    search?: { supported?: boolean; fallback?: boolean; occurrenceSupported?: boolean; terms?: string[]; occurrenceCount?: number; occurrences?: Array<Record<string, unknown>>; errors?: Array<Record<string, unknown>> };
  };
  techStack?: string[];
  profile?: { root: string; stack: string[]; markers: string[]; scripts: string[]; entrypoints: string[]; packageManager?: string; inspectedAt: string };
  constraints?: string[];
  gitPolicy?: { mode: string; commitOnAccept: boolean };
  archive?: { archivedAt: string; reason: string };
  ledger?: { path: string; manifestPath?: string; hash: string; chars: number; revision: number; generatedAt: string };
  archiveManifests?: Array<Record<string, unknown>>;
  knowledgeEvidence?: { path: string; sha256: string; bytes: number; userEvidenceCount: number; agentEvidenceCount: number; actionCount: number; episodeCount: number; failureCount?: number; indexedThreadCount?: number; selectedThreadCount?: number };
  knowledgeCandidates?: KnowledgeCandidate[];
  ruleCards?: KnowledgeRule[];
  playbooks?: KnowledgePlaybook[];
  githubSnapshot?: GitHubState;
  blockers?: string[];
  decisions?: Array<string | { id?: string; title?: string; summary?: string; detail?: string; status?: string; rationale?: string; source?: string; createdAt?: string }>;
  controlSessions?: { ctoId: string; reviewId: string };
  codexProjectId?: string;
  codexProjectSync?: {
    state: CodexProjectSyncState;
    officialProjectId?: string;
    checkedAt: string;
    detail?: string;
  };
  codexConnectedAt?: string;
  codexSyncError?: { message: string; stage: string; at: string; retryable?: boolean };
  contextPackets?: { cto: ContextPacketMeta; review: ContextPacketMeta };
  tasks: Task[];
  sessions: Session[];
  sections?: Section[];
  checkpoints: Checkpoint[];
  events?: Array<{ id: string; type: string; at: string; detail?: string }>;
  updatedAt: string;
  gitSnapshot?: GitState;
}

export interface GitState {
  available: boolean;
  error?: string;
  detail?: string;
  root?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  changeCount?: number;
  changes?: Array<{ code: string; file: string }>;
  commits?: Array<{ hash: string; shortHash: string; subject: string; author: string; date: string }>;
  branches?: Array<{ name: string; current: boolean }>;
  tags?: string[];
  checkedAt: string;
}

export interface GitHubState {
  available: boolean;
  error?: string;
  detail?: string;
  checkedAt: string;
  detailsLoaded?: boolean;
  remote?: { owner: string; name: string; nameWithOwner: string; url: string } | null;
  remoteName?: string;
  repository?: Record<string, unknown> | null;
  pullRequests?: Array<Record<string, unknown>>;
  issues?: Array<Record<string, unknown>>;
  gh?: { available: boolean; authenticated?: boolean; error?: string; [key: string]: unknown };
}

export interface Snapshot {
  sequence?: number;
  state: {
    schemaVersion: number;
    selectedProjectId: string;
    projects: Project[];
    recovery?: { mode: string; status: string; detail?: string; source?: string; skippedCorruptJournalLines?: number; recoveredAt?: string };
  };
  git: Record<string, GitState>;
  github?: Record<string, GitHubState>;
  archives?: Record<string, Array<Record<string, unknown>>>;
  health?: Record<string, { status: string; checks: Record<string, boolean | string>; failures: string[]; checkedAt: string }>;
  overview?: Record<string, { projectId: string; status: string; revision: number; taskCounts: Record<string, number>; sectionCounts: Record<string, number>; conversationCount?: number; latestCheckpoint?: Checkpoint | null; latestEvent?: Record<string, unknown> | null; activeObjective?: Project["objective"] | null; github?: { repository?: unknown; pullRequests: number; issues: number } | null }>;
  window?: { alwaysOnTop: boolean };
  agents: Record<AgentId, { installed: boolean; path: string; label?: string; mode?: string; capabilities?: string[]; bridge?: string }>;
  platform: string;
  platformCapabilities?: { platform: string; label: string; commandShim: boolean; deepLink: boolean; portable: boolean; status: string };
  storage?: { root: string; statePath: string; journalPath: string; archiveRoot?: string; sqlitePath?: string; sqlite?: { available: boolean; path?: string; projects?: number; tasks?: number; checkpoints?: number; events?: number; error?: string } };
}

export interface HarnessApi {
  snapshot(): Promise<Snapshot>;
  addProjectByName(name: string): Promise<{
    snapshot: Snapshot;
    projectId: string;
    taskId: string;
    threadId: string;
    desktopOpened: boolean;
    desktopError?: string;
    desktopWarning?: { message: string; errorId?: string };
    desktopProjectRestartRequired?: boolean;
    desktopProjectWarning?: string;
    matchedProjectName: string;
    match: { query: string; score: number; kind: string };
  }>;
  createBlankProject(input: { name: string; path?: string; goal?: string; objective?: string; techStack?: string[]; constraints?: string[]; operationId?: string; targetFingerprint?: string; confirmedAt?: string } | string): Promise<{ projectId: string; codexProjectId?: string; ctoThreadId?: string; desktopOpened?: boolean; blankOnly?: boolean; initializationRequired?: boolean; snapshot: Snapshot }>;
  createConnectedProject(input: { name: string; path?: string; goal?: string; objective?: string; techStack?: string[]; constraints?: string[] } | string): Promise<{ projectId: string; snapshot: Snapshot; codexProjectId?: string; controlThreadCount?: number }>;
  connectCodexProject(projectId: string, input?: { operationId?: string; targetFingerprint?: string; confirmedAt?: string; path?: string }): Promise<{ projectId: string; snapshot: Snapshot; codexProjectId?: string; desktopOpened?: boolean; initializationRequired?: boolean }>;
  importCodexProject(input: { name?: string; projectName?: string; codexProjectId?: string; targetProjectId?: string; harnessProjectId?: string; path?: string; root?: string }): Promise<{ projectId: string; taskId: string; threadId?: string; reused: boolean; status: string; userActionRequired?: boolean; executionOwner?: string; conversationPrompt?: string; navigation?: { opened?: boolean; capability?: string; requestAccepted?: boolean; verified?: boolean; error?: string }; matchedProjectName?: string; match?: { query: string; score: number; kind: string; matchedName?: string }; desktopOpened: boolean; desktopError?: string; desktopProjectRestartRequired?: boolean; snapshot: Snapshot }>;
  listCodexConversations(): Promise<import("./conversation-picker.mjs").CodexConversationIndex>;
  importCodexConversations(input: { name: string; goal?: string; threadIds: string[]; targetProjectId?: string }): Promise<{ projectId: string; taskId: string; threadId?: string; reused: boolean; status: string; userActionRequired?: boolean; executionOwner?: string; conversationPrompt?: string; navigation?: { opened?: boolean; capability?: string; requestAccepted?: boolean; verified?: boolean; error?: string }; selectedThreadCount: number; desktopOpened: boolean; desktopError?: string; snapshot: Snapshot }>;
  acceptKnowledgeCandidate(projectId: string, candidateId: string): Promise<Snapshot>;
  rejectKnowledgeCandidate(projectId: string, candidateId: string, reason?: string): Promise<Snapshot>;
  onProjectOnboardingProgress(listener: (progress: { stage: string; progress?: number; label: string; detail?: string }) => void): () => void;
  showErrorLog(): Promise<{ opened: boolean; path: string }>;
  reportRendererError(details: { message: string; stack?: string; stage: string }): Promise<{ errorId: string }>;
  selectProject(projectId: string): Promise<Snapshot>;
  createTask(projectId: string, input: Record<string, unknown>): Promise<Snapshot>;
  dispatchTask(projectId: string, taskId: string): Promise<{ snapshot: Snapshot; missionPacket?: string; userActionRequired?: boolean; agent?: AgentId; threadId?: string; navigation?: { opened?: boolean; capability?: string; requestAccepted?: boolean; verified?: boolean; error?: string } }>;
  stopTask(projectId: string, taskId: string): Promise<Snapshot>;
  submitTaskResult(projectId: string, taskId: string, result: CandidateResult): Promise<Snapshot>;
  acceptTaskResult(projectId: string, taskId: string): Promise<Snapshot>;
  requestChanges(projectId: string, taskId: string): Promise<Snapshot>;
  rejectTask(projectId: string, taskId: string, reason?: string): Promise<Snapshot>;
  copyMissionPacket(projectId: string, taskId: string): Promise<{ copied: boolean; packet: string }>;
  refreshGit(projectId: string): Promise<Snapshot>;
  refreshGitHub(projectId: string): Promise<Snapshot>;
  setGitRemote(projectId: string, remoteUrl: string, name?: string): Promise<{ remote: { name: string; url: string }; snapshot: Snapshot }>;
  setProjectStatus(projectId: string, status: string): Promise<Snapshot>;
  archiveProject(projectId: string, reason?: string): Promise<Snapshot>;
  removeProject(projectId: string, reason?: string): Promise<{ removedProjectId: string; archivePath: string; snapshot: Snapshot }>;
  restoreProject(projectId: string): Promise<Snapshot>;
  updateProjectContract(projectId: string, input: Record<string, unknown>): Promise<Snapshot>;
  listTemplates(): Promise<Array<{ id: string; label: string; goal: string; techStack: string[]; constraints: string[]; tasks: string[] }>>;
  applyTemplate(projectId: string, templateId: string): Promise<Snapshot>;
  refreshProjectProfile(projectId: string): Promise<Snapshot>;
  createObjective(projectId: string, input: Record<string, unknown>): Promise<Snapshot>;
  setObjectiveStatus(projectId: string, status: string): Promise<Snapshot>;
  projectActivity(projectId: string, limit?: number): Promise<Array<{ kind: string; at: string; type: string; detail?: string; revision?: number; id: string }>>;
  addDecision(projectId: string, input: Record<string, unknown>): Promise<Snapshot>;
  createSection(projectId: string, input: Record<string, unknown>): Promise<Snapshot>;
  assignTaskToSection(projectId: string, taskId: string, sectionId: string): Promise<Snapshot>;
  closeSection(projectId: string, sectionId: string, reason?: string): Promise<Snapshot>;
  archiveSection(projectId: string, sectionId: string, reason?: string): Promise<Snapshot>;
  importArchive(projectId: string, filePath?: string): Promise<{ canceled?: boolean; deduplicated?: boolean; snapshot: Snapshot; manifest?: Record<string, unknown> }>;
  listArchives(projectId: string): Promise<Array<Record<string, unknown>>>;
  verifyArchive(projectId: string, hash: string): Promise<{ valid: boolean; bytes: number; sha256: string }>;
  openArchive(projectId: string): Promise<{ opened: boolean; path: string; error?: string }>;
  openRunArchive(projectId: string, taskId: string): Promise<{ opened: boolean; path: string; error?: string }>;
  openLedger(projectId: string): Promise<{ opened: boolean; path: string; error?: string }>;
  openProjectPath(projectId: string): Promise<{ opened: boolean; path: string; error?: string }>;
  toggleWindowPin(): Promise<{ alwaysOnTop: boolean; snapshot: Snapshot }>;
  newProjectConversation(projectId: string, input?: { title?: string; type?: "warm" | "disposable"; agent?: AgentId }): Promise<{ opened: boolean; supported: boolean; capability: string; message: string; threadId?: string; snapshot: Snapshot; error?: string }>;
  openProjectSession(projectId: string, sessionId: string): Promise<{ opened: boolean; supported: boolean; capability?: string; message: string; threadId?: string; snapshot: Snapshot; error?: string }>;
  exportProject(projectId: string, filePath?: string): Promise<{ canceled?: boolean; path?: string; sha256?: string; snapshot: Snapshot }>;
  importProject(filePath?: string): Promise<{ canceled?: boolean; path?: string; snapshot: Snapshot }>;
  openCodexProject(projectId: string): Promise<{
    opened: boolean;
    supported: boolean;
    capability: string;
    message: string;
    threadId?: string;
    snapshot: Snapshot;
    error?: string;
  }>;
  syncCodexProject(projectId: string): Promise<Snapshot>;
  openAgentTask(projectId: string, taskId: string): Promise<{
    opened: boolean;
    supported: boolean;
    capability: string;
    message: string;
    threadId?: string;
    snapshot: Snapshot;
    error?: string;
  }>;
  openTaskWorkspace(projectId: string, taskId: string): Promise<{ opened: boolean; path: string; agent: AgentId; error?: string }>;
  openCto(projectId: string): Promise<{
    opened: boolean;
    supported: boolean;
    capability: string;
    message: string;
    threadId?: string;
    packetPath?: string;
    draftReference?: string;
    snapshot: Snapshot;
    error?: string;
  }>;
  attachControlThread(projectId: string, role: "cto" | "review", input: { threadId: string; externalProjectId?: string; codexProjectId?: string; packetPath?: string; expectedThreadId?: string }): Promise<{ attached: boolean; verified: boolean; role: "cto" | "review"; threadId: string; snapshot: Snapshot }>;
  onAgentRuntimeUpdate(listener: (update: { snapshot: Snapshot; event?: { type?: string; detail?: string } }) => void): () => void;
  onArchiveProgress(listener: (progress: { projectId: string; bytes: number; maxBytes?: number; source?: string; done?: boolean }) => void): () => void;
}

declare global {
  interface Window {
    harness: HarnessApi;
  }
}
