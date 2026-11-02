> Historical material. Desktop-native repair is incomplete; see [current status](../CURRENT_REPAIR_STATUS.md). Older execution and PASS claims do not describe this source revision.

# First run on Windows

This guide is for the packaged portable EXE. You do not need the source tree, Node.js, npm, a build environment, or Codex CLI to run Harness. Codex integration uses the native Codex Desktop application only.

## 1. Verify the download

When a pre-release is authorized, open its exact tag page and download the Windows x64 portable EXE from **Assets**. Do not use the generated “Source code” archives as the application. In PowerShell, run the exact command published for that tag:

```powershell
Get-FileHash -Algorithm SHA256 .\AI-Project-Harness-<version>-portable.exe
```

The complete hash and byte size must match the release manifest. If either differs, stop. This repository currently has no authorized public release, so there is no release URL to substitute yet.

## 2. Start Harness

Double-click the verified EXE. The first screen shows the application version and **Getting started**. A new profile must not contain the Harness development project or any other sample. If Windows shows the normal warning for an unsigned executable, verify the source and hash before using the single-file confirmation path; do not disable system protection.

Failure: record the version, hash, Windows version, exact message, and time. Do not download from another site.

## 3. Choose a project entrance

Open **Add project** and choose one of **Create blank project**, **Keyword organize**, or **Select conversations**. For a blank project, enter:

- Project name: `First evaluation project`
- Goal: `Create one reviewable task`
- Constraints: leave blank
- Project directory: leave blank for now

Select **Create project**. The blank path creates the official Codex Project and control plane, then opens CTO without an organizer turn. The keyword and selected-conversation paths search or read only their declared sources and start one real organizer turn. All three choices switch immediately to the progress dialog; only a real `turn/start` with a bound thread/turn/process is shown as running.

Failure: correct the highlighted field. A write failure must leave no half-created project and must preserve the form.

## 4. Check Codex (needed for organizer entrances)

Start and sign in to Codex Desktop in its own UI. Harness never launches a command-line client or asks for credentials.

For an existing local project, **Connect Codex** sends the native Desktop deep link and waits for sidebar evidence. If Desktop lacks the requested control surface, the operation is blocked and the same local project remains retryable.

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
