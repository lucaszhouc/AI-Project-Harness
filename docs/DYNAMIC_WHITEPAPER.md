# 动态白皮书说明

AI Project Harness 的长期项目文档分为两层：

1. 仓库内的产品白皮书 `WHITEPAPER.md`：记录产品定义、架构决策和版本历史，由维护者在功能拍板后更新。
2. 数据盘中的项目动态白皮书 `projects/<project-id>/PROJECT-LEDGER.md`：由程序根据 Project State、Git、GitHub、Section、checkpoint 和归档索引自动生成，每次状态写入都会原子更新。

动态白皮书不把完整对话压成一句不可验证的摘要。原始 transcript 进入 `archive/objects/<sha256>`，项目状态只保存结构化结论和来源指针；新 Agent 通过 Bootstrap/Delta Packet 按需读取。这样既保留可恢复的原文，也避免把长期工程继续绑在一个无限增长的 `resume` 对话上。

## 自动生成位置

```text
<APH_DATA_ROOT>/projects/<project-id>/PROJECT-LEDGER.md
<APH_DATA_ROOT>/projects/<project-id>/context/cto-context.md
<APH_DATA_ROOT>/projects/<project-id>/context/review-context.md
<APH_DATA_ROOT>/archive/objects/<sha256>/<sha256>
<APH_DATA_ROOT>/archive/manifests/<archive-id>.json
```

面板“项目详情 → 打开动态白皮书”会直接打开当前项目的 Ledger；“导入会话归档”只写入对象和 manifest，不会把全文送回当前聊天。

## 外部 Codex 可见性边界

`PROJECT-LEDGER.md` 可以记录 Harness 已经拿到的官方 `projectId`，但不能据此声称 Codex Desktop 侧栏已经显示。现代 Codex 的官方 Project 以 app-server/SQLite 为事实层；Desktop 进程不会热加载 Harness 从外部写入的状态。真实侧栏必须在完全退出 `ChatGPT.exe` 后冷启动逐项核对。旧 `.codex-global-state.json` 仅是兼容缓存，Harness 默认不写入；审计记录见 `qa/audit-20260904-codex-project-visibility.md`。
