# Data and backup

Harness stores local project state, a replay journal, bounded guide state, error logs, content-addressed archives, and derived ledgers under its user-data root. `APH_USER_DATA` isolates automated tests; tests must never use a real user profile.

Back up the complete user-data root while Harness is closed. Keep state, journal, guide state, archive objects/manifests, and project context together. A project export is useful for transfer but does not replace raw archives or the source repository.

Corrupt primary state is preserved with a `.corrupt-<timestamp>` name before safe recovery. Existing user projects are never cleared merely to provide an empty first-run experience. Restore/reject/stop actions do not restore source files; Git or another backup system remains authoritative for code recovery.

Logs use bounded operational context and references, not passwords, tokens, complete prompts, or transcript bodies. Review a bundle before sharing it.
