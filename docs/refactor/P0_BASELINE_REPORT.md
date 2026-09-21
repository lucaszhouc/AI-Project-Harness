# P0 重构基线报告

状态：COMPLETE（只读基线已固定；问题状态指 P0 修改前的工作树）

## 仓库与安装物

- 目标仓库：`AI-Project-Harness`
- 分支：`main`
- 固定提交：`45e00e1d6c2e038313be9370aebb378649d51362`
- 包版本：`0.0.21-rc.1`
- 基线采集时间：2026-09-21T06:54:14.097261Z
- 基线工作树：45 个 tracked 文件已修改、106 个 untracked 文件；这些既有成果均保留，未执行 reset、clean、stash、checkout 或历史改写。
- 运行时：Windows 11 家庭版 10.0.26200（NTFS）；Node v24.14.1；npm 11.11.0；Electron 41.3.0；Codex CLI 0.147.0。
- 参考包：v1.0，ZIP SHA-256 `CF2417B933CBE72429E16C332164AF20E7EFFD8F36BC747B1D1BB1CA516D7D84`；manifest、JSON、Schema 与本地链接检查 PASS。参考包没有固定到目标仓库提交，因此只作为审查线索。
- 关键文件基线 SHA-256：`package.json` `b8a30248...f781bf`；`electron/store.cjs` `69c4fe7e...ed68`；`electron/state-machine.cjs` `27a9efcd...39ea7`；`electron/agent-run-monitor.cjs` `300fcd65...9eb4`。完整摘要保存在仓库外的只读采集 JSON 中。

## 现有测试与协议能力

- 修改前 `npm test`：PASS，287/287。
- 参考包自检：PASS；它不代表目标程序通过。
- 安装版 Codex 只读探测：`thread/list` PASS；发现 6 个近期工作目录。
- 安装版 Codex Project 只读探测：`project/list` / `thread/list` PASS；10 个官方 Project、26 个近期 thread。没有调用 `project/create`、`thread/start`、`turn/start` 或模型。
- Desktop 侧栏可见性：NOT_RUN；它需要人工冷启动核对，不能由 app-server 列表代判。

## F01–F15 复核

| Finding | 基线结论 | 目标实现证据 | 限制 / 阶段 |
|---|---|---|---|
| F01 | REPRODUCED | `electron/state-machine.cjs` 的自动审核只排除显式 fail；空、pending、缺项、重复项和空证据反例均可推进。 | R01 / P0 |
| F02 | REPRODUCED | `electron/store.cjs` 启动时会对无 review 元数据的旧候选调用自动审核。 | R02 / P0 |
| F03 | REPRODUCED | `electron/agent-run-monitor.cjs` 会聚合通知文本，并在终态前从工具/消息文本提交首个合法块。 | R03 / P0 |
| F04 | REPRODUCED | `recoverFromJournal()` 的 catch 覆盖整份日志；尾部半行会跳过同文件更早完整快照。 | R04 / P0 |
| F05 | REPRODUCED | `HarnessStore.update()` 直接修改 live state；修改器抛错后内存保留半状态。 | R05 / P0 |
| F06 | REPRODUCED | `write()` 不重载/校验最新磁盘状态，两个 writer 可发生最后写覆盖。 | R05 / P0 |
| F07 | SOURCE_CONFIRMED | context/Ledger 投影在主状态 rename 前执行，存在投影领先主状态的提交顺序风险。 | R05 / P0 |
| F08 | REPRODUCED | `updateProjectContract()` 不产生独立契约版本；旧 run 可在契约改变后提交。 | R06 / P0 |
| F09 | SOURCE_CONFIRMED | Codex task 使用 `thread/start` 新建 thread，并把项目路径作为 cwd；逻辑 warm session 不等于文件隔离或 provider resume。 | P0 修正文案；隔离留 P3 |
| F10 | REPRODUCED | 复用逻辑 session 时，新 provider thread 只收到 DELTA packet。 | R06 / P0 |
| F11 | SOURCE_CONFIRMED | 普通接受校验 run/project revision，但没有不可变 candidate digest 全绑定。 | P2；本轮不伪造实现 |
| F12 | SOURCE_CONFIRMED | events/checkpoints/decisions 等内存数组有固定上限；原始 run transcript 另行内容寻址归档。 | P3 长期事实索引 |
| F13 | SOURCE_CONFIRMED | mission/context packet 有字符预算和裁剪提示。 | P2/P3；实际语义召回 NOT_RUN |
| F14 | NOT_PRESENT | SQLite 当前明确是可选派生索引，不是唯一权威状态；这与参考包描述一致，不作为缺陷修。 | P1 决策待 spike |
| F15 | SOURCE_CONFIRMED | `check:release`、`qualify:release` 和人工 Gate 已分层存在；基线时只证明命令存在，不证明本批通过。 | 本批重新实跑 |

## 安全与产品基线

- 默认普通任务审核：人工；显式自动模式存在，但基线门禁不完整。
- 普通用户路径：项目、任务、运行、确认结构保持；P0 不新增正常路径步骤。
- 真实用户数据备份：NOT_RUN。原因：本批不执行真实 profile 迁移，也不读写用户生产数据；故障与迁移测试全部使用系统临时目录。
- 冷启动、真实 Windows EXE、掉电、磁盘故障、30–60 分钟 UAT：NOT_RUN。
- 付费模型、外部 API、发布、push、PR、远端写入：NOT_RUN。

## 首批范围

- 执行：R00–R06，仅 P0。
- 不做：SQLite 权威切换、不可变候选对象库、审查沙箱、并发工作副本、Git saga、长期向量检索、框架重写。
- 回退原则：只反向撤销本批列出的局部 hunk；禁止对当前脏工作树使用 `git reset --hard`、`git clean` 或整文件 checkout。
