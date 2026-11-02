> Historical material. Desktop-native repair is incomplete; see [current status](../CURRENT_REPAIR_STATUS.md). Older execution and PASS claims do not describe this source revision.

# Core button reference

| Button | Meaning | Persistent evidence | Does not mean |
|---|---|---|---|
| Create blank project | Create the Harness Project, official Codex Project, CTO/Review controls, and open CTO. | project ID, Codex Project ID, CTO thread ID | History search or organizer turn |
| Keyword organize | Search active/archived threads and message occurrences, then start one organizer turn. | search terms, occurrence provenance, organizer thread/turn IDs | Unbounded transcript search |
| Select conversations | Read only checked threads and create a reviewable knowledge package. | selected thread IDs and candidate evidence | Unchecked conversations or scope expansion |
| Check again | Refresh a read-only probe. | probe ID, status, checked/expiry time | Login succeeded |
| Connect Codex | Confirmed external connection transaction. | operation ID and returned Project/thread IDs | Exact conversation opened |
| Create task | Save a `ready` task. | task ID | Dispatched |
| Dispatch task | Start execution. | Run ID and dispatch event | Result accepted |
| Reject result | Reject the candidate. | review event; unchanged HEAD | Source rollback |
| Request changes | Return work to a recoverable/editable state. | review event; unchanged HEAD | Source rollback |
| Accept and advance HEAD | Accept one current result. | checkpoint and incremented revision | Git commit or push |
| Stop task | Stop the run state. | terminal run event | Undo file changes |
