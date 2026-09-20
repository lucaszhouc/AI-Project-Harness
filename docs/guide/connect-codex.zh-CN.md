# 连接 Codex

连接前，请先确认 Codex CLI 已经安装并登录。Harness 会分别检查安装、登录和连接能力，不会只凭一个“已安装”就假装全部正常。

1. 按照 [Codex CLI 官方安装说明](https://developers.openai.com/codex/cli)完成安装。
2. 在终端运行 `codex --version`，确认命令可以正常执行。
3. 运行 `codex login`，按浏览器里的官方流程完成登录。不要把账号或验证码填进 Harness。
4. 回到 Harness，点“再检查一下”。
5. 检查通过后，先新建项目，再点“连接 Codex”。确认提示内容后再继续。

连接可能会创建 Codex 项目和管理对话，也可能使用你的 Codex 额度。即使连接失败，刚才新建的项目仍会保留，你可以修好外部问题后重试。

Harness 不会在检查过程中启动 Agent。Codex 的 app-server 目前仍是实验性能力，详见[官方说明](https://developers.openai.com/codex/app-server)。
