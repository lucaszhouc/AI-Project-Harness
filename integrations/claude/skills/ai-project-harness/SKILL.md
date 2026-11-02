---
name: ai-project-harness
description: >-
  将 Claude Code 的用户主动工作接入 AI Project Harness；读取有界项目上下文并返回结构化候选结果，不接管 OAuth 会话。
---

# AI Project Harness · Claude Code

这是用户主动调用的交接 Skill，不是后台 PTY 包装器。先读取 Harness 提供的项目上下文，再在当前 Claude Code 会话中完成明确的 Task。

## 边界

- 不模拟登录、不接管 OAuth、不创建无人值守的 Claude 会话。
- 只修改当前 Task 合同允许的范围；以 Git、测试和文件为事实来源。
- 项目 HEAD 只有 Harness 用户审核通过后才推进。

## 读取上下文

在 Harness Desktop 面板中读取：

使用当前项目的 Desktop 原生上下文面板，不运行 CLI 命令。

若 Harness 以文件引用提供上下文，优先读取该文件；不要恢复无关的旧对话。
portable 版本也只使用 Desktop 原生上下文和候选回写，不提供 Agent CLI 路径。

## 返回候选结果

完成、暂停或阻塞时输出一个 fenced `harness-result` JSON：

```harness-result
{
  "summary": "完成了什么或确认了什么",
  "completed": ["可验证结果"],
  "remaining": ["未完成工作"],
  "nextStep": "最小下一步",
  "acceptance": [{ "criterion": "原任务验收条件", "status": "pass | fail | pending" }],
  "evidence": [{ "type": "file | git | test | note", "value": "路径、提交或命令" }]
}
```

用户或 Harness 审核后再写入 Project State；不要声称已经推进 Project HEAD。

## MCP 与 smoke 清理

本地 MCP 是受限控制面：优先用 `refresh_snapshot` / `get_import_status` 读取真实阶段，写入时复用 `operationId` 并保存 receipt；MCP 不持有 Codex Desktop turn，也不能替用户接受候选或推进 Project HEAD。需要查询单次写入时使用 `get_operation_status`。

任何真实 smoke 或端到端验收结束后必须清理测试副作用：先关闭测试 Harness，再运行 `npm run cleanup:smoke`。清理只针对隔离测试路径，必须保留 report/截图证据；不得清理用户正式 Project。
