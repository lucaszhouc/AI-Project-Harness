# First Release Acceptance

`npm run check:release` is the source-runtime gate. `npm run qualify:release` is the release-candidate gate: it installs the lockfile dependencies, runs the source gate and release contracts, builds the Windows portable artifact, audits the packaged contents, and exercises the packaged UI, Electron workflow, missing-Codex path, portable persistence, and packaged Codex read-only adapter.

```powershell
npm run qualify:release
```

For an already-built artifact, the two bounded shortcuts are:

```powershell
npm run qualify:release -- --skip-clean-install
npm run qualify:release -- --skip-clean-install --skip-package
```

The command writes `qa/qualification/latest.md`, `latest.json`, and one timestamped evidence directory. A required failure prints `RELEASE_BLOCKED: YES` and exits non-zero. A real-machine discovery or read-only Codex probe may be `WARN`; warnings do not replace the required gates.

Automated PASS does not complete these human gates:

- Run the final portable EXE in a fresh Windows Sandbox with Codex absent and follow the public README without developer shortcuts.
- Destroy that Sandbox and repeat in a second fresh Sandbox.
- Run one real Codex workflow against a disposable repository: create, edit, Review, explicit human Accept, restart, and verify Project State.
- Use the product normally for 30–60 minutes across CTO, Task, Reject, Retry, Review, Accept, and a following task; record stale UI, duplicate state, loading, session, and persistence problems.

No Git push, GitHub Release, external post, or desktop-shortcut switch belongs to this command. Those remain explicit human release actions.
