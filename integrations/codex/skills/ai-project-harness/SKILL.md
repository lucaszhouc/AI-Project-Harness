---
name: ai-project-harness
description: >-
  Execute a project task or read-only project import launched by AI Project Harness.
  Use only when the current turn includes a Harness Bootstrap, Delta Packet, or
  Import Packet.
---

# AI Project Harness

The current working directory is the project root selected by Harness. Treat the injected packet as the task contract for this run; do not recover or resume an unrelated conversation.

## Work from project truth

- Read the packet first: project revision, objective, task, workstream, acceptance conditions, latest accepted checkpoint, and run mode.
- Verify claims against the working tree, Git state, tests, or other concrete evidence. A chat summary alone is not project truth.
- Keep the Task boundary. Do not broaden an onboarding or inspection task into implementation unless the injected Task explicitly authorizes code changes.
- Project HEAD is advanced only after user acceptance in Harness. Report a candidate result; never claim that the project revision has already advanced.

## Onboarding mode

When the packet contains `MODE: ONBOARDING`, inspect the repository without editing it. Identify the actual stack, entry points, current Git state, existing documentation, unresolved risks, and the smallest useful next Task. Do not fabricate a product goal when the repository does not establish one; mark it as needing user confirmation.

## Import mode

When the packet contains `MODE: IMPORT`, this is a read-only pull of an existing
Codex Project into Harness. Treat the current Codex Project and its newest
project conversations as the source to inspect; do not make code changes and do
not edit Harness state files. Use the local Harness MCP/CLI only for bounded
context and field definitions. Reconcile the newest evidence (including the
latest timestamps, Git head, open tasks, CTO/Review state, decisions, blockers,
and GitHub facts) rather than trusting a stale summary or a filename date.
When the Import Packet contains `sourceThreads`, inspect them newest-first.
Their `rolloutPath` values are read-only source files: use bounded searches,
tail/range reads, and structured extraction instead of loading a multi-GB
transcript into one prompt. Treat `updatedAt` and in-conversation evidence as
the recency signal; never use a project folder mtime as “latest progress”.

Return exactly one fenced `harness-import` JSON object matching
`protocol/harness-import.schema.json`. Include every known task and checkpoint
within the schema limits, preserving source IDs and timestamps where available.
Never paste a transcript or credentials into the result. Unknown fields should
be omitted, not guessed. If a field cannot be verified, leave it empty and add
an explanatory note. The Harness will merge the candidate after validation;
your response is evidence, not permission to mutate Project HEAD.

## Candidate result

End a completed, paused, or blocked run with one fenced `harness-result` JSON object. Keep evidence values usable as file paths, commit hashes, diff references, or commands.

```harness-result
{
  "summary": "What changed or what was learned",
  "completed": ["Verified outcome"],
  "remaining": ["Unresolved work"],
  "nextStep": "Smallest useful next action",
  "acceptance": [
    { "criterion": "Criterion copied from the packet", "status": "pass | fail | pending" }
  ],
  "evidence": [
    { "type": "file | git | test | note", "value": "verifiable reference" }
  ]
}
```

Use `pending` when user judgment or missing evidence is required. Keep ordinary explanation outside the JSON concise so Harness can extract the result deterministically later.

## Section 与项目回写

- `main` Section 是轻量 Project Steward，只负责读取上下文、拆分任务和提出审核建议；不要把实现工作塞回主 Section。
- `reusable` Section 可以服务同一 workstream 的连续任务；优先读取 Harness 提供的 Delta 状态，不要依赖无限 `resume` 历史。
- `one-shot` Section 只处理一个隔离任务；结果被接受后它会自动关闭并保留归档索引。
- 如果当前环境能执行本地 CLI，可用 `npm run harness -- context --project <PROJECT_ID>` 读取有界项目上下文；将结果写入 JSON 文件后，用 `npm run harness -- result --project <PROJECT_ID> --task <TASK_ID> --file <RESULT_JSON>` 回写候选结果。不要直接修改 `harness-state.json`。
- 不确定 ID 时先运行 `npm run harness -- list`，按项目名称选择；不要猜测路径或把无关项目的 ID 代入。
- portable 版本如果项目根目录没有 Harness 源码，使用面板“项目详情”显示的 `Agent CLI` 路径，或对应 `harness-runtime/scripts/harness-cli.mjs`；仍然只通过 CLI/MCP 写回。
- 需要导入旧会话时使用 `npm run harness -- import --project <PROJECT_ID> --file <TRANSCRIPT>`。导入是内容寻址的，重复快照会复用对象；不要把完整 transcript 粘回当前对话。
