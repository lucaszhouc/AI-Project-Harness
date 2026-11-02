# Harness 当前修复断点

修复记录：2026-10-27。公开源码说明：2026-11-02。整体状态：**未完成，禁止打包和发布 Release**。

用户要求：全链路纯 DT 原生；禁止 CLI/后台执行器/回退；禁止整机 Computer Use。空项目创建 Review/CTO；非空项目先初始化并写回项目文档，再创建标准对话。不能用旧线程、旧 EXE 或测试计数替代这条业务验收。

## 本轮已修复

- 初始化重复 dispatch：先 `createAndDispatchOnboarding` 再 `prepareUserAgentTask` 必现 `Task cannot be dispatched`。现在仅创建一个 awaiting-user Run，重试保留任务/Run，复制、草稿和持久化提示词使用同一身份。
- 非空目录 create/connect/sync/open 先进入初始化；结果接受并写出上下文后才请求标准对话。共享 `control-conversations.cjs` 处理角色提示词、去重、失败重试和已有 thread ID 复用。
- 两个角色通过深链 `prompt` 分别携带上下文路径，避免 Review 剪贴板内容被 CTO 覆盖。
- 提供 thread ID 只记为 `bound`；旧无证据 `ready` 状态迁移保留身份但撤销就绪声明。跨项目、重复占用、过期替换拒绝；替换要求 expectedThreadId。
- 隔离 smoke 截获对外深链，不再往用户 Desktop 创建测试项目。包完整性检查覆盖全部 Electron 模块及实际打包的外置资源。

## 历史验证与本地运行（2026-10-27）

以下为 2026-10-27 的历史本地验证；原始日志与真实线程标识保留在维护者本机，不随源码发布。

| 命令/检查 | 结果 | 证据 |
| --- | --- | --- |
| 新增故障回归 | 三个故障先复现失败，修复后通过 | `tests/desktop-handoff-regression.test.cjs` |
| `npm run check:local` | 250/250 + TypeScript/Vite PASS | `repair-20261027-check-local.log` |
| `npm run smoke:app` | PASS，隔离 Electron/renderer | `repair-20261027-app-smoke.log` |
| `npm run smoke:mcp-e2e` | PASS，真实 Harness IPC/持久化，截获对外深链 | `repair-20261027-mcp-smoke.log` |
| `git diff --check` | PASS | 本轮命令输出 |
| 41 个 Electron 模块静态扫描 | 未发现 child_process/spawn/execFile 等外部命令启动调用 | 本轮命令输出 |
| `npm run check:packaged-integrity` | FAIL，旧包与源码不一致 | `repair-20261027-old-package.log` |

59 是列出的通道数，不是全部功能通过数。实际验证：空白草稿、绑定/重复绑定/错项目/空 ID、同步绑定线程、非空初始化、同 Run 重试、结果提交/接受、写入上下文后角色交接、坏 token/JSON。

当时使用源码 Electron 验证；旧 EXE 与源码不一致，未重打包。此记录不声明当前仍有相同进程运行。

## 纠正此前错误证据

截图中已有的固定线程，通过 Desktop `read_thread` 核对标题、cwd、首条用户消息和完成状态：

- `APH/Smoke · CTO`：`<private-thread-id>`
- `APH/Smoke · Review`：`<private-thread-id>`

上轮误绑的 `01a16b…` 是另外两条线程。本轮通过正式 `project:attach-control-thread` + expectedThreadId 校正为以上 ID，状态 `bound`。这不是新项目自动创建的证据。

## 尚未完成与下一步

**Harness 自主创建 Desktop 线程、确认项目归属、读取运行状态、自动回写尚未接通。** 会话内置 `create_thread/list_projects/read_thread` 已存在，不能再声称 Desktop 没有这些能力；缺的是 Harness 到原生执行面的可持续传输和调用上下文。

[官方深链说明](https://learn.chatgpt.com/docs/app/commands) 明确 `prompt` 仅预填，不自动发送。不能拿深链、手工绑定、CLI、伪造调用身份或桌面点击代替自动创建验收。

下一步只解决 Harness → Desktop 原生创建与回读连接，从产品入口取得真实 thread ID，再接状态和回写。未完成前不重复新建测试聊天、不宣布全链路通过、不打包。

## 漂移的可核验原因

禁用 CLI 后未完成业务替换，却按测试通过报告进度；混淆深链请求、绑定 ID 和侧栏旧线程；重复入口和缺失的初始化集成测试漏过双 dispatch；旧计划继续留下过时 PASS 和打包下一步。这些是执行与验收失配，不能归咎用户限制不够，也不足以断言模型内部的上下文故障类型。

## GitHub 源码同步（2026-11-02）

本次基于现有 GitHub main 历史同步开发源码；本地仓库历史与远程不共祖，未强推或导入本地历史。公开内容排除运行状态、真实会话标识、测试日志、用户项目与本地归档。公开文档更正旧完成声明。

在隔离的公开源码副本中重新安装依赖并运行：

- `npm run check:local`：250/250，TypeScript/Vite 通过。
- `node scripts/renderer-onboarding-smoke.mjs`：通过。
- `npm run smoke:mcp-e2e`：`SMOKE_PASS: mcp-e2e`。
- `npm run smoke:app`：隔离 Electron 端到端通过，`SMOKE_PASS`。
- 已暂存内容隐私扫描与 `git diff --cached --check`：通过。

以上检查不证明 Desktop 自动创建成功；未运行打包或更新 Release。
