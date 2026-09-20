# AI Project Harness

> Local-first project continuity for coding agents on Windows.

[![Release](https://img.shields.io/github/v/release/lucaszhouc/AI-Project-Harness?include_prereleases)](https://github.com/lucaszhouc/AI-Project-Harness/releases/tag/v0.0.21-rc.1) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D4)](https://github.com/lucaszhouc/AI-Project-Harness/releases/tag/v0.0.21-rc.1) [![Electron](https://img.shields.io/badge/Electron-41-47848F)](https://www.electronjs.org/)

**Git versions the code. Harness versions the intent.**

AI Project Harness keeps project goals, tasks, decisions, reviews, checkpoints, and evidence outside any single Codex conversation. A conversation may be replaced; accepted project state remains.

[中文说明](README.zh-CN.md) · [First run](docs/guide/first-run.en.md) · [Troubleshooting](docs/guide/troubleshooting.en.md) · [Data and backup](docs/guide/data-and-backup.en.md) · [Development](DEVELOPMENT.md)

## What it does

- Creates a blank local project without contacting Codex, scanning repositories, or inventing history.
- Optionally connects that same project to a registered Codex Project as a separate confirmed transaction.
- Imports a registered Codex Project through a bounded, review-gated path. Topic-wide message-level history collection is planned, not implemented.
- Creates tasks in `ready`; only **Dispatch task** starts an Agent run.
- Keeps ordinary results behind human review. Only **Accept and advance HEAD** changes Harness Project HEAD.
- Preserves structured state across restarts while keeping raw transcript payloads outside UI state.

## Supported release path

The supported artifact is the Windows x64 portable EXE attached to the exact [`v0.0.21-rc.1` pre-release](https://github.com/lucaszhouc/AI-Project-Harness/releases/tag/v0.0.21-rc.1). Compare its byte size and SHA-256 with the attached manifest; do not use `/releases/latest` for pre-release evaluation.

Running the packaged EXE does not require the source tree or a development toolchain. The current Codex adapter requires a compatible Codex CLI for connection, import, and task execution. Local project creation and task drafting remain available without Codex. See [Connect Codex](docs/guide/connect-codex.en.md).

The portable EXE is currently unsigned. Windows may show a source warning. Verify the exact release page and SHA-256; do not disable SmartScreen, antivirus, or other operating-system protections.

## First run

1. Start the EXE. A genuinely new profile opens with no sample projects.
2. Open **Getting started** and choose **Create blank project**.
3. Enter `First evaluation project`; the goal may be blank or `Create one reviewable task`.
4. Select **Create local project**. This action is local-only.
5. To use an Agent, select **Connect Codex**, review the scope and possible account usage, and confirm. Failure leaves the same local project intact.
6. Select **New task**, enter a title and acceptance criteria, and keep **User confirms before advancing** for the ordinary path.
7. The created task remains `ready`. Select **Dispatch task** only when you intend to start the Agent.
8. Inspect the workspace and evidence. Rejecting or requesting changes does not roll source code back. Accepting advances Harness HEAD; it does not automatically commit or push.
9. Exit and reopen Harness. Project, task, review state, and valid guide evidence should persist; expired probes ask to be checked again.

For exact fields and recovery steps, use the [complete first-run guide](docs/guide/first-run.en.md).

## Create, connect, and import differ

| Action | What it does | What it does not do |
|---|---|---|
| Create blank project | Writes a local Harness Project and revision. | No Codex probe, directory scan, history search, or turn. |
| Connect Codex | After confirmation, creates or reuses a Codex Project/control connection for the existing local project. | A failure does not delete the local project. |
| Import a registered Codex project | Uses verifiable official Project/working-directory relationships and creates a review-gated import task. | It is not topic-wide or message-level cross-conversation search. |

## Tasks and review

- **Create task** saves `ready`; **Dispatch task** creates a Run and may start one Codex turn.
- **Reject result** and **Request changes** leave Harness HEAD unchanged and do not revert files.
- **Accept and advance HEAD** creates one checkpoint when the base revision still matches.
- Explicit `reviewMode=auto` or Section `approvalMode=auto` stays an advanced visible policy. The guide never silently enables it.

See [Projects](docs/guide/projects.en.md), [First task](docs/guide/first-task.en.md), and [Button reference](docs/guide/buttons.en.md).

## Privacy and safety

The guide is a deterministic, state-aware workflow. It has no question/chat box and does not call a model. It explains the next safe action from persisted project, task, review, and capability-probe state.

Harness does not ask for or store OAuth codes, passwords, cookies, or tokens. Public docs generation excludes host project names and local state. See [Security and privacy](docs/security-and-privacy.md) and [SECURITY.md](SECURITY.md).

## Release status

<!-- APH_AUTO_STATUS_START -->
- Package version: v0.0.21-rc.1
- Release status: public GitHub pre-release candidate.
- Project names and host state are intentionally excluded.
<!-- APH_AUTO_STATUS_END -->

Released by [@lucaszhouc](https://github.com/lucaszhouc) under the [MIT License](LICENSE). This is a single-maintainer project; email [lucaszhouc@gmail.com](mailto:lucaszhouc@gmail.com) for the fastest response.

## Development

Read [DEVELOPMENT.md](DEVELOPMENT.md). The release gate is:

```powershell
npm run check:release
npm run qualify:release
npm run check:packaged-integrity
```

Automated success is `AUTOMATED_GATE=PASS`; Windows/Codex sidebar cold-start and the 30–60 minute human evaluation remain `HUMAN_ACCEPTANCE=PENDING` until performed.
