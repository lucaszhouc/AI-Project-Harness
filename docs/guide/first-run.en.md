# First run on Windows

This guide is for the packaged portable EXE. You do not need the source tree, Node.js, npm, or a build environment merely to run Harness. The current Codex execution path separately requires a compatible Codex CLI.

## 1. Verify the download

When a pre-release is authorized, open its exact tag page and download the Windows x64 portable EXE from **Assets**. Do not use the generated “Source code” archives as the application. In PowerShell, run the exact command published for that tag:

```powershell
Get-FileHash -Algorithm SHA256 .\AI-Project-Harness-<version>-portable.exe
```

The complete hash and byte size must match the release manifest. If either differs, stop. This repository currently has no authorized public release, so there is no release URL to substitute yet.

## 2. Start Harness

Double-click the verified EXE. The first screen shows the application version and **Getting started**. A new profile must not contain the Harness development project or any other sample. If Windows shows the normal warning for an unsigned executable, verify the source and hash before using the single-file confirmation path; do not disable system protection.

Failure: record the version, hash, Windows version, exact message, and time. Do not download from another site.

## 3. Create a blank project

Open **Getting started** → **Create blank project**. Enter:

- Project name: `First evaluation project`
- Goal: `Create one reviewable task`
- Constraints: leave blank
- Project directory: leave blank for now

Select **Create local project**. Success means one project appears with source `blank` and an initial revision. This action does not probe Codex, scan a directory, or create a turn.

Failure: correct the highlighted field. A write failure must leave no half-created project and must preserve the form.

## 4. Check and connect Codex (optional)

Select **Check again** in the guide. `unknown` means not safely verified; it is not “missing.” If Codex is absent, use the [official Codex CLI instructions](https://developers.openai.com/codex/cli). Run `codex` and select **Sign in with ChatGPT**, or use another official sign-in method. Return to Harness and select **Check again**; saying “I installed it” does not unlock the connection.

Select **Connect Codex** only after reading the confirmation: this is a second transaction, may create/reuse a Codex Project and control conversations, and may use the configured account. Success displays connection evidence. Failure preserves the same local project and offers a retry/check-result path.

## 5. Create, then dispatch, a task

Select **New task** and enter:

- Name: `Create hello.txt`
- Acceptance criteria, one per line:
  - `The workspace contains hello.txt`
  - `The file content is Hello Harness`
  - `No other file was modified`
- Review: **User confirms before advancing**

Select **Create task**. The task must say it is ready and must not have a Run ID. Closing the guide, refreshing, or selecting the task must not start it.

After reviewing the task packet, select **Dispatch task**. Only now may a Run ID and external turn appear. If Codex is unavailable, the task stays recoverable; do not create another task to retry.

## 6. Review and persist

Open the workspace and inspect `hello.txt` yourself. In Harness, compare the acceptance evidence. **Reject result** and **Request changes** change task/review state only; they do not revert files. **Accept and advance HEAD** advances Harness HEAD once when the base revision matches. It does not commit or push Git.

Exit normally and reopen the same EXE. The project, task, decision, and review state must match. Expired capability probes should be `stale` and request a fresh check, never silently remain verified.

If anything differs, stop claiming the loop passed and follow [Troubleshooting](troubleshooting.en.md).
