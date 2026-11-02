# AI Project Harness

> Windows 上本地优先的编程 Agent 工程连续性工具。

**Git 记住代码怎么变，Harness 记住项目为什么这样变。**

Harness 在对话之外保存项目目标、任务、决策、审核、检查点和证据。更换对话或重启程序后，已经接受的项目状态仍然保留。

[English](README.md) · [当前修复状态](docs/CURRENT_REPAIR_STATUS.md) · [开发说明](DEVELOPMENT.md) · [MIT 许可证](LICENSE)

## 当前源码状态

版本 `0.0.25-rc.6` 的 **Desktop 原生链路修复尚未完成**。本次只更新源码，不发布 Release、不替换已有 EXE。真实 Desktop 创建、回读和回写链路通过前继续禁止打包。

- 产品集成使用 Codex Desktop 原生深链，已移除 Codex CLI、app-server 执行和后台 provider 回退。
- 空白项目请求 Review/CTO 草稿；非空项目先准备初始化任务，接受结果并写出项目上下文文件后，再请求其余标准对话草稿。
- 深链只能预填草稿，不会自动发送，也不会返回新 thread ID。Harness 尚未接通自动创建线程、确认项目归属、监视运行和自动回写所需的 Desktop 原生传输。
- 提供 thread ID 只记为 `bound`，不代表已经验证或就绪。本地状态、深链请求成功和 Desktop 已有线程是不同的证据。
- 缺少原生连接的历史搜索、选择和导入明确阻断，不回退到命令行。

## 可用的本地流程

1. 新建或连接 Harness 项目并选择目录。
2. 非空项目先准备初始化草稿；重试保持任务与 Run 身份一致。
3. 提交的结果经过审核、接受后才推进项目状态；接受初始化后写出标准对话草稿需要的上下文。
4. 新建任务只保存任务，准备好后再主动派发 Desktop 交接。任务或草稿存在不等于 Agent 已运行。
5. 接受结果前检查文件与证据。接受会推进 Harness HEAD，不会自动 commit 或 push；拒绝结果不会回滚已修改的文件。

## 开发与验证

Windows 开发环境使用 Node.js 24：

```powershell
npm ci
npm run check:local
npm run smoke:renderer
npm run smoke:app
npm run smoke:mcp-e2e
```

Electron 与 MCP smoke 使用隔离数据，并截获向 Desktop 发出的深链。它们验证 Harness 本身，不证明真实 Desktop 自动创建成功。隔离启动和打包门禁见 [DEVELOPMENT.md](DEVELOPMENT.md)。旧指南和白皮书保留为历史材料，以当前修复状态为准。

## 隐私

Harness 不索取 Codex 账户凭据。本地控制端点会生成鉴权 token；不要公开端点文件、项目状态、对话原文或测试数据。公开文档同步只读取包元数据。见[安全与隐私](docs/security-and-privacy.md)。

## 发布状态

<!-- APH_AUTO_STATUS_START -->
- 包版本：v0.0.25-rc.6
- 发布状态：本地候选；不表示已经公开发布。
- 有意排除本机项目名称和宿主状态。
<!-- APH_AUTO_STATUS_END -->

现有 [GitHub Release](https://github.com/lucaszhouc/AI-Project-Harness/releases) 是独立的历史产物，除非明确说明，不包含本次尚未完成验收的修复。

维护者：[@lucaszhouc](https://github.com/lucaszhouc)。联系：[lucaszhouc@gmail.com](mailto:lucaszhouc@gmail.com)。
