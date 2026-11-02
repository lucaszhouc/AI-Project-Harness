> Historical material. Desktop-native repair is incomplete; see [current status](../CURRENT_REPAIR_STATUS.md). Older execution and PASS claims do not describe this source revision.

# 项目

“新建空白项目”会创建 Harness Project、官方 Codex Project 和 CTO/Review 控制面，并只打开 CTO。它不搜索历史、不创建整理 session，也不启动整理 turn。

“关键词整理”接收项目关键词或简称。Harness 优先调用 Codex 的活跃/归档线程搜索和消息 occurrence 定位，再启动一个独立整理 thread。整理结果先作为候选等待审核，接受后才写入项目 Ledger、知识索引和归档；原生搜索能力缺失时只使用有界本地索引回退。

“手动选对话”只读取你勾选的 Codex 对话，使用固定的默认整理目标，再附加你填写的要求，提取 SOP、规则、项目细节、任务、决策和证据。不会因为相似标题、目录、父子线程或 Project 自动扩大范围，所选来源和写回结果都会保留 provenance。

三种入口点击后都会立即离开表单，进入统一创建进度弹窗。只有真实 Codex `turn/start` 已取得 thread、turn 和进程后才显示运行中；创建准备、等待审核、失败和 Desktop 打开失败都有独立状态。

已归档的项目不能新建或开始任务。点“恢复项目”只会重新启用它，不会改动 Git，也不会删除或恢复 Codex 对话。
