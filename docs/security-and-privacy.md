# Security and privacy model

AI Project Harness is local-first. Project state, guide state, logs, and archives stay under the selected local user-data root unless a user explicitly invokes an external Agent operation.

## Default local guide

- Works without an API key, model call, or network request.
- Read-only capability probes create zero Agent turns and zero Codex Projects.
- Does not request or store OAuth codes, passwords, cookies, or tokens.
- Has no question/chat input and makes no model call.
- Does not index complete prompts, transcript bodies, host project names, or private paths.

## Logs and archives

Operational logs contain action, stage, error code, application version, and bounded context or references. Raw transcripts belong only in the content-addressed archive. State, Ledger, MCP, and logs store hashes, paths, counts, and bounded summaries. Review exports before sharing them.

## Public material

The docs-sync script uses package metadata only. It does not read Harness user state or copy project lists. Public allowlists exclude internal acceptance specifications, VM instructions, host paths, local logs, credentials, user project names, and binary build outputs.
