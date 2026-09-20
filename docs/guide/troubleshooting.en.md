# Troubleshooting

## Codex was not found

Local project creation still works. Follow the official Codex CLI install guide, then use **Check again**. Harness does not install software or change system settings.

## Installed but not authenticated

Complete `codex login` outside Harness and recheck. Do not paste credentials into Harness. A user statement alone never changes the probe to `ok`.

## Check failed

`error` means the check failed; it is not `missing`. Keep the error code, version, action, and timestamp. Recheck once after fixing the external condition.

## Connection result is unknown

Use **Check connection result** or reopen Harness. The durable operation ID is queried first. Do not create another project merely because the UI was interrupted.

## Task will not start

Read the visible disabled reason: archived project, missing connection, running task, unmet dependency, closed Section, or stale state. Creating a task is not dispatching it.

## Review is stale

Refresh evidence. Harness refuses to accept a result based on an older Project HEAD revision.

For a report, include version/hash, Windows/locale/scaling, exact steps, expected/actual result, and screenshot/log/error ID. Exclude credentials and private prompts.
