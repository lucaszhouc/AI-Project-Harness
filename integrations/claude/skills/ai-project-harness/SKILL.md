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

在项目根目录执行：

```powershell
npm run harness -- list
npm run harness -- context --project <PROJECT_ID>
```

若 Harness 以文件引用提供上下文，优先读取该文件；不要恢复无关的旧对话。
portable 版本可从 Harness 面板“项目详情”取得 `Agent CLI` 路径，再用同一命令读取/提交状态。

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
