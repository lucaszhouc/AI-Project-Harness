---
name: ai-project-harness
description: >-
  将 Hermes 的用户主动任务接入 AI Project Harness；读取有界项目状态并返回结构化候选结果。
---

# AI Project Harness · Hermes

Harness 将 Hermes 视为用户主动调用的适配器。读取任务包和项目上下文，完成明确工作，然后只返回候选结果；不要修改 Harness 状态文件，也不要把几 GB 的会话全文复制进当前对话。

执行前可在项目根目录运行：

```powershell
npm run harness -- context --project <PROJECT_ID>
```

完成后输出一个 fenced `harness-result` JSON，字段包括 `summary`、`completed`、`remaining`、`nextStep`、`acceptance` 和 `evidence`。用户确认后 Harness 才会推进 Project HEAD。
