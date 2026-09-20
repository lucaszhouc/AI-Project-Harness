# Contributing

AI Project Harness is a single-maintainer project. GitHub notifications and pull requests may be reviewed slowly; email [lucaszhouc@gmail.com](mailto:lucaszhouc@gmail.com) for the fastest response. For time-sensitive changes, fork the repository and build your own candidate.

AI-assisted contributions are welcome, but the contributor must understand and be able to explain every submitted change.

## Development rules

1. Preserve unrelated working-tree changes. Do not use destructive reset, checkout, clean, force push, or history rewriting.
2. Keep blank creation local-only, task creation separate from dispatch, and normal review human-gated.
3. Do not add credentials, private paths or project names, transcript bodies, or packaged binaries to Git history.
4. Install dependencies with `npm ci` and run `npm run check:release`.
5. For release candidates, also run `npm run qualify:release` and `npm run check:packaged-integrity`.

Automated qualification cannot replace the real Codex Desktop sidebar cold-start or human experience gate. By contributing, you agree that your work is licensed under the repository's [MIT License](LICENSE).
