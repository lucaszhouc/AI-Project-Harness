# Core button reference

| Button | Meaning | Persistent evidence | Does not mean |
|---|---|---|---|
| Create blank project | Local project write. | project ID, revision, `source=blank` | Codex connected or history imported |
| Check again | Refresh a read-only probe. | probe ID, status, checked/expiry time | Login succeeded |
| Connect Codex | Confirmed external connection transaction. | operation ID and returned Project/thread IDs | Exact conversation opened |
| Create task | Save a `ready` task. | task ID | Dispatched |
| Dispatch task | Start execution. | Run ID and dispatch event | Result accepted |
| Reject result | Reject the candidate. | review event; unchanged HEAD | Source rollback |
| Request changes | Return work to a recoverable/editable state. | review event; unchanged HEAD | Source rollback |
| Accept and advance HEAD | Accept one current result. | checkpoint and incremented revision | Git commit or push |
| Stop task | Stop the run state. | terminal run event | Undo file changes |
