# AI Project Harness

> Local-first project continuity for coding agents on Windows.

**Git versions the code. Harness versions the intent.**

Harness keeps project goals, tasks, decisions, reviews, checkpoints, and evidence outside any single conversation. Accepted project state survives conversation changes and application restarts.

[中文说明](README.zh-CN.md) · [Current repair status](docs/CURRENT_REPAIR_STATUS.md) · [Development](DEVELOPMENT.md) · [MIT License](LICENSE)

## Current source status

This is an **unfinished Desktop-native repair**, version `0.0.25-rc.6`. This source update does not publish a release or replace an existing executable. Packaging remains blocked until the real Desktop creation, readback, and writeback chain is verified.

- Production integration uses Codex Desktop native deep links. Codex CLI, app-server execution, and background-provider fallbacks have been removed.
- An empty project requests Review/CTO drafts. A nonempty project first prepares an initialization task; after its result is accepted and context files are written, Harness requests the remaining standard drafts.
- Deep links prefill drafts; they do not automatically send a turn or return a new thread ID. Harness has not yet connected the Desktop-native transport needed to create threads automatically, verify project membership, monitor turns, and write results back.
- A supplied thread ID is recorded as `bound`, not verified or ready. Local state, an accepted deep-link request, and an existing Desktop thread are separate evidence.
- Desktop history search, selection, and import remain blocked where the required native connection is unavailable. No command-line fallback is used.

## Available local workflow

1. Create or connect a Harness project and select its directory.
2. For a nonempty project, prepare its initialization draft. Retry keeps the task and Run identity consistent.
3. Review and accept submitted results before advancing project state. Accepting initialization writes the context used by standard conversation drafts.
4. Create a task, then explicitly dispatch its Desktop handoff when ready. A saved task or draft is not proof that an Agent is running.
5. Inspect the workspace and evidence before accepting a result. Acceptance advances Harness HEAD; it does not automatically commit or push Git changes. Rejecting a result does not undo file edits.

## Development and verification

Use Node.js 24 on Windows:

```powershell
npm ci
npm run check:local
npm run smoke:renderer
npm run smoke:app
npm run smoke:mcp-e2e
```

The Electron and MCP smokes use isolated profiles and intercept outgoing Desktop deep links. They verify Harness behavior, not live Desktop thread creation. See [DEVELOPMENT.md](DEVELOPMENT.md) for isolated startup and packaging gates. Older guides and whitepapers are retained as historical material; the current repair status takes precedence.

## Privacy

Harness does not request Codex account credentials. Its local control endpoint has a generated authentication token; do not publish that endpoint file, project state, transcripts, or test profiles. Public docs synchronization uses package metadata only. See [Security and privacy](docs/security-and-privacy.md).

## Release status

<!-- APH_AUTO_STATUS_START -->
- Package version: v0.0.25-rc.6
- Release status: local candidate; no public release is implied.
- Project names and host state are intentionally excluded.
<!-- APH_AUTO_STATUS_END -->

Existing [GitHub releases](https://github.com/lucaszhouc/AI-Project-Harness/releases) are separate historical artifacts and do not contain this unqualified repair unless explicitly stated.

Maintained by [@lucaszhouc](https://github.com/lucaszhouc). Contact: [lucaszhouc@gmail.com](mailto:lucaszhouc@gmail.com).
