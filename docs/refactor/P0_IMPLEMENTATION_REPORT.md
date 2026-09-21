# P0 重构批次交付报告

状态：PASS_WITH_MANUAL_GATES_PENDING
批次：R00–R06 · 基线 SHA：`45e00e1d6c2e038313be9370aebb378649d51362` · 交付 SHA：NOT_APPLICABLE（未提交）

## 变化与证据

| Task | Finding / Invariant / Test | 修改与最小行为变化 | 旧行为反例 | 修复后证据 |
|---|---|---|---|---|
| R00 | F01–F15 / INV19 / T43 | 固定 SHA、脏工作树、文件摘要、运行时与安装版 Codex 只读能力；逐条复核 Finding。 | 参考包历史证据不能代表当前仓库。 | `P0_BASELINE_REPORT.md`；参考包自检和两个只读 Codex smoke PASS。 |
| R01 | F01 / INV02 / T01–T03 | 自动审核要求：任务契约非空、验收项一一对应且无重复、全部 pass、至少一条非空证据；否则 `inconclusive` 并保留人工确认。 | 空、pending、缺项、重复项或空证据都会被接受。 | `tests/p0-trust-boundaries.test.cjs` R01 PASS；UI 不再把 inconclusive 显示成自动审核成功。 |
| R02 | F02 / INV07 / T07 | 启动迁移只把旧候选标为 `legacy_unverified`，不调用自动接受，不推进 HEAD。 | 旧 review 候选在构造 Store 时自动接受。 | P0 R02 与 context packet migration 测试 PASS。 |
| R03 | F03 / INV09、INV10、INV16 / T11–T15 | 只收集绑定 thread/turn 的 Agent message 或 terminal output；工具输出不入正式候选；只在成功终态提交最后一个完整结果块；失败/缺失身份不写权威结果。 | 工具文本和终态前消息可提前生成候选，且缺失 ID 仍放行。 | P0 R03、agent monitor、large import、failed terminal、重复输出回归 PASS。 |
| R04 | F04 / INV18 / T04–T06 | JSONL 逐行逆序找最新完整快照；记录跳过的坏行。既有 profile 与日志都不可恢复时进入显式 `safe-recovery`，保留损坏原件、禁止新接受并显示中英恢复提示。 | 尾部半行跳过同文件 R7；完全失败时静默播种空状态。 | P0 R04 三项与 renderer recovery 测试 PASS。 |
| R05 | F05–F07 / INV05、INV06 / T08–T10 | `update()` 在 clone 草稿上修改，持久化成功后才发布；直接 writer 用文件指纹检测冲突；主状态先提交，派生 context/Ledger 后生成；派生失败不把已提交事务伪装成失败。 | 修改器抛错污染 live state；stale writer 覆盖新状态；派生投影可领先主状态。 | P0 R05 四项 PASS：抛错回滚、CAS 冲突、主提交失败不发布投影、投影失败仍保留主提交。 |
| R06 | F08、F10（并修正 F09 命名）/ INV04、INV14 / T16–T17 | 引入 `contractRevision`；dispatch 绑定版本，submit/accept 拒绝旧契约。新 provider thread 始终收到自足 FULL packet；逻辑 warm 文案改为“复用工作流”，不再暗示 provider resume。 | 契约改变后旧结果仍可提交；新 thread 可能只收 DELTA。 | P0 R06、FULL packet、UI 命名测试 PASS。 |

## 修改文件

- 可信状态与恢复：`electron/store.cjs`、`electron/state-machine.cjs`
- 结果通道：`electron/agent-run-monitor.cjs`
- 轻量 UI 与类型：`src/view.ts`、`src/types.ts`、`src/app.css`、`src/app-copy.mjs`
- 发布 smoke 契约：`scripts/auto-review-smoke.mjs`
- 回归：`tests/p0-trust-boundaries.test.cjs` 及相关 agent/store/state/UI/release 测试
- 报告：`docs/refactor/P0_BASELINE_REPORT.md`、本文件

## 实际运行

