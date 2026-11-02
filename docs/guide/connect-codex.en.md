# Connect Codex Desktop

Harness uses the installed Codex Desktop application through its native deep-link and desktop control surface. It does not install, detect, or invoke Codex CLI or app-server.

1. Start and sign in to Codex Desktop using its own UI. Harness never asks for credentials.
2. In Harness, create or select a local project and choose **Connect Codex**.
3. Harness sends a native `codex://` request. Confirm the project appears in the Codex Desktop sidebar.
4. If the running Desktop instance does not expose a required native operation, Harness blocks that operation and keeps the local project usable.

Project registration is confirmed only by a fresh Desktop sidebar readback. A deep-link request alone is recorded as pending; no CLI or app-server result can upgrade it to success.
