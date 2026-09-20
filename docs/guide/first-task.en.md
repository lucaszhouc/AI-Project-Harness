# Your first task

1. Select **New task**.
2. Write one outcome and concrete acceptance criteria, one per line.
3. Keep **User confirms before advancing** unless an existing project intentionally uses explicit auto review.
4. Select **Create task**. Confirm the state is `ready` and no Run exists.
5. Inspect/copy the task packet if needed.
6. Select **Dispatch task**. This is the only ordinary action that starts execution.
7. Review actual files and evidence. Reject/request changes leaves HEAD unchanged; Accept advances it once if the base revision matches.

**Stop task** stops the Harness run projection; it does not roll source files back. Cancelling a guide probe never stops a real task.
