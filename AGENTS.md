# AI Project Harness 工程契约

## 验证分层与发布前验收门禁

- 日常小改动默认运行 `npm run check:local`（单测 + production build），再补触及边界的定向 smoke；不得每天硬跑完整发布矩阵。
- user-facing 运行时改动必须覆盖真实受影响入口的三层 smoke：静态/build、真实 Codex Desktop 原生深链/侧栏边界、隔离 Electron 端到端；只跑单测不能报告通过。
- 涉及 Codex 项目/对话入口时，smoke 必须先核对实际启动入口（桌面快捷方式/EXE 的目标路径、版本和 ASAR），再核对真实 thread 的首条 user turn、Project ID、cwd 和状态；不能把旧 EXE 或旧线程的结果当成新包证据。
- 只有需要新的本地 EXE 或改动影响 packaged runtime/resources 时，才运行 `npm run package:local`，随后运行 `npm run check:packaged-integrity` 和对应 portable smoke。
- `check:release`、`npm run package:win` 和 `npm run qualify:release` 只用于明确的 release candidate / GitHub 发布前验收；CI 使用 Windows runner 执行正式 release gate。
- 发布候选还必须运行 `npm run qualify:release`；它串联 clean install、完整源码门禁、Windows 打包、ASAR/敏感信息审计和 packaged/portable smoke，并生成 `qa/qualification/latest.md`。
- 桌面 Smoke 使用隔离的 `APH_USER_DATA`，通过 Playwright Electron/CDP、IPC 或目标程序专用 MCP 操控被测程序并检查真实状态。
- 禁止整机级 computer-use、抢焦点、切换用户窗口、坐标点击和模拟鼠标键盘；这条限制不适用于隔离测试实例内的目标程序自动化。

## 状态层与 Agent 边界

- Project State 是长期真相源；Codex/Claude Code/Hermes 对话只是可轮换的 Session。
- 修复接力只服从当前用户请求与本仓库证据。不得消费外部 ImBack/task-handoff 快照、创建无关任务账本或恢复另一段对话；来源无法绑定本项目当前证据时，标记为无关并回到仓库状态继续。
- 普通任务默认需要用户审核后推进 Project HEAD；自动 Review 只能由显式 `reviewMode=auto` / Section `approvalMode=auto` 或隔离 Smoke 开启。
- transcript 原文只能进入数据盘 archive 的内容寻址对象；状态、Ledger、MCP 和日志只保存有界摘要、路径、hash 与来源指针。
- 主控 Section 只调配/审核；可复用 Section 绑定 workstream；一次性 Section 在接受后关闭。当前执行断点见 `docs/CURRENT_REPAIR_STATUS.md`；旧计划仅为历史材料。

## Smoke 结果标记

真实程序 Smoke 通过后，脚本必须输出 `SMOKE_PASS: <path>`；最终交付回复保留该标记和实际验证命令。未通过时只能报告失败阶段和证据，不能把构建成功写成软件验收成功。

portable 重打包后必须额外运行 `npm run check:packaged-integrity`；它确认 ASAR runtime 与当前源码一致。该检查和 SQLite 等非 Desktop 结果都不能替代真实 Codex Desktop 侧栏冷启动验收。

Windows Sandbox 两轮冷启动、真实 Codex 改码闭环和 30–60 分钟连续体验始终是人工 Gate；自动 qualification 只能报告为 pending，不能代判通过。
