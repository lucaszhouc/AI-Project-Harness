> Historical material. Desktop-native repair is incomplete; see [current status](../CURRENT_REPAIR_STATUS.md). Older execution and PASS claims do not describe this source revision.

# 故障排查

## Codex Desktop 不可用

先在 Codex Desktop 自己的界面中启动，再重试原生项目注册。Harness 不安装软件、不搜索 CLI，也不修改系统设置。

## Desktop 尚未登录

在 Codex Desktop 自己的界面中完成登录，再重试。不要把密码、验证码或 token 粘贴到 Harness。

## Desktop 原生检查报错

`DESKTOP_NATIVE_UNAVAILABLE` 表示当前 Desktop 没有提供所需原生操作。记下错误编号、Desktop 版本、操作和时间；只有 Desktop 状态变化后再重试。

## 连接结果未知

先点“检查连接结果”，或者重新打开 Harness。不要因为界面暂时没反应就重复新建项目。

## 任务无法开始

看看按钮旁边的原因。常见情况包括：项目已归档、还没连接 Codex、已有任务正在运行、前置任务没完成，或任务分区已关闭。新建任务只是保存，点“开始任务”才会执行。

## 审核已陈旧

先刷新状态，再重新查看结果。为了避免覆盖较新的进度，Harness 不会接受基于旧版本生成的结果。

如果还解决不了，反馈时请附上：程序版本、Windows 版本、界面语言和缩放比例、你刚才做了什么、预期和实际结果，以及截图或错误编号。请先删掉密码、token 和私密提示词。
