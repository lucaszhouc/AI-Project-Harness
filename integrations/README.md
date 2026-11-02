# Agent 连接包

`codex/`、`claude/` 和 `hermes/` 各自提供同名 Harness Skill。Codex 任务、项目注册、任务包复制和回写只经过 Codex Desktop 原生深链与 Desktop 内置交接面；Claude Code 与 Hermes 只接受用户主动调用。

Desktop 没有公开能力时，Harness 明确返回 `blocked`，保留本地草稿和证据，不探测、启动或调用任何外部命令行执行器，也不把本地缓存当成侧栏事实。

Harness 自身的 Electron IPC 只服务于本地窗口和状态持久化。它不持有 Codex Desktop turn，不创建隐藏任务，不代替用户接受候选或推进 Project HEAD；用户审核仍是最后闸门。

Codex 线程通过协议文件和 fenced `harness-result` 合同完成交接。Desktop 不提供实时线程读取或回写能力时，任务保持 `awaiting_user` 或 `blocked`，可从 Harness 重新复制任务包。

真实 smoke 完成后必须由 Desktop 原生清理桥回读确认；没有实时清理桥时输出 `SMOKE_BLOCKED`，保留证据，不删除目录制造侧栏残影。
