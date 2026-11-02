---
name: ai-project-harness-writeback
description: >-
  Codex 与 Harness 的交接协议。由 Harness Prompt 给出本文件位置，读取后
  按当前 Run 身份回写状态和候选结果；不定义业务任务、不直接改程序状态。
---

# Codex 与 Harness 交接协议 v1

本文件随 Harness 程序发布，以 Skill 文件形式承载交接协议。Harness 不安装全局 Skill，也不通过 `type: "skill"` 注入正文；当前 Prompt 的绝对路径是读取入口。业务目标和整理范围以当前任务为准。

## 执行顺序

1. 读取当前 Desktop 原生交接 Prompt 的 `MODE`、`HARNESS_PROJECT_ID`、`HARNESS_TASK_ID` 和 `HARNESS_RUN_ID`，确认三个 ID 绑定同一 Run。CTO/Review 初始化或普通讨论没有完整 Run 身份时，只读取协议，不发送任务状态或结果。
2. 开始真实工作后回写 `running`；长操作至少每 5 分钟回写 `heartbeat`，事件重试复用 operationId，下一次心跳使用新的事件 ID。等待资源时回写 `blocked` 和原因，恢复工作回写 `running`。
3. 执行当前任务并收集证据；业务方法由任务/整理指令决定。
4. 提交结果前回写 `completed` 并确认 receipt 成功，再输出一个最终候选块。普通任务/Onboarding 使用 `harness-result`；`MODE: CONVERSATION_COLLECTION` 使用 `harness-import`，不要同时输出两种结果。失败时回写 `failed`，如实保留 remaining/notes。
5. 候选交给 Harness 审核。只有用户接受才能推进 Project HEAD；状态 receipt 表示回写操作已完成，不表示任务已被接受。

## 当前 Run 的边界

将当前 Prompt 的三个 `HARNESS_*_ID` 对应到 `projectId`、`taskId`、`runId`。缺失或不匹配时停止回写并报告原因，不猜 ID、不复用旧 turn 的 ID。文件路径在每次 Harness 启动时按当前安装位置解析，本轮只复用当前 Prompt 的路径，不能沿用旧机器或旧安装目录。

## 状态回写

只通过当前 Codex Desktop 内置 Harness 交接面调用 `get_task_writeback_contract` 和 `report_task_status`。如果 Desktop 没有该面，返回 `blocked`，不调用命令行，不修改本地状态文件：

Desktop 原生交接面返回相同的幂等 receipt。传输失败只重试同一事件 1 次；身份错误、终态或归档拒绝立即停止。缺少 Desktop 原生交接面时明确报告回写阻塞，不把调用失败说成成功。

允许的 `state` 只有：

- `running`：开始真实工作后发送一次；
- `heartbeat`：长时间操作期间定期发送；
- `blocked`：等待用户、权限、依赖或外部资源时发送，并在 `detail` 写清阻塞原因；
- `completed`：工作已完成、准备提交最终结果时发送；
- `failed`：无法完成且需要重试时发送。

每次调用只填写这些回写字段：

```json
{
  "projectId": "当前 prompt 的值",
  "taskId": "当前 prompt 的值",
  "runId": "当前 prompt 的值",
  "state": "running | heartbeat | blocked | completed | failed",
  "phase": "当前阶段，简短文本",
  "detail": "可复核的状态说明",
  "progress": 0,
  "operationId": "同一次语义重试必须复用的幂等 ID",
  "targetFingerprint": "固定为当前 run 的稳定指纹"
}
```

`progress` 只能是 0 到 100 的数字，没有依据就省略。身份字段只用于定位，不能改写 taskId/runId。状态回写只影响 reportedStatus、阶段、说明、进度和事件时间；`failed` 会使当前 Run 进入可重试失败。`completed` 只声明完成，不能生成候选、接受任务或推进 HEAD。`awaiting_user` 在真实 turn/进度出现后才开始 lease；24 小时到期进入 `timed_out`，ready/backlog/awaiting_user/review 不计时。已超时、已归档或旧 runId 会被拒绝，Agent 不得自己复活。

## 正式结束

普通任务和 Onboarding 完成时严格按这个顺序：

1. 先发送一次 `state: "completed"` 并核对成功 receipt；
2. 再输出唯一一个 fenced `harness-result` JSON；
3. 不要输出第二个结果块，不要把 `completed` 状态当成正式候选。

最终结果只填写这些字段：

```json
{
  "summary": "实际完成或查明的事情",
  "completed": ["已完成项"],
  "remaining": ["仍未完成项"],
  "nextStep": "最小下一步",
  "acceptance": [{"criterion": "当前任务验收条件", "status": "pass | fail | pending"}],
  "evidence": [{"type": "file | git | test | note", "value": "可复核证据"}]
}
```

代码块标签必须是 `harness-result`，不是 `json`。`acceptance` 和 `evidence` 是两个顶层数组，不能把 evidence 嵌进 acceptance。只写真实证据；没有证据写 pending/remaining。Harness 校验 Run、修订、字段和证据后进入 Review。

整理候选使用任务协议所述的 `harness-import`，字段以 Prompt 的导入 schema 为准；它同样必须先完成状态回写，保留选中来源 provenance，等待用户接受。

## 回写前检查

开始前读取 `get_task_writeback_contract`；状态字段可按 Prompt 给出的 schema 核验。用 `get_project_context`/`list_tasks` 查询有界事实，不猜身份。保存 receipt、命令、文件或 turn 为 evidence。不得直接修改 `harness-state.json`、Ledger、数据库，不得自行调用 Accept、归档项目、停止用户 Desktop turn 或推进 Project HEAD。
