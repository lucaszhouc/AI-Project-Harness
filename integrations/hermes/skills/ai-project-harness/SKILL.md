---
name: ai-project-harness
description: >-
  将 Hermes 的用户主动任务接入 AI Project Harness；读取有界项目状态并返回结构化候选结果。
---

# AI Project Harness · Hermes

Harness 将 Hermes 视为用户主动调用的适配器。读取任务包和项目上下文，完成明确工作，然后只返回候选结果；不要修改 Harness 状态文件，也不要把几 GB 的会话全文复制进当前对话。

执行前从 Harness Desktop 原生上下文面板读取项目状态；不运行 CLI 命令。

完成后输出一个 fenced `harness-result` JSON，字段包括 `summary`、`completed`、`remaining`、`nextStep`、`acceptance` 和 `evidence`。用户确认后 Harness 才会推进 Project HEAD。

## MCP 与 smoke 清理

本地 MCP 是受限控制面：优先用 `refresh_snapshot` / `get_import_status` 读取真实阶段，写入时复用 `operationId` 并保存 receipt；MCP 不持有 Codex Desktop turn，也不能替用户接受候选或推进 Project HEAD。需要查询单次写入时使用 `get_operation_status`。

任何真实 smoke 或端到端验收结束后必须清理测试副作用：先关闭测试 Harness，再运行 `npm run cleanup:smoke`。清理只针对隔离测试路径，必须保留 report/截图证据；不得清理用户正式 Project。
