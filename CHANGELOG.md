# Changelog

## 0.0.21-rc.1 — 2026-09-20

- Added a bilingual, state-aware first-run guide with natural compact Chinese copy and full English switching across the core workflow.
- Kept blank project creation local-only, made Codex connection an explicit second transaction, and separated task creation from dispatch.
- Removed the FAQ/chat box and all help-only model calls; ordinary results remain behind human review.
- Added complete English and Chinese beginner guides, button reference, recovery guidance, privacy documentation, and release qualification evidence.
- Added clean-install qualification, Windows packaging, ASAR/sensitive-data audit, packaged/portable smoke, and integrity verification.
- Public pre-release remains subject to the documented human Windows Sandbox/Codex cold-start acceptance gate.

## 0.0.20 — 2026-09-05

- 修复控制 thread 首次初始化被 Telegram MCP handshake 阻断；控制面使用线程级 MCP 隔离与当前模型支持的最低 `low` effort，业务任务和导入仍保留完整 MCP。
- 控制 thread 改为一次有界真实初始化 turn，并回读分页历史，确保 Codex Desktop 侧栏有首条用户消息和可继续的真实 rollout。
- 新增可重复的真实连接 smoke，验证面板新建、`codex://new`、官方 Project、CTO/Review、精确深链和 Desktop 项目归组。
- 修复真实导入任务在 thread/process 回挂前被首次 snapshot 误判为 `invalid-result` 的竞态；`starting` 任务获得有界回挂窗口。
- 导入 Agent 使用 `medium` 结构化回填 effort，并明确索引优先、有限线程核对；解析器兼容 `harness-import` 对象被包在通用 `json` fence 的真实输出。

## 0.0.19 — 2026-09-05

- 项目入口拆成“新建空白项目”和“从 Codex 拉取项目”；空白项目不会被后台自动 provision，可后绑目录并显式连接 CTO/Codex。
- Codex 拉取只查询官方 `project/list`，支持近似名、缩写、错拼、中文别名和多根安全判定；歧义与路径/来源不一致直接拒绝。
- 新增专用 `MODE: IMPORT` Skill、外置 schema、1 MiB 有界候选捕获和用户审核门；接受前不改正式项目状态。
- 关联 Codex 线程通过分页索引从新到旧盘点，源 rollout 在模型上下文外以 SHA-256 无损归档；不再按文件夹 mtime 或文件名日期猜最新进展。
- 导入幂等合并任务、依赖、Section、CTO/Review、checkpoint、决策、Git/GitHub；旧 source revision/generatedAt 不能回退项目真相。
- 新增真实 Electron + 隔离 app-server 的完整导入 Smoke，覆盖官方 Project ID、候选审核、接受回填与源会话归档。
- 223/223、`check:release`、packaged integrity/UI/Codex/import 和 portable 启动通过；v0.0.19 portable 为 90,851,869 bytes，SHA-256=`51E957DFB8441B64C3161FB87AA881056AD31D924CC508D9EFE7D5821CBB24CB`。

## 0.0.18 — 2026-09-04（修正候选）

- 现代 Codex 默认停止写入 Desktop-owned legacy global JSON，避免与 Desktop atom flush 发生覆盖；兼容写入改为显式 `APH_ENABLE_CODEX_LEGACY_STATE_SYNC=1`。
- Project 状态、项目详情和动态 Ledger 明确区分官方 app-server 创建与侧栏冷启动核对。
- onboarding 优先打开精确 Codex thread deep link；任务 dispatch 写入 `task.dispatched` 审计事件，创建任务不会冒充执行。
- 新增只读 `smoke:codex-project-readonly`，对 Project、thread 和 rollout 做真实 app-server 检查，但明确不声称侧栏通过。
- 新增 `check:packaged-integrity`，发布时逐文件核对 ASAR 与当前源码，防止旧 portable 被误当成新版本。
- 183/183 测试、`check:release`、packaged UI/Codex/portable smoke 通过；真实 Desktop 侧栏和旧控制 thread rollout 仍待冷启动验收。

## 0.0.17 — 2026-09-04

- 主控 / 可复用 / 一次性 Section 与 Objective 生命周期。
- 项目契约、暂停/完成/归档/恢复、动态 Project Ledger。
- GitHub 只读摘要、origin 连接、Git 分支/标签摘要。
- SHA-256 transcript 归档、运行原始事件归档、journal 轮转与恢复、SQLite 可选索引。
- Claude Code / Hermes 用户主动 Skill/MCP 交接、本地 CLI 与 stdio MCP bridge。
- 项目模板、项目包导入导出、项目新对话和 Session 打开入口。
- 面板补齐 Hermes Section/Session 显示、任务改派和有界前置依赖；heartbeat 不丢失依赖多选，低高度对话框可滚动到提交动作。
- 改派会清理旧 Section 归属并写入事件；关闭/归档 Section 不会被任务调度静默重开；CLI 不在 PATH 时仍可用已保存 thread 深链打开项目最近对话。

旧版本记录见 [README.md](README.md) 与 [WHITEPAPER.md](WHITEPAPER.md)。
