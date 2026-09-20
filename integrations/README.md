# Agent 连接包

`codex/`、`claude/` 和 `hermes/` 各自提供同名 Harness Skill。它们共享项目级协议，但能力边界不同：Codex 可由桌面 Harness 后台启动；Claude Code 与 Hermes 只接受用户主动调用。

本地 MCP 服务入口为仓库根目录的 `scripts/harness-mcp.mjs`（`npm run harness:mcp`）。配置到 Agent 时使用 stdio，不要把 `harness-state.json` 直接交给 Agent 修改。
