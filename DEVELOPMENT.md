# Development

This file is for contributors, not ordinary EXE users.

## Requirements

- Windows development environment
- Node.js and npm compatible with the lockfile
- Git for source/evidence workflows
- Codex Desktop native deep-links and live desktop controls are the only supported Codex integration. External command-line and backend probes are removed; unsupported Desktop capabilities remain blocked.

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
npm run check:local
npm run smoke:renderer
```

`check:local` is the default loop for ordinary source changes. It runs the unit suite and the production renderer build without packaging or release qualification. For a narrow change, run the smallest relevant test files first and then `npm run check:local` when the local boundary is stable.

Repackage only when the user needs a new EXE or the change affects packaged runtime/resources:

```powershell
npm run check:local
$env:APH_RELEASE_SIDEBAR_EVIDENCE = "C:\\path\\to\\fresh-real-chain-evidence.json"
npm run package:local
npm run check:packaged-integrity
npm run smoke:portable
```

Both `package:local` and `package:win` run the prepackage gate. They require fresh evidence for the real Codex Desktop sidebar and a `fullChainStatus="PASS"` task/writeback chain before `electron-builder` starts. This prevents an incomplete repair from being mistaken for a shippable candidate. Use `npm run check:local` and the renderer/Electron smokes while iterating; do not bypass the gate with a raw `electron-builder` command.

Do not run `qualify:release`, `package:win`, the full packaged matrix, or the GitHub release workflow for every small local fix. Reserve those gates for an explicit release candidate or the pre-publication pass. A local package is not a public release.

Final user-facing/runtime gate, in order:

```powershell
npm run check:release
npm run qualify:release
npm run check:packaged-integrity
```

`qualify:release` performs a clean dependency install in an isolated staging copy, source gates, Windows packaging, sensitive/ASAR audit, and packaged/portable smoke. It creates a new candidate; do not overwrite an older tested asset. A passing automatic gate is not a public release or human acceptance.

## Architecture boundaries

- Renderer renders state and invokes narrow preload APIs; it never runs shell commands.
- Project creation requests native Desktop drafts; automatic creation and readback remain unimplemented. Import blocks when native capabilities are unavailable.
- Read-only probes create zero turns and Project writes.
- Operation IDs, not renderer instances or snapshot sequences, provide idempotency.
- Project State is durable truth; Agent conversations are replaceable execution sessions.