| 命令 / 场景 | 状态 | 结果与限定范围 |
|---|---|---|
| 参考包 `tools/check_packet.py --require-manifest` | PASS | 包内 JSON、Schema、链接、manifest hash；不代表 Harness。 |
| 修改前 `npm test` | PASS | 287/287；同时证明旧测试没有覆盖 P0 风险。 |
| 新 P0 反例首次运行 | FAIL | 9/9 按预期失败：均由旧行为触发，不是语法或测试装配错误。 |
| `node --test tests/p0-trust-boundaries.test.cjs` | PASS | 12/12；覆盖 T01–T17 的本批关键边界、恢复模式接受门禁及提交顺序故障。 |
| 最终 `npm test`（由 release gate 执行） | PASS | 302/302。 |
| TypeScript + Vite build | PASS | `tsc --noEmit && vite build`。 |
| renderer smoke | PASS | 双语、滚动、失败/警告状态、无横向溢出。 |
| 隐藏 Electron app smoke | PASS | `SMOKE_PASS: %TEMP%\aph-app-smoke-report.json`；隔离 profile，窗口保持隐藏且未置顶。 |
| auto-review Electron smoke | PASS | `SMOKE_PASS: E:\_iva_workspace\aph-auto-review-smoke-2026-09-21T07-34-11-090Z\report.json`；严格三项契约全部匹配后才自动推进，持久状态、JSONL、原始归档、Codex import gate 均通过。 |
| 最终 `npm run check:release` | PASS | 完整执行 tests + build + renderer + Electron + auto-review；最终 fresh run exit 0。较早两次分别暴露旧 smoke fixture 只提交 1/3 验收项、弹窗点击被一次异步重渲染吞掉；修正 fixture 与有界重试后重新完整通过。 |
| `npm run smoke:codex-readonly` | PASS | 安装版 Codex `thread/list`，无创建、无模型调用。 |
| `npm run smoke:codex-project-readonly` | PASS | 安装版 `project/list` / `thread/list`；Desktop 侧栏不在证明范围。 |
| `git diff --check` | PASS | 0 whitespace error；仅报告现有 LF→CRLF 警告。 |
| `npm run qualify:release` | PASS | PASS 12 / FAIL 0 / WARN 0；clean install、完整 release gate、打包、审计和 packaged smoke 全通过。 |
| packaged/portable integrity smoke | PASS | `AI-Project-Harness-0.0.22-portable.exe`；ASAR 与源码一致，portable/packaged UI/Electron/missing-Codex/real Codex read-only 均通过。 |
| Windows VM 冷启动、GitHub 陌生用户路径、30–60 分钟 UAT | NOT_RUN | 必须由用户在发布候选上人工执行。 |
| 真实掉电/磁盘故障 | NOT_RUN | 临时目录故障注入不能冒充硬件掉电。 |
| 性能基准 | NOT_RUN | 本批没有性能声明。 |

最终自动门禁标记：`AUTOMATED_GATE=PASS`；人工发布验收：`HUMAN_ACCEPTANCE=PENDING`。

## 数据、权限与迁移

- 未新增依赖、后台服务、账号、网络权限或付费模型调用。
- qualification 阶段未删除用户数据、未操作真实用户 profile；GitHub 发布在完整门禁后作为独立发布步骤执行。
- 新字段 `contractRevision` 对旧项目默认迁移为 1。旧的运行中任务如果没有 run 级契约版本，会被保守拒绝并要求重新启动；不会猜测它仍适用。
- 旧 review 候选继续可见，但状态为 `legacy_unverified`；迁移不会补造 verifier 身份或批准。
- 主状态和 JSONL 仍是当前权威；SQLite 仍只是派生索引，P1 之前不切换。
- 若主状态损坏但 journal 可恢复，记录恢复来源与坏行数；若都不可恢复，进入安全恢复模式，并保留 `.corrupt-*` 原件。

## 用户体验影响

- 正常项目/任务/运行/人工确认路径不增加任何点击。
- 只有证据不完整时才停在“等待你的确认”；不会显示虚假的自动通过。
- 只有检测到不可恢复旧 profile 时才出现恢复提示。
- “温会话”在任务路径改成“复用工作流”；内部仍复用 Section 路由，但新 Codex thread 收到完整上下文，文案不再暗示真实 resume。

## 回退

代码回退必须只反向撤销上表列出的 P0 hunk；当前仓库原本就有大量未提交成果，禁止用 `git reset --hard`、`git clean` 或整文件 checkout。回退后运行 P0 测试和 `npm run check:release`。

数据回退不需要 schema downgrade：新增字段可被旧代码忽略，原 JSON/JSONL 格式仍为 schemaVersion 1。若已经触发安全恢复，优先从保留的 `.corrupt-*`、最新完整 JSONL 或用户备份恢复；不要删除损坏原件。旧运行因 `STALE_CONTRACT` 被拦截时，重新启动任务即可产生当前契约版本的新 run。

## 剩余风险

- F11 不可变候选 digest、受控 verifier 身份与完整证据链仍属于 P2；本批没有把当前自动审查宣传成独立安全认证。
- F12/F13 长期事实索引、语义召回和真实 token 预算仍未验证。
- Codex thread 使用同一项目 cwd；文件系统隔离和并发副本仍属于 P3。
- Desktop 侧栏、真实安装包、虚拟机和连续体验仍需人工 Gate。
- 自动接受：仅保留显式 opt-in 且满足完整契约/证据的现有路径；默认仍为人工。并发：未开放新保证。发布：不允许，本批未执行。
