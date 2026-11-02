---
name: ai-project-harness
description: >-
  Execute a project task or a read-only conversation collection launched by AI
  Project Harness. Use only when the current turn includes a Harness task
  packet, a conversation collection instruction, or an equivalent explicit
  Harness handoff.
---

# AI Project Harness

The current working directory is the project root selected by Harness. Treat the task packet or conversation collection instruction in the current Prompt as the contract for this run; the bundled handoff protocol paths in that Prompt are the only program-integration instructions. Do not recover or resume an unrelated conversation. A repair continuation must use the current user request and repository evidence; never consume external ImBack/task-handoff snapshots, create a replacement task ledger, or treat a compressed/legacy handoff title as a new instruction.

## Work from project truth

- Read the supplied contract first. For an ordinary task, read the project revision, objective, task, workstream, acceptance conditions, latest accepted checkpoint, and run mode. For conversation collection, read the selected source IDs, default task, additional user request, and collection boundary.
- Verify claims against the working tree, Git state, tests, or other concrete evidence. A chat summary alone is not project truth.
- Keep the Task boundary. Do not broaden an onboarding or inspection task into implementation unless the injected Task explicitly authorizes code changes.
- Project HEAD is advanced only after user acceptance in Harness. Report a candidate result; never claim that the project revision has already advanced.

## Onboarding mode

When the packet contains `MODE: ONBOARDING`, inspect the repository without editing it. Identify the actual stack, entry points, current Git state, existing documentation, unresolved risks, and the smallest useful next Task. Do not fabricate a product goal when the repository does not establish one; mark it as needing user confirmation.

## Conversation collection mode

When the instruction contains `MODE: CONVERSATION_COLLECTION` (the legacy
`MODE: IMPORT` spelling remains accepted for old runs), this is a read-only
collection of selected Codex conversations into a reusable Harness project
knowledge package. The selected conversation IDs are the hard boundary: read
only those IDs and never expand the scope from similar titles, folders,
projects, parent threads, or recency. If the instruction contains a default
task and an additional user request, perform both; the additional request may
refine the default task but may not widen the selected conversation scope.

Treat the selected conversations and their bounded evidence as the source to
inspect. Do not make code changes and do not edit Harness state files. Use the
Harness Desktop panel only for bounded context and field definitions. Extract
the reusable project contract: goals, SOP/playbooks, user rules, technical
details, tasks, decisions, checkpoints, blockers, next steps, sessions, Git and
GitHub evidence, with provenance back to the selected sources. The structured
candidate is the result of collection; it is not an ordinary implementation
task packet. Harness writes it to the project state and knowledge index only
after user review and acceptance.

When the instruction is a keyword collection without an explicit selection,
use only bounded sources explicitly supplied by the Desktop handoff. If Desktop cannot provide the source list, return `blocked` and do not claim historical coverage.
When the collection instruction contains `sourceThreads`, inspect them newest-first.
Their `rolloutPath` values are read-only source files: use bounded searches,
tail/range reads, and structured extraction instead of loading a multi-GB
transcript into one prompt. Treat `updatedAt` and in-conversation evidence as
the recency signal; never use a project folder mtime as “latest progress”.

For conversation collection, return exactly one fenced `harness-import` JSON object matching
`protocol/harness-import.schema.json`. Include every known task and checkpoint
within the schema limits, preserving source IDs and timestamps where available.
Never paste a transcript or credentials into the result. Unknown fields should
be omitted, not guessed. If a field cannot be verified, leave it empty and add
an explanatory note. The Harness will merge the candidate after validation;
your response is evidence, not permission to mutate Project HEAD. Do not also
emit a `harness-result` object for a collection run.

## Candidate result for ordinary tasks

For an ordinary implementation or onboarding task, end a completed, paused, or
blocked run with one fenced `harness-result` JSON object. Keep evidence values
usable as file paths, commit hashes, diff references, or commands.

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

## Agent 状态回写与 24 小时 lease

真实工作开始后，只通过当前 Codex Desktop 原生交接面回写状态；缺少该面时返回 `blocked`：

```json
{"projectId":"...","taskId":"...","runId":"...","state":"running|heartbeat|blocked|completed|failed","phase":"...","detail":"...","progress":42}
```

开始工作发送 `running`，长操作定期发送 `heartbeat`，阻塞发送 `blocked` 与原因，完成时先发送 `completed`，再返回唯一的 fenced `harness-result`。状态回写只记录 Agent 声明，不接受候选、不推进 Project HEAD，也不能替代最终结果。必须复用同一个 `operationId` 重试以获得幂等 receipt；晚到的旧 `runId` 或已 `timed_out` 的 Run 会被拒绝。

Harness 从真实 turn/process 绑定或可见对话收到第一条真实进度开始计算 24 小时 lease。`ready`、`backlog`、`awaiting_user`、`review` 不计时；lease 到期或项目归档会保留对话和证据并把 Run 标为 `timed_out`，任务可以重新 dispatch，旧 Run 仍可追溯。

## 归档项目

