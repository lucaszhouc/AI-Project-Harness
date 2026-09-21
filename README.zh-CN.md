# AI Project Harness

> Windows 上本地优先的编程 Agent 工程连续性工具。

[![Release](https://img.shields.io/github/v/release/lucaszhouc/AI-Project-Harness)](https://github.com/lucaszhouc/AI-Project-Harness/releases/latest) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D4)](https://github.com/lucaszhouc/AI-Project-Harness/releases/latest) [![Electron](https://img.shields.io/badge/Electron-41-47848F)](https://www.electronjs.org/)

**Git 记住代码怎么变，Harness 记住项目为什么这样变。**

AI Project Harness 会保存项目目标、任务、重要决定和审核结果。即使你换了 Codex 对话，已经确认过的项目进度也不会跟着丢失。

[English](README.md) · [首次运行](docs/guide/first-run.zh-CN.md) · [故障排查](docs/guide/troubleshooting.zh-CN.md) · [数据与备份](docs/guide/data-and-backup.zh-CN.md) · [开发说明](DEVELOPMENT.md)

## 它能做什么

- 先新建一个本地项目，不会自动连接 Codex，也不会读取你的代码。
- 需要 Agent 时，再由你决定是否连接 Codex；连接失败不会删除项目。
- 可以从现有 Codex 项目导入资料，但当前版本不会按关键词翻遍所有历史对话。
- 新任务创建后不会自动开工，只有点击“开始任务”才会执行。
- Agent 完成后先由你检查，只有接受结果才会更新 Harness 里的项目进度。
- 退出再打开，项目和任务状态仍会保留。

## 支持的发行路径

请直接从唯一的[最新版本页面](https://github.com/lucaszhouc/AI-Project-Harness/releases/latest)下载 Windows x64 portable EXE，并把字节数和 SHA-256 与随附 manifest 对照。仓库只保留一个受支持的公开 Release，新用户不需要分辨版本。

运行打包 EXE 不需要源码或开发构建环境。当前 Codex adapter 在连接、导入和执行任务时需要兼容的 Codex CLI；没有 Codex 仍可建立本地项目和保存任务草稿。见[连接 Codex](docs/guide/connect-codex.zh-CN.md)。

portable EXE 目前未签名，Windows 可能显示来源警告。请核对精确 Release 页面和 SHA-256；不要关闭 SmartScreen、杀毒或其他系统防护。

## 第一次使用

1. 启动 EXE。第一次打开时，项目列表应该是空的。
2. 点击“小助手”，再点“新建项目”。
3. 名称可以填 `我的第一个项目`；目标可以先留空，也可以写 `完成第一个可验收任务`。
4. 点击“新建项目”。这一步只在本机保存资料。
5. 需要 Agent 时，再点击“连接 Codex”。阅读提示并确认后才会连接；失败不会删除项目。
6. 点击“新建任务”，写清任务内容和验收条件。第一次使用建议保持“用户确认后推进”。
7. 创建完成后，任务还没有执行。准备好时再点“开始任务”。
8. Agent 完成后，先打开项目文件夹亲自检查。拒绝或退回不会自动恢复文件；接受结果也不会自动 commit 或 push。
9. 退出并重新打开 Harness，确认刚才的项目和任务仍然存在。

确切字段和故障恢复见[完整首次运行教程](docs/guide/first-run.zh-CN.md)。

## 创建、连接、导入不是一件事

| 动作 | 实际行为 | 不会做什么 |
|---|---|---|
| 新建项目 | 保存项目名称、目标和其他基本资料。 | 不会自动连接 Codex，也不会读取代码。 |
| 连接 Codex | 为当前项目准备 Codex 项目和管理对话。 | 连接失败不会删除当前项目。 |
| 从 Codex 导入 | 从你选中的 Codex 项目导入现有信息。 | 不会按关键词搜索所有历史对话。 |

## 任务与审核

- “创建任务”只负责保存；“开始任务”才会让 Agent 开工。
- “拒绝结果”和“退回修改”不会自动恢复已经改过的文件。
- “接受并推进 HEAD”会更新 Harness 里的项目进度，但不会替你提交 Git。
- 自动审核是高级选项，只有你明确打开时才会生效；小助手不会偷偷开启它。

更多细节见[项目](docs/guide/projects.zh-CN.md)、[第一项任务](docs/guide/first-task.zh-CN.md)和[按钮说明](docs/guide/buttons.zh-CN.md)。

## 隐私与安全

小助手没有聊天框，也不会额外调用模型。它只根据当前项目和任务状态告诉你下一步可以做什么。

Harness 不请求或保存 OAuth code、密码、cookie 或 token。公开文档同步不读取本机项目名单。见[安全与隐私](docs/security-and-privacy.md)与 [SECURITY.md](SECURITY.md)。

## 发布状态

<!-- APH_AUTO_STATUS_START -->
- 包版本：v0.0.22
- 发布状态：当前 GitHub 正式公开版本。
- 有意排除本机项目名称和宿主状态。
<!-- APH_AUTO_STATUS_END -->

项目由 [@lucaszhouc](https://github.com/lucaszhouc) 以 [MIT License](LICENSE) 发布。当前是单人维护，最快联系方式为 [lucaszhouc@gmail.com](mailto:lucaszhouc@gmail.com)。

## 开发

贡献者请阅读 [DEVELOPMENT.md](DEVELOPMENT.md)。正式自动门禁依次为：

```powershell
npm run check:release
npm run qualify:release
npm run check:packaged-integrity
```

自动全过只能写 `AUTOMATED_GATE=PASS`；Windows/Codex 侧栏冷启动与 30–60 分钟人工体验在明确执行前始终是 `HUMAN_ACCEPTANCE=PENDING`。
