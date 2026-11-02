> Historical material. Desktop-native repair is incomplete; see [current status](../CURRENT_REPAIR_STATUS.md). Older execution and PASS claims do not describe this source revision.

# Troubleshooting

## Codex Desktop is unavailable

Start Codex Desktop and retry the native project registration. Harness does not install software, search for a CLI, or change system settings.

## Desktop is not signed in

Complete sign-in in Codex Desktop itself and retry. Do not paste credentials into Harness.

## Native Desktop check failed

`DESKTOP_NATIVE_UNAVAILABLE` means the running Desktop instance did not expose the requested native operation. Keep the error code, Desktop version, action, and timestamp. Retry only after the Desktop state changes.

## Connection result is unknown

Use **Check connection result** or reopen Harness. The durable operation ID is queried first. Do not create another project merely because the UI was interrupted.

## Task will not start

Read the visible disabled reason: archived project, missing connection, running task, unmet dependency, closed Section, or stale state. Creating a task is not dispatching it.

## Review is stale

Refresh evidence. Harness refuses to accept a result based on an older Project HEAD revision.

For a report, include version/hash, Windows/locale/scaling, exact steps, expected/actual result, and screenshot/log/error ID. Exclude credentials and private prompts.