归档项目不会继续显示在主页活动项目列表。通过“项目工具 → 已归档项目”查看名称、归档时间和原因，并使用“恢复项目”回到主页。归档不会删除项目目录、Codex Project、对话、transcript 或运行归档；Harness 持有的活动连接会停止，用户自己在 Codex Desktop 中运行的可见 turn 不会被强杀。

## Section 与项目回写

- `main` Section 是轻量 Project Steward，只负责读取上下文、拆分任务和提出审核建议；不要把实现工作塞回主 Section。
- `reusable` Section 可以服务同一 workstream 的连续任务；优先读取 Harness 提供的 Delta 状态，不要依赖无限 `resume` 历史。
- `one-shot` Section 只处理一个隔离任务；结果被接受后它会自动关闭并保留归档索引。
- Harness 回写只允许通过当前 Codex Desktop 内置交接面完成；如果 Desktop 没有对应能力，返回 `blocked`，不调用命令行、不改本地状态文件。

- 真实 smoke 或端到端验收结束后必须由 Desktop 原生清理桥回读确认；没有实时清理桥时输出 `SMOKE_BLOCKED`，保留证据，不删除目录制造侧栏残影。
- 真实 smoke 统一复用固定测试项目和已登记的 Desktop 对话；Desktop 不提供实时枚举时立即报告 `SMOKE_BLOCKED`，不猜测或创建替代对话。
- Harness 所有真实 smoke 统一使用固定专用根目录 `<local-only-path>` 和固定官方 Project `APH/Smoke`。禁止为重跑、子步骤或不同断言创建新的文件夹、Project、随机名称或时间戳 suffix；先读取并复用已有 Project/线程，发现多个候选立即停止并报告 `SMOKE_FIXTURE_DIRTY`。
- 原生任务回写专项真实验收尚待接通，旧命令已移除，禁止使用后台执行替代。它必须复用固定注册表中的“完成任务”和“归档任务”对话，发送真实只读 Codex turn，验证 `report_task_status` 的 `running`、`heartbeat`、`completed`，验证 fenced `harness-result` 进入 `review`，再归档第二个活动任务并验证 `timed_out/project_archived`；不得为重跑创建随机任务 thread。报告必须保存 Project ID、task/run/thread ID、真实 turn ID、状态回写 receipt、候选和归档状态；没有真实 thread/turn 不得标记该专项通过。
- 需要导入旧会话时只能使用 Desktop 原生导入能力；没有该能力时保留本地草稿并返回 blocked，不把完整 transcript 粘回当前对话。

## Project Harness 发布验收硬门槛（维护者必读）

下面是 Harness 本体发布前的产品验收规则，不是普通 Agent 任务的可选建议：

1. “手动选择 Codex 对话 / 创建集合项目”必须用真实 Codex 侧栏中的真实 thread 做一次端到端验收。`fake-codex`、fixture、单元测试只能证明选择器和状态机，不得标记为产品链路通过。
2. 验收必须逐项证明：
   - Harness UI 选中了真实 thread ID；
   - Harness 创建了新的实际项目目录，目录存在且不是只有 JSON 记录；
   - Codex 官方 `project/create` 产生真实 Project ID，不能使用 `selection:*` 之类的合成 ID；
   - 该 Project 在 Codex Desktop 侧栏可见；
   - CTO、Review 和导入/任务 thread 都创建在这个 Project 下，并能用 `thread/list` / `thread/read` / `thread/turns/list` 对账；
   - Harness 侧栏项目、项目白皮书、context packet 和原始归档都指向同一个 project path / Project ID。
3. 只在 Harness 自己左侧显示项目，不等于 Codex 官方侧栏已经创建 Project；两个侧栏必须分别检查。`project/list` API 有记录但 Desktop UI 不显示时，仍算可见性失败，必须继续查冷刷新/注册/归属路径。
4. 发布报告必须同时列出真实 thread ID、官方 Project ID、实际目录、CTO/Review thread ID、侧栏核对结果和证据文件。缺任一项只能标记为 `PARTIAL`，不能写“项目创建链路通过”。
5. 单一 Project 回归必须在 Desktop 原生窗口中手动核对侧栏可见性；Harness 不伪造线程 ID 或后台完成证据。
6. `npm run package:win` 与 `npm run package:local` 都有独立发布闸门：必须提供 `APH_RELEASE_SIDEBAR_EVIDENCE`，且证据 JSON 同时包含 `pass=true`、`sidebarVisible=true`、`fullChainStatus="PASS"`、`chainPass=true`、`taskWritebackPass=true`、`verifiedAt`、官方 Project ID、导入 thread ID 和至少两个 control thread ID；否则 `electron-builder` 不得启动。未完成真实任务闭环时只运行源码/隔离 smoke，不得用原始 `electron-builder` 绕过闸门。
7. 项目目录必须跟随 Harness 程序目录：程序目录下预置 `harness-projects`，首次配置只信任这个父目录；所有自动创建的子项目使用简洁稳定名称，不把时间戳拼进项目名，不再让用户逐个点击“信任文件夹”。
