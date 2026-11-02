> Historical material. Desktop-native repair is incomplete; see [current status](../CURRENT_REPAIR_STATUS.md). Older execution and PASS claims do not describe this source revision.

# 常用按钮

| 按钮 | 点下去会发生什么 | 不会发生什么 |
|---|---|---|
| 新建空白项目 | 创建 Harness Project、官方 Codex Project、CTO/Review 控制面并打开 CTO。 | 不会搜索历史或启动整理 turn。 |
| 关键词整理 | 用关键词搜索活跃/归档对话和消息 occurrence，启动一次真实整理并等待审核。 | 不会把有界回退索引伪装成完整全文搜索。 |
| 手动选对话 | 只读取勾选的对话，启动一次真实整理并等待审核。 | 不会读取未选对话或扩展范围。 |
| 再检查一下 | 重新检查 Codex、Git 等工具现在是否可用。 | 不会替你登录，也不会启动普通开发任务。 |
| 连接 Codex | 为当前项目准备 Codex 项目和管理对话。 | 连接失败不会删除当前项目。 |
| 整理选中对话 | 只读取勾选的 Codex 对话，生成待审核的项目知识包。 | 不会读取未选对话，也不会把整理指令当成普通开发任务。 |
| 创建任务 | 保存一项待开始的任务。 | 不会立刻让 Agent 开工。 |
| 开始任务 | 正式启动 Agent 执行这项任务。 | 不会自动接受执行结果。 |
| 拒绝结果 | 标记这次结果不通过。 | 不会自动撤销已经改动的文件。 |
| 退回修改 | 让任务回到可以继续修改的状态。 | 不会自动恢复源代码。 |
| 接受并推进 HEAD | 接受这次结果，并更新 Harness 里的项目进度。 | 不会自动执行 Git commit 或 push。 |
| 停止任务 | 停止 Harness 记录的这次运行。 | 不会撤销 Agent 已经写入的文件。 |
