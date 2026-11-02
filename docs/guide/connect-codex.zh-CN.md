# 连接 Codex Desktop

Harness 只通过已安装的 Codex Desktop 原生深链和桌面控制面工作，不安装、探测或调用 Codex CLI/app-server。

1. 先在 Codex Desktop 自己的界面中启动并登录。Harness 不索要账号、密码或验证码。
2. 回到 Harness，新建或选择本地项目，点击“连接 Codex”。
3. Harness 发送原生 `codex://` 请求。请确认项目是否出现在 Codex Desktop 侧栏。
4. Desktop 没有提供某项原生能力时，Harness 返回明确阻断状态，并保留本地项目。

项目只有在 Desktop 侧栏实时回读后才算可见。深链发出本身只记录为待核对状态，任何 CLI/app-server 结果都不能替代侧栏证据。
