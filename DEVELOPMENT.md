# Development

This file is for contributors, not ordinary EXE users.

## Requirements

- Windows development environment
- Node.js and npm compatible with the lockfile
- Git for source/evidence workflows
- Codex CLI only for Codex adapter/probe tests; local state/unit tests do not require a login

Install and start:

```powershell
npm ci
npm start
```

Use an isolated profile for any runtime test:

```powershell
$env:APH_USER_DATA = Join-Path $env:TEMP "aph-dev-isolated"
npm start
```

Never point automated tests at a real Harness data root. Do not change network adapters, DNS, proxies, Codex credentials, or Desktop-owned state as part of ordinary development.

## Test workflow

Use RED → GREEN → REFACTOR for every behavior change. Useful local checks include:

```powershell
npm test
npm run build
npm run smoke:renderer
```

Final user-facing/runtime gate, in order:

```powershell
npm run check:release
npm run qualify:release
npm run check:packaged-integrity
```

`qualify:release` performs a clean dependency install in an isolated staging copy, source gates, Windows packaging, sensitive/ASAR audit, and packaged/portable smoke. It creates a new candidate; do not overwrite an older tested asset. A passing automatic gate is not a public release or human acceptance.

## Architecture boundaries

- Renderer renders state and invokes narrow preload APIs; it never runs shell commands.
- Blank creation is local-only. Codex connection and import are explicit separate actions.
- Read-only probes create zero turns and Project writes.
- Operation IDs, not renderer instances or snapshot sequences, provide idempotency.
- Project State is durable truth; Agent conversations are replaceable execution sessions.
