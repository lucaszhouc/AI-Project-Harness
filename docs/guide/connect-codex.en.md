# Connect Codex

Harness distinguishes Codex Desktop, Codex CLI, login, experimental app-server support, and deep-link success. One does not prove the others.

1. Follow the [official CLI install guide](https://developers.openai.com/codex/cli).
2. Run `codex --version`; the current local compatibility baseline is version-specific.
3. Run `codex login` and complete the official browser flow. Harness never asks for credentials.
4. In Harness, select **Check again**. `missing`, `unauth`, `unsupported`, `error`, and `stale` have different recovery meanings.
5. Create a local project first, then select **Connect Codex** and confirm the displayed scope/cost boundary.

The probe is read-only and starts zero turns. Connection is a separate side-effecting action. If connection fails, the local project remains usable. App-server is experimental per the [official documentation](https://developers.openai.com/codex/app-server). Exact conversation opening is recorded only after an actual user-triggered open; otherwise Harness shows unknown/fallback.
