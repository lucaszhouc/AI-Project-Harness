# AI Project Harness · 执行计划与防漂移标记

本文件是产品级路线图；运行中的无人值守执行状态唯一记录在
`E:\_iva_workspace\ai-project-harness-full\autoclever\progress.json` 和同目录 `events.jsonl`。
它不复制聊天历史，也不把 `resume` 当成项目真相源。

## 当前目标

把 Windows 本地 MVP 补成一个可长期使用的跨 Agent Project Harness 首发切片：项目状态独立于 Agent 对话，Codex 有真实 Project，Claude/Hermes 走用户主动交接，Git/GitHub、归档、Section 和动态白皮书可持续回写。

## 阶段门禁

| 阶段 | 交付物 | 验收标记 |
| --- | --- | --- |
| A · 状态层 | Project contract、唯一 Objective、主控/可复用/一次性 Section、归档/恢复 | `STATE_MODEL_PASS` |
| B · Agent 层 | Codex 2+N、任务包、结构化 result、Claude/Hermes 用户主动 Skill、MCP/CLI | `AGENT_BRIDGE_PASS` |
| C · 事实层 | Git branch/diff/commit、GitHub 只读、动态 Ledger、内容寻址 transcript 归档 | `EVIDENCE_LAYER_PASS` |
| D · 桌面层 | 简洁亮色面板、项目搜索、详情抽屉、审核/归档/导入导出操作 | `DESKTOP_UX_PASS` |
| E · 发布层 | 全量测试、构建、renderer/Electron/portable smoke、最终包与校验值 | `RELEASE_PASS` |

## 已完成标记

- `STATE_MODEL_PASS`：Project/Task/Run/Session 与 Section 状态机已落地；用户审核可推进 HEAD。
- `AGENT_BRIDGE_PASS`：Codex 官方 Project、任务 Skill、用户主动 Claude/Hermes 路径、`harness` CLI 与最小 MCP bridge 已落地。
- `EVIDENCE_LAYER_PASS`：Git/GitHub 摘要、动态 `PROJECT-LEDGER.md`、SHA-256 内容寻址 transcript 归档、项目包导入导出已落地。
- `DESKTOP_UX_PASS`：面板显示目标/任务/进展轨迹；详情抽屉提供 Git、GitHub、Section、归档和契约编辑入口。
- `UI_GAP_PASS`：Hermes 显示、Section 改派、前置依赖、legacy 降级和低高度对话框滚动已补齐；关闭 Section 不会被调度静默重开。
- `RELEASE_PASS`（隔离/代码集成范围）：2026-09-04 08:03:33 JST；165/165 单测、构建、renderer/Electron、自动 Review、packaged UI/Codex/portable smoke 和 v0.0.17 portable 已通过。最终 SHA-256：`7FB8ECA57A06A0F748B90678F1A320E11E4877E3ED8BD1976D78D928F3686ADE`。这条标记不包含真实 Desktop 侧栏冷启动验收。
- `RELEASE_CANDIDATE_V0.0.18`：legacy 写入护栏、冷启动提示、精确 deep link 和 dispatch 审计已通过 183/183、`check:release`、packaged UI/Codex/portable smoke 与 packaged-runtime-integrity；候选 SHA-256=`D965BF709C439A6980B86C169F9CE88FDB44194C0FF686F1FEA72D8FD3DE58E6`。真实侧栏门未通过前仍不替换桌面快捷方式。
- `REAL_CODEX_PROJECT_VISIBILITY_PENDING`：旧项目的完整冷启动迁移仍待验收；本轮已对一个新建 Project 完成实时 Desktop `list_projects/list_threads` 回读，旧的六个 shell 控制 thread 不删除，待用户无关键任务运行时再逐项替换指针并冷启动核对。
- `DUAL_ENTRY_IMPORT_SOURCE_PASS`：2026-09-05；空白创建与官方 Codex Project 拉取已彻底分流。导入链路为 `project/list` 近似定位 → 全量分页线程索引/rollout 无损归档 → 专用 Import Agent → `harness-import` 候选 → 用户审核 → 幂等回填。223/223、构建与真实 Electron 隔离导入 Smoke 通过；真实 Project 导入 Agent 已完成只读盘点并返回候选，证据目录为 `E:\_iva_workspace\aph-real-import-connected-20260905-0650`。
- `V0.0.19_RELEASE_PASS`：223/223、build、check:release、最终 ASAR/外置 schema 完整性、packaged UI/Codex/import 与 portable 启动均通过。成品 90,851,869 bytes，SHA-256=`51E957DFB8441B64C3161FB87AA881056AD31D924CC508D9EFE7D5821CBB24CB`；桌面快捷方式未替换。
- `REAL_CONNECTED_FLOW_PASS`：2026-09-05；真实面板新建链路通过 `codex://new` 注册官方 Project，生成 CTO + Review 两个真实可读 thread，均带同一官方 `projectId`；Desktop `list_projects` 与 `list_threads` 已回读到同一项目。证据：`E:\_iva_workspace\aph-real-connected-flow-20260905-0510\report.json`。
- `CONTROL_TURN_TELEGRAM_FIX_PASS`：2026-09-05；根因是控制 turn 继承全局 Telegram MCP，handshake 失败；现在线程级关闭故障 MCP、使用支持的 `low` effort，并用真实初始化 turn + `thread/turns/list` 验收。对应回归在 `tests/codex-adapter.test.cjs`。

## 不做 / 安全边界

- 不删除旧 Codex 对话、旧状态、用户资产或 transcript 原件。
- 不自动接管 Claude OAuth，不伪造厂商后台 API；Claude/Hermes 当前走用户主动 Skill/MCP，公共后台 adapter 等待 adapter contract 验证后再扩展。
- 不因 Git commit 数量推算项目完成百分比；不在未显式接受时自动提交代码。
- 不修改代理、节点、DNS、网卡或正在运行的 Codex 主进程。

## 每一步如何防漂移

1. 先读本文件与 `progress.json` 的 `next_action`。
2. 每个阶段只改一个边界，并新增至少一个可重复测试。
3. 先跑局部测试，再跑全量门禁；把命令、结果和产物路径追加到 `events.jsonl`。
4. 只有证据通过才把阶段标记为 `*_PASS`；真实 Desktop 侧栏、官方 Project、rollout 和任务 dispatch 必须各有独立证据，不能用 fake client、SQLite 行或隔离 portable smoke 代替；失败保留为 `failed`，不通过改文案掩盖。
