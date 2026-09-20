---
title: AI Project Harness Dynamic Whitepaper
working_title: AI Project Harness
status: LIVING_DRAFT
version: 0.23.0
last_updated: 2026-09-14 16:00 JST
canonical: true
---

# AI Project Harness 动态白皮书

> **Git versions the code. Harness versions the intent.**
> 项目长期存在，Agent 会话随时轮换。

## 0. 文档契约

这是项目的权威动态白皮书，不是一次性宣传稿。它负责维护当前产品真相、明确决定、待验证假设和被替代路线。

状态标签：

- `DECIDED`：当前已经拍板，后续设计以此为约束。
- `PROPOSED`：有明确倾向，但仍需原型或实测确认。
- `OPEN`：尚未决定。
- `SUPERSEDED`：曾经成立，后来被新决定替代；保留原因和时间。
- `IMPLEMENTED`：已经进入当前代码或可运行切片，仍以对应验收范围为准。
- `VERIFIED LOCALLY`：已在记录的本机版本实测，不代表厂商长期稳定承诺。
- `LIMITATION`：当前明确未实现、不可用或尚未通过的边界。

更新规则：

1. 产品定位、核心对象、协议、MVP、兼容性、安全边界或验收方式发生变化时更新本文。
2. 每次实质更新提升版本并追加变更记录。
3. 新结论必须区分事实、推论和待验证假设。
4. 已接受的关键决定不静默删除；改变时写入 `SUPERSEDED` 和替代理由。
5. README 只呈现稳定入口，本文保留完整演化过程。

## 1. 摘要

AI Project Harness 是一个附着在 Git 项目之上的本地 AI 工程状态版本控制与跨 Agent 连续性工具。

现有 Codex、Claude Code、Hermes 等编程 Agent 以 session 为主要实体；真实工程却以 project 为长期实体。把长期项目押在不断 `resume` 的会话上，会造成历史膨胀、状态漂移、compact 后失忆、多会话冲突、目标重复和归档失效。

项目历史也很少天然等于一个命名规范的对话或一个厂商 Project：同一工程可能散落在多个活跃/归档对话中，一个对话也可能混有多个工程。若只按对话名、Project ID 或最近目录定位，导入会稳定漏掉真正的历史。

本项目建立一个独立于任何单一 Agent 的 Project State Repository。它保存项目目标、验收条件、当前 objective、checkpoint、决策、阻塞、下一步、Git 证据和会话来源；再通过 MCP、skills、CLI 和 Agent adapters 与各家工具双向连接。

产品承诺不是“把所有历史永远塞进上下文”，而是：

> 原始信息可以恢复；当前状态可以验证；每个新 Agent 只获得完成当前任务所需的最小上下文。

## 2. 问题定义

### 2.1 Session-first 与 Project-first 的冲突

编程 Agent 当前普遍擅长完成一次任务，却缺少跨任务、跨会话、跨 Agent、跨天的项目级连续性。

典型症状：

- 同一项目依赖一个长期会话反复 resume，rollout 或 transcript 不断增大。
- compact 后丢失最近错误、当前进度、关键路径和下一步。
- 新会话必须重新解释技术栈、目标、约束和历史决定。
- 同一项目出现多个互相冲突的 active 目标。
- 已暂停、已替代和已完成的工作缺少明确生命周期，列表只进不出。
- 切换到另一种 Agent 时，项目状态无法可靠迁移。
- Git 只能证明代码变化，无法表达工程意图和认知状态。

### 2.2 Git 已解决什么，没有解决什么

Git 已经提供成熟的不可变历史、内容寻址、分支、引用、diff、合并和审计模型。它是代码事实源，但不是完整的项目认知状态源。

Git 通常无法直接回答：

- 当前最重要的目标和验收条件是什么？
- 上一个 Agent 做到了哪里，为什么停下？
- 哪些方案已经验证失败，为什么不能重走？
- 当前阻塞属于代码、环境、权限还是外部依赖？
- 哪个 commit 只是实验，哪个 checkpoint 被项目接受？
- 下一位 Agent 应该读取哪些文件和证据，而不是整个历史？

Harness 不替代 Git，而是在 Git 上方补齐这一层。

## 3. 产品类别与定位

`DECIDED` 当前类别定义：

> **Local-first AI Project Continuity Harness**
> 一个 Git-native 的 Project State Version Control System。

它不是：

- 聊天记录管理器。
- 通用项目管理或 Kanban 产品。
- 单纯的多终端启动器。
- 多 Agent 并发调度平台。
- Git 客户端、IDE 或 GitHub 的替代品。
- 把旧 transcript 全文再次注入模型的 memory 工具。

它首先解决多 Agent interoperability 与 handoff。真正的 orchestration 可以以后建立在可靠状态协议之上，但不是 MVP 前提。

## 4. 核心原则

### P1. Project 是长期实体，Session 是可抛弃执行窗口

`DECIDED` 删除任意 Agent 会话不应损坏项目状态。`resume` 可以作为审计或异常恢复入口，但不能成为正常工程连续性的基础。

### P2. Git 管代码事实，Harness 管项目意图

`DECIDED` Git commit、diff、branch、PR 和 CI 是 evidence。Harness 保存目标、决策、接受状态和下一步。任何一方都不冒充另一方。

### P3. Store losslessly, reason selectively

`DECIDED` 原始会话可以无损归档；面向模型的上下文必然是选择性视图。禁止宣传“把几 GB 对话语义无损压缩成几千 tokens”。

### P4. 状态变化必须显式、可追溯

`DECIDED` objective、decision 和 checkpoint 的改变必须留下来源、时间、作者或 Agent、父状态和证据引用。重要状态不能被后台总结静默覆盖。

### P5. 一个项目只能有一个主 active objective

`DECIDED` 项目可以保存多个 planned、paused、blocked、completed 或 superseded objectives，但同时最多一个主 active objective。并行工作以后通过 workstream 或 child objective 表达，不制造多个互相争夺 HEAD 的主目标。

### P6. 兼容性通过公共协议扩展

`DECIDED` 核心状态模型不能依赖某个厂商的 transcript 格式。每个 Agent 通过小型 adapter 和 skill pack 接入。

### P7. Task 不等于 Session

`DECIDED` Task 是可验收工作单元，Run 是一次执行尝试，Session 是上下文容器，Agent 是执行者。一个 Task 可以有多个 Run；一个健康的 Session 可以执行同一 workstream 内的多个相关 Task。禁止把任务生命周期和会话生命周期强制一一绑定。

### P8. 调配者不能成为新的永久大脑

`PROPOSED` Project Steward 是读取结构化 Project HEAD 的轻量控制角色，而不是一个无限增长的主聊天。确定性规则负责版本、租约、状态迁移和审核门；需要推理时临时调用 planner/reviewer，输出仍然只是待审核提案。

### P9. 空白创建与既有历史收集是两个不同事务

`DECIDED` 空白创建不查询 Agent、不读取仓库、不伪造历史；既有历史收集从用户给出的主题开始，跨活跃与归档会话寻找内容证据，再由专用只读 Agent 生成结构化候选。两条路径不得复用同一个 onboarding 动作。导入候选在用户接受前不能改变 Project HEAD、任务、Section、CTO/Review、Git 或 GitHub 真相。

### P10. 主题是检索入口，不是项目身份

`DECIDED` 用户不需要知道精确对话名、Project ID 或仓库路径。对话标题、Codex Project、工作目录、Git root、remote、包名和域名都只是关系信号；项目边界由消息内容命中与关系图共同确定。一个项目可以跨多个对话，一个对话也可以按消息归入多个项目。

## 5. Git-native 状态模型

Harness 借用 Git 的不变量和用户心智，而不是直接复制 Git 实现。

| Git 概念 | Harness 概念 | 说明 |
|---|---|---|
| Repository | Project | 长期工程实体 |
| Commit | Checkpoint | 一次被记录的项目状态变化 |
| HEAD | Accepted Project State | 当前被项目接受的状态 |
| Branch | Objective / Workstream | 目标或探索方向，不强制等同于代码分支 |
| Parent | State lineage | 状态的演进关系 |
| Tag | Milestone | 可命名、可审计的稳定节点 |
| Diff | State delta | 目标、决策、阻塞、证据和下一步的变化 |
| Checkout | Mission Packet | 为某个 Agent 和任务检出有限状态 |
| Merge | Reconciliation | 合并并发 Agent 结果并显式解决冲突 |
| Reflog | Event / Session archive | 状态变化和来源的恢复路径 |

`DECIDED` Objective 与 Git branch 不做强制一一映射。一个 objective 可能跨多个代码分支，多个小任务也可能共享一个分支。Harness 通过 commit hash、diff、文件路径、PR 和 CI run 建立证据关系。

## 6. 双仓模型

```text
┌──────────────────────────┐       evidence        ┌──────────────────────────┐
│ Code Repository          │ ────────────────────> │ Project State Repository │
│ Git                      │                       │ Harness                  │
│ source / diff / commit   │ <──── references ─── │ intent / state / lineage │
│ branch / PR / CI         │                       │ session provenance       │
└──────────────────────────┘                       └──────────────────────────┘
```

### 6.1 Code Repository

Git 保持源代码、提交和协作流程的权威地位。Harness 默认不修改用户 Git 历史，不因为 checkpoint 自动 commit，也不把运行状态伪装成代码进度。

### 6.2 Project State Repository

Project State Repository 保存：

- Project contract：目标、验收条件、技术栈、约束。
- Objective：当前工作与生命周期。
- Checkpoint：完成内容、未完成内容、阻塞、下一步。
- Decision：选择、理由、替代方案和否决路线。
- Evidence reference：commit、diff、文件、测试、Issue、PR、CI。
- Session reference：Agent、session、时间、导入来源和状态。
- Provenance：结构化结论回到原始事件的指针。

## 7. 三层信息架构

### 7.1 Raw Archive：无损归档层

目标是保存和恢复来源，而不是直接服务每次推理。

`PROPOSED` 采用流式导入、内容寻址对象库、压缩和 payload 去重。会话 manifest 保留事件顺序；重复图片、工具输出和大型 payload 只保存一个对象，通过 hash 引用。

可承诺的无损边界：只要厂商的本地 session/export 中仍存在原始数据，Harness 可以保留可恢复副本。厂商已经删除、compact 时未落盘或从未提供的数据无法凭空恢复，必须明确标记缺失。

### 7.2 Project Ledger：有据状态层

Project Ledger 是面向工程连续性的结构化事件与当前投影视图。

每条关键 claim 至少包含：

- claim 类型与内容。
- 来源 session/event。
- 相关文件、diff、commit 或测试证据。
- 提取者和提取时间。
- 置信或验证状态。
- 被接受、修正或 supersede 的关系。

`DECIDED` Agent 自述不自动等于事实。能由 Git、文件和测试验证的内容自动附证；无法验证的内容标记为 agent-reported 或 needs-review。

### 7.3 Mission View：按需检出层

Mission Packet 是针对一个 objective、一个 Agent 和一次任务生成的临时视图。新 Session 首次获得 Bootstrap Packet；已同步的温 Session 后续只获得从自身 state cursor 到最新 Project HEAD 的 Delta Packet。

默认包含：

- 项目目标和验收条件。
- 当前 objective 与完成定义。
- 最新 accepted checkpoint。
- 当前阻塞、约束和关键决策。
- 相关关键文件。
- 必要 Git 摘要和证据指针。
- 要求 Agent 回写 checkpoint 的协议。
- 当前 project revision、session cursor 和 task lease。

`PROPOSED` 默认预算约 2,000 tokens，可按任务风险调整，但必须设置硬上限。完整 transcript、图片 payload 和无关工具输出禁止自动进入 Mission Packet。

`PROPOSED` 对温 Session 的后续任务优先发送更小的 Delta Packet，只包含新增 checkpoint、decision、Git 变化和本次 task contract；Agent 仍可通过 MCP 按需查询完整证据。

## 8. 双向集成架构

```text
Codex / Claude Code / Hermes
        │
        ├── Agent Pack ──────── import / checkpoint / decision
        │                              │
        │                              ▼
        │                   Local Harness Core
        │                   ├─ Project State Protocol
        │                   ├─ Session Import Protocol
        │                   ├─ Evidence resolver
        │                   └─ Mission compiler
        │                              │
        └──── bounded context ◀────────┘
```

### 8.1 Harness → Agent

- 选择 project 和 objective。
- 生成 Mission Packet。
- 选择并启动已安装 Agent。
- 设置工作目录和显式任务入口。
- 暴露只读上下文和允许的写回工具。
- 保留关联 session ID 或 deep link；不依赖 resume 完成连续性。

### 8.2 Agent → Harness

- 导入当前或选定历史 sessions。
- 获取当前 project context。
- 提交 candidate Task Result；用户接受后由 Harness 形成正式 checkpoint。
- 记录 decision、blocker 和 evidence。
- 完成、暂停、阻塞或 supersede objective。
- 将本轮 session 与 objective 和 Git 状态关联。

`DECIDED` Codex 首发有两条独立入口：

- 空白创建：只建立 Harness Project；用户手填长期契约，之后再决定是否连接 Codex。
- 既有历史收集：用户只输入一个近似主题。Harness 先对全部活跃与归档会话做全文检索，再按 Project ID、Git root、remote、cwd、父子线程、共享文件路径、包名和域名扩展关系；以消息 occurrence 为单位归类，将关联 rollout 在模型上下文外无损归档，最后让带 `MODE: IMPORT` 的专用 Agent 只整理有限证据。Agent 返回的 `harness-import` 只能成为候选；用户接受后才合并。

对话标题、Codex Project ID、目录 mtime、文件名日期和旧摘要都不能单独充当项目边界或“最新进展”。重复导入按来源 occurrence 与 revision 幂等合并；较旧 source revision 不能覆盖较新的 Git/GitHub 快照。

### 8.3 Agent Pack

`PROPOSED` 每个 Agent Pack 由两部分组成：

1. Adapter manifest：发现安装位置、能力、启动方式、session 定位和 deep-link 支持。
2. Skill shim：把厂商侧自然语言操作映射到 Harness 的 MCP 或本地 CLI。

候选公共操作：

```text
get_project_context
get_state_delta
import_session
acquire_task
submit_task_result
update_objective
record_decision
attach_evidence
close_objective
```

Skill 不负责把几 GB 内容送进模型。它只负责选择范围、调用本地 importer、显示候选结果并完成显式提交。

## 9. Topic Collection & Session Import Protocol

这是将散落在既有 Agent 历史中的一个工程收集并迁入 Harness 的核心协议。

### 9.1 输入

- 必填：用户自然语言主题；允许简称、错拼、中文/英文混用和非精确项目名。
- 可选提示：Project ID、session ID、仓库路径、Git remote、包名、域名、历史别名或需要排除的主题。
- Adapter 可访问的原生搜索、活动/归档会话索引、本地 transcript、rollout 或官方 export。
- 当前 Git 状态与历史，以及上次导入保存的 query profile 和增量水位。

### 9.2 导入流水线

1. **Build query profile**：机械生成原词、分词、历史别名、仓库名、目录、package、域名和 Git remote 等搜索锚点；默认不调用模型。
2. **Search**：通过 adapter 并行搜索活跃与归档会话的正文。原生全文搜索优先；能力缺失时使用本地增量 SQLite FTS，禁止把全文发送给模型做搜索。
3. **Expand query when needed**：只有零结果或高歧义时，允许一次小型 Agent turn 生成 5–8 个别名后重搜；扩展词及其理由写回 query profile。
4. **Locate occurrences**：把线程级命中定位到具体 turn/item，记录 snippet、match range、时间和稳定来源指针，而不是把整段对话直接归入项目。
5. **Expand relations**：沿 Project ID、Git root、remote、cwd、父子线程、共享路径、包名和域名扩展候选，但关系信号不能覆盖相反的正文证据。
6. **Cluster and classify**：按 occurrence 聚类、去重和打分；允许同一项目跨多个对话，也允许同一对话中的不同消息归入不同项目。
   搜索与聚类完成后立即显示轻量 collection preview；后续归档和 Agent 整理不应阻塞用户查看候选范围。
7. **Snapshot and externalize**：冻结来源 manifest 和 hash，把关联 rollout 与大型 payload 放入内容寻址对象库；导入过程中不依赖变化中的源文件。
8. **Select bounded evidence**：默认只选 20–40 个高价值 occurrence 及少量相邻 turn，兼顾新旧时间段、关键决策和反例；完整 rollout 只在 Raw Archive 中保留。
9. **Extract**：专用 Agent 只读取有界证据，生成 objective、decision、checkpoint、blocker、next step、Task 和 evidence candidates。
10. **Reconcile**：结合 Git、文件和测试证据消解重复、过期与冲突状态；无法证实的结论保留为未验证候选。
11. **Review**：显示候选簇、覆盖范围和排除项；仅在歧义时要求用户选择边界，任何结构化状态都必须经用户审核。
12. **Commit state**：接受后形成初始 Project HEAD，同时保留完整 provenance。

### 9.3 重新导入

`DECIDED` 导入必须幂等。每个项目保存 query profile、确认/排除关系和各来源的增量水位；重新导入只检索新增或变化的内容。相同 occurrence 或 session snapshot 不能生成重复 checkpoint；新增内容只能产生可解释的 delta。

### 9.4 “无损迁移”的产品验收

- 原始输入或其可重建形式仍可访问。
- 所有被接受的关键状态都能跳回来源。
- 无法分类的内容进入保留区，不静默丢弃。
- 更换提取模型后可以从 Raw Archive 重新编译 Ledger，而不依赖旧摘要。
- Mission Packet 变小不影响原始证据的可恢复性。
- 一个项目跨多个对话时能够合并；一个对话混有多个项目时能够按消息拆分。
- 草稿必须报告命中、扩展、采用、排除和未读取数量，不能用有限证据伪装“已读完全部历史”。

### 9.5 成本模式

`DECIDED` 默认快速模式面向有限额度用户：原生检索或本地 FTS 阶段消耗零模型 token；高置信结果最多执行一次有界结构化整理。零结果或高歧义时可以额外执行一次小型别名扩展 turn，但不能退化为全文递归扫描。

`PROPOSED` 深度补全由用户主动触发，按批次扩大 occurrence 和相邻 turn 预算，适合大型历史或高额度用户。无论哪种模式，模型都不直接读取完整 GB 级 transcript。

## 10. Project State Protocol

### 10.1 Project

最小字段：

- stable ID、显示名、本地路径、Git remote fingerprint。
- status：active / paused / blocked / completed / archived。
- goal、acceptance criteria、technical constraints。
- primary active objective。
- current state ref、latest checkpoint、last verified time。

### 10.2 Objective

建议状态：planned / active / paused / blocked / completed / superseded / cancelled。

`DECIDED` 同一 project 同时最多一个 primary active objective。切换主目标必须显式暂停、完成或 supersede 旧目标。

### 10.3 Workstream

`PROPOSED` Workstream 是 Objective 下可选的任务亲和分组，例如 frontend、backend、migration 或 release。它不是必须展示给所有用户的复杂项目管理层，而是帮助 Harness 判断相关任务是否适合复用同一温 Session。

### 10.4 Task

Task 是最小用户验收单元。建议状态：backlog / ready / leased / in_progress / review / accepted / blocked / cancelled / superseded。

最小字段：task contract、acceptance criteria、objective、可选 workstream、priority、base project revision、assigned agent policy 和 Git apply policy。

### 10.5 Run

Run 表示一个 Agent 对一个 Task 的一次执行尝试。一个 Task 可以因失败、拒绝、冲突重放或更换 Agent 产生多个 Run；只有被用户接受的 Run 才能推进 Task 和 Project HEAD。

最小字段：run ID、task、agent、session、base revision、started/ended time、candidate result、resource usage 和 outcome。

### 10.6 Checkpoint

最小字段：

- immutable ID、parent checkpoint、project、objective。
- actor：human / Codex / Claude Code / Hermes / importer。
- outcome：completed / partial / blocked / failed / paused。
- completed work、remaining work、next step、blockers。
- decisions added or superseded。
- evidence refs 与 session refs。
- created time、verification state。

### 10.7 Decision

保存问题、选择、理由、替代方案、后果、来源和当前状态。Decision 可以 accepted、challenged 或 superseded，防止新 Agent 从代码重新推导并重复走已否决路线。

### 10.8 Conflict

多 Agent 写回出现冲突时，不允许最后写入者静默覆盖。至少检测：

- 两个 objective 同时宣称 active。
- 同一 checkpoint parent 出现互斥结论。
- Agent 声称完成，但 Git 或测试证据不支持。
- 新 decision 与 accepted constraint 冲突。

MVP 可以通过人工选择完成 reconciliation，不要求自动合并所有语义冲突。

## 11. Task Execution 与 Session Coordination Protocol

### 11.1 Project Steward

Project Steward 是项目的轻量控制面，默认不执行代码任务，也不维护一条永久 LLM 对话。它负责：

- 读取 Project HEAD、objective、task queue 和 session health。
- 根据 task affinity、session cursor、上下文预算和隔离要求选择复用或新建 Session。
- 发放带 base project revision 的 task lease。
- 接收 candidate Task Result 并生成用户审核卡。
- 在用户接受后执行原子状态推进。
- 检测 stale result、并发冲突、多个 active objective 和缺失证据。

`PROPOSED` MVP 中尽量用确定性状态机实现这些职责；只有任务拆分、语义冲突判断或复杂审核需要临时 planner/reviewer Agent。

### 11.2 Session 类型

| 类型 | 生命周期 | 用途 |
|---|---|---|
| Warm Workstream Session | 有界复用 | 同一 objective / workstream 中连续、相关的任务；保留局部工程认知 |
| Disposable Specialist Session | 单个 Task 或 Run | 跨领域、高风险、实验、敏感隔离或不值得污染温上下文的任务 |
| Review Session | 单次审核 | 独立检查 diff、测试或方案，不继承 Worker 的推理偏差 |

Project Steward 不是第四种长期 Session；它是控制角色。必要时产生的 planner/reviewer 调用都是短生命周期 Run。

### 11.3 有界温会话

默认不实行“一任务一新会话”，也不允许“一项目一永久会话”。Harness 根据 Session Lease 决定复用：

适合复用：

- 新 Task 属于同一 objective 或 workstream。
- Session 的 state cursor 与 Project HEAD 一致，或可以用小型 Delta Packet 追平。
- 上一个 Run 已被用户接受，没有悬而未决的状态冲突。
- 上下文用量、任务数量、空闲时间和 compaction 状态仍在项目策略预算内。

必须新建或退役：

- objective / workstream 明显换域。
- 需要独立 review 或隔离不可信实验。
- Session 已 compact、漂移、超过上下文预算或落后太多 project revisions。
- Git branch/worktree 与任务要求不兼容。
- 上一结果仍有冲突，继续复用会放大错误假设。

`PROPOSED` Session Lease 至少包含 max context utilization、max accepted tasks、max idle age 和 max revision lag；具体默认值必须通过真实 Codex / Claude Code 实测确定。

### 11.4 Cursor 与增量同步

每个 Session 保存 `state_cursor`，表示它最后确认读取的 Project revision。

```text
Project HEAD = R12
Warm Session cursor = R10
        │
        └─ sync delta R10..R12
           + new Task contract
           = Delta Packet
```

当 cursor 落后但仍可安全追平时，只注入新增 checkpoint、decision、constraint、Git evidence 和 task contract。若 delta 过大、包含冲突或跨越关键 objective 变化，则放弃增量同步并启动新 Session。

### 11.5 Task dispatch 与乐观并发

1. Harness 从 Project HEAD 创建 Task，并记录 `base_project_revision`。
2. Steward 选择温 Session 或一次性 Session，发放 task lease。
3. Worker 获取 Bootstrap Packet 或 Delta Packet，执行 Task。
4. Worker 调用 `submit_task_result`，提交 candidate checkpoint、验收条件结果、Git evidence、测试和建议下一步。
5. Harness 比较 base revision 与当前 HEAD：一致时可进入审核；不一致时标记 stale，需要 rebase 或 reconciliation。
6. Candidate Result 进入 `review`，不能直接覆盖 Project HEAD。

Agent 之间默认不直接转发彼此完整聊天。它们通过 Task、Project HEAD、Delta Packet 和 provenance 间接协作，形成可审计的共享状态板。

### 11.6 用户审核与接受事务

审核卡至少展示：

- Task acceptance criteria 的逐项结果。
- Worker 摘要与未完成内容。
- Git diff、commit、测试和其他 evidence。
- 候选 Project State Delta：checkpoint、decision、blocker、next step。
- Session 建议：keep warm / retire / blocked。

用户可以 Accept、Request changes、Reject 或 Supersede。只有 Accept 才执行一次原子事务：

1. 接受 candidate checkpoint。
2. 推进 Task 状态与 Project HEAD。
3. 记录 evidence、decision 和 session cursor。
4. 按项目策略执行 Git 动作。
5. 决定 Session 保持 warm 还是退役归档。

`PROPOSED` Git apply policy 至少支持：`evidence-only`（只关联现有 diff/commit）和显式启用的 `commit-on-accept`。Harness 不应在没有项目策略和用户本次接受动作时自行创建提交。

### 11.7 Session 关闭与复用

- Disposable Specialist Session：Task 被接受、拒绝终止或 supersede 后默认退役。
- Warm Workstream Session：Task 被接受后回到 warm idle，并把 cursor 推进到新 HEAD；满足下一个相关 Task 时复用。
- Review Session：提交审核结论后退役，不承担后续实现。
- 任意 Session 退役前都必须完成结果提交或显式记录无结果终止；项目状态不能依赖它继续存活。

## 12. 桌面产品面

`DECIDED` MVP 只有三个主要界面，并采用渐进披露：首屏先回答“这是哪个项目、现在做什么、什么需要我确认”，技术证据按需展开。

### 12.1 项目列表

展示 active / paused / blocked / completed / archived 项目，以及当前 objective、状态新鲜度和 Git 风险提示。

`DECIDED` 项目列表只提供两个清晰且互不混用的主动作：

- **新建空白项目**：只输入项目名，立即建立空白 Harness Project；目标、技术栈、工作区和 Codex 连接随后手填或通过 CTO 对话补全，不触发历史搜索。
- **从既有历史收集**：只输入近似主题，立即开始正文检索并显示 collection preview；不要求精确对话名、Project ID 或路径。高级提示与排除项收进折叠区，只有候选簇歧义时才要求用户选择。

两个动作都不在首屏暴露索引、目录扫描或模型参数；进度只显示“搜索历史 → 整理证据 → 等待审核”三个用户可理解的阶段。

### 12.2 项目驾驶舱

首屏只常驻当前 objective、用户审核卡和简洁 Task queue；没有候选结果时，审核区退化为一行安静状态。Git 状态、Agent availability、Session health、项目路径和 provenance 入口收进“项目详情”抽屉，不与当前行动争夺注意力。

### 12.3 新建任务面板

填写 Task、Agent 和 Session policy；后续版本再加入 Bootstrap / Delta Packet 预览。默认由 Steward 在复用温 Session与新建一次性 Session之间选择，高级用户可以覆盖。Resume 只保留为历史恢复的二级动作。

`DECIDED` collection preview 和导入审核属于项目注册流程，不扩张成第四个长期导航中心。

### 12.4 Project Lineage Graph：工程谱系图

`PROPOSED` 后续项目驾驶舱增加一个可横向滚动的工程谱系图。它采用 **Git branch lane + Harness checkpoint overlay**，而不是只画普通提交历史：Git 提供分支、commit、merge 和 tag 的代码骨架，Harness 在同一时间轴上叠加 Task、Run、Agent、Checkpoint、用户验收与 Project HEAD 迁移。

推荐视觉模型是从左到右的轨道式骨架图：

- 横轴是真实时间，带时间戳刻度；旧状态在左，当前 Project HEAD 在右。
- 主线保持稳定的中央轨道，feature branch / workstream 在上、下方分叉，merge 后回到主线。
- 普通 commit 使用小节点；accepted checkpoint、milestone、阻塞、回滚和 merge 使用不同形状与标签，不能只靠颜色区分。
- 默认聚合到 checkpoint / milestone 层，避免几百个机械 commit 淹没工程主线；缩放或展开后再显示单个 commit。
- 横向滚动采用窗口化渲染；进入视图时默认聚焦最新 HEAD，同时保留快速回到当前状态的动作。

点击任意节点，在右侧详情抽屉显示该条目的完整工程语义：

- 时间戳、branch、commit hash、parent / merge 关系。
- 对应 Objective、Task、Run、Agent、Session 和 Harness checkpoint。
- 功能变化摘要：新增、修复、删除、行为差异和用户可见影响。
- 代码证据：changed files、diff 统计、关键 diff、测试 / CI、PR / Issue 引用。
- 项目状态变化：目标、决策、阻塞、剩余工作、下一步和 Project HEAD delta。
- provenance：原始 Agent 结果、用户验收记录以及能够回到来源的指针。

`CONSTRAINT` 图上必须明确区分“Git 已提交事实”和“尚未提交但已被 Harness 记录的项目状态”。提交数量、节点密度和分支长度不得被伪装成完成百分比。详细 diff 与功能说明放在抽屉，不把主图堆成不可阅读的卡片墙。

## 13. 本地与跨平台策略

### 13.1 Local-first

`DECIDED` 项目状态、会话归档和索引默认保存在本机。MVP 不要求账号、云服务或团队空间。敏感 transcript 不应因使用本产品自动上传第三方。

### 13.2 存储候选

`PROPOSED`：

- SQLite：项目元数据、事件索引、refs 和物化当前状态。
- Content-addressed object store：大型 transcript、payload 和归档对象。
- Session manifest：事件顺序、来源和对象引用。
- Markdown / JSON：人类可读导出与迁移格式，不作为唯一运行时真相源。

`OPEN`：是否在 repo 内放置一个轻量 pointer/manifest，以及它是否默认进入 Git。

### 13.3 OS 策略

`DECIDED` Windows 首发；macOS 是第二验收平台。进程启动、路径、shell、终端、凭据存储和 deep link 从第一天隔离到 OS adapter。Linux 优先级待定。

## 14. Agent 兼容与安全边界

### 14.1 首批 Agent

`DECIDED` MVP 的后台执行支持 Codex；Claude Code 与 Hermes 先以用户主动 Skill/MCP 交接方式接入。Hermes 的后台 adapter 仍必须等待公共 adapter contract 经前两家验证后再做。

### 14.2 能力协商

不同 Agent 可能只支持部分能力：

- discover installation。
- launch new session。
- open known session。
- locate/export transcript。
- search active and archived content。
- locate message-level occurrences。
- MCP read/write。
- install/use skill。
- return session ID 或 deep link。

Harness 必须按 capability manifest 降级显示，不能假装所有厂商完全对称。

所有搜索 adapter 输出统一 occurrence：`sourceAgent`、`threadId`、`turnId`、`itemId`、`snippet`、`matchRange`、`projectId`、`cwd`、`gitRoot`、`remote`、`timestamp`、`relationSignals` 和 `archiveRef`。Codex 0.154+ 优先使用原生搜索；旧 Codex 回退本地增量 SQLite FTS；Claude Code 与 Hermes adapter 也必须归一到同一结构，核心层不得出现厂商专用项目边界。

### 14.3 Codex 首发适配

`IMPLEMENTED` Codex 是桌面 MVP 的默认预连接 Agent。Harness 使用本机 Codex CLI 的实验性 `app-server --stdio` 协议创建持久独立 thread、设置名称，并在 `turn/start` 输入中同时传入项目内置 `ai-project-harness` Skill 和 Bootstrap Packet。随后调用 `codex app <project>` 打开 Codex Desktop。

`VERIFIED LOCALLY` 当前本机 `codex-cli 0.154.0-alpha.6.2` 暴露 `thread/search` 与 `thread/searchOccurrences`：前者可跨线程全文搜索并过滤活跃/归档状态，后者可定位单线程内可见 user message 与 final assistant message 的具体 turn、item 和匹配范围。`thread/list.searchTerm` 只搜索标题，不能承担项目内容收集。实测 `AI Project Harness` 约 750 ms 返回 3 个线程命中，而 `个人网站`、`网站`、`portfolio`、`Hero`、`lucaszhouc` 均为零结果；这证明原生检索速度足够，但单关键词召回不足，必须保留查询扩展和关系扩展。

控制面（CTO/Review）在创建时执行一次有界低 effort 初始化 turn，并在线程级配置中关闭已知故障的可选 MCP（当前为 Telegram、image-tools、node_repl）；这样 Codex 侧栏会获得真实首条用户消息和可读 rollout。裸 `thread/inject_items` 只适合补充模型历史，不会填充侧栏摘要，因此不作为控制 thread 的唯一初始化方式。业务任务与 IMPORT turn 不使用该隔离配置，仍保留完整 MCP 能力。

Skill 不依赖全局安装，也不把旧会话恢复成新项目真相；每个 Task 仍以 Project HEAD、base revision、验收条件和证据契约为准。Onboarding turn 只读检查仓库，只能返回 candidate `harness-result`，不能自行推进 Project HEAD。

Windows portable 模式下，外部 Codex 子进程不能把 Electron 的 `app.asar` 当作工作目录，也不能直接读取 ASAR 内部虚拟路径。v0.0.6 因此使用真实 `resources` 目录启动 app-server，并通过 `extraResources` 将 Skill 放在 `resources/integrations/.../SKILL.md`；开发模式仍从源码目录解析。

Windows 从桌面快捷方式启动时可能只能在系统 PATH 中发现 npm 的 `codex.cmd`，而不是 Codex Desktop 临时注入 PATH 的原生 `codex.exe`。Node 24 不能把 CMD/BAT shim 当作原生 executable 直接 `spawn`。v0.0.8 因此保持原生 EXE 直启，并把 CMD/BAT shim 转入受控 `cmd.exe` 兼容入口；参数通过子进程专属环境变量传递并整体引用，避免把项目路径拼成可解释命令。app-server 关闭时先结束标准输入，让 shim 进程树正常退出。

v0.0.9 将该处理从 Codex 局部补丁提升为共享命令运行层：Codex、Git 和开发启动链使用同一套 EXE/CMD/BAT 分流与输入校验；Vite 开发服务直接由 Node 执行 JS，Electron 直接调用原生可执行文件。app-server 初始化、thread/name/turn 设置或标准流失败时必须关闭子进程。`codex app` 失败被建模为“任务已创建、Desktop 未打开”的部分成功：保留 thread/run，记录 JSONL，界面持续显示错误编号和“重新打开 Codex”；恢复成功后同步修正持久 run 状态。

v0.0.11 在本机 Codex Desktop 注册的 `codex://threads/<threadId>` 协议上增加精确任务跳转；Harness 优先调用该 URI，失败才回退 `codex app <project>`，并把 `thread-deep-link` / `project-path-fallback` capability 原样返回。renderer 同时保护任务/审核 `<details>` 展开状态、对话框控件值与选区、焦点和滚动位置，5 秒自动同步不会收起或替换用户正在操作的界面。

`LIMITATION` `app-server` 当前是实验性兼容面，不作为已稳定的公共 API 宣传。`thread/search` 与 `thread/searchOccurrences` 也是版本能力，不是永久契约；adapter 必须隔离协议变化、启动时协商 capability，并在能力缺失时回退本地增量 FTS。Codex Desktop 精确跳转依赖本机 `codex` URI 注册和该版本 Desktop handler；注册缺失时只能按项目目录打开，不能伪装成精确对话。Claude Code 仍没有后台 adapter。

### 14.4 Claude Code 边界

`DECIDED` 对使用 OAuth 订阅账号的 Claude Code，不做第三方 PTY 包装、模拟输入、全局 hook 总线或无人值守多会话自动化。普通模式只允许用户主动启动和主动调用 skill/MCP。需要 headless 自动化时走官方 Agent SDK 与 API Key 路径。

这与产品定位一致：MVP 是项目状态互操作和交接，不是接管厂商客户端。

## 15. MVP 范围

### 15.1 必须完成

- 注册、暂停、完成和归档本地 Git 项目。
- Project contract 与唯一 primary active objective。
- Task / Run / Session 分离的数据模型与状态机。
- 不可变 checkpoint、decision 和 evidence references。
- 实时 Git 分支、dirty、ahead/behind、最近提交和 diff 摘要。
- Codex / Claude Code 安装检测和用户主动启动。
- Harness MCP / CLI 的最小读写协议，包括 task lease、state delta 和 candidate result。
- Agent Pack：context、delta、import、task result、decision proposal、close objective request。
- 主题驱动的既有历史收集：跨活跃/归档全文检索、消息级 occurrence 定位、关系扩展和候选簇审核。
- Codex 原生搜索与本地增量 SQLite FTS 的能力协商和兼容回退。
- 至少一种真实大型 session 的流式归档、payload 去重和有界 Agent 整理。
- 有 token 上限的 Mission Packet。
- 有界温 Session、一次性 Session、state cursor 和退役规则。
- 用户审核卡与 Accept / Request changes / Reject 接受事务。
- Raw Archive、Project Ledger 和 provenance 浏览入口。
- 项目列表、项目驾驶舱、启动任务抽屉。

### 15.2 明确后置

- 团队协作、云同步、账号和权限。
- 通用 Kanban、甘特图、复杂依赖图或模板市场；当前只提供有界的前置任务依赖。
- 多 Agent 自主排队、并发调度和远程执行。
- worktree 农场和内建代码编辑器。
- 全厂商 transcript 播放器。
- GitHub OAuth、Issue/PR 写操作；本版本只在本机 `gh` 已认证时做只读增强，写操作仍后置。
- Hermes 后台 adapter（用户主动 Skill/MCP 交接已在 v0.19.0 切片实现）。
- 自动生成项目完成百分比。

### 15.3 已实现的桌面基础切片 v0.0.16（历史基线）

`IMPLEMENTED` Windows 本地 Electron MVP 已完成以下真实闭环：

- 项目列表与单一工作区；首屏仅显示当前目标、待确认结果和简洁任务列表。
- “接入项目”只要求近似项目名；自动从 Harness 状态、Codex 最近任务、最近 Git 根和已知根目录定位项目，支持缩写、少量错拼和省略分隔符，拒绝路径输入、低置信结果与近似歧义。
- 项目详情抽屉按需展示真实 Git、Agent availability、Session leases 与项目路径。
- 本地 JSON 状态持久化；损坏文件保留备份后安全重建。
- 读取真实 Git branch、dirty、ahead/behind、worktree 和最近 commits。
- 检测本机 Codex / Claude Code CLI；Codex 作为首发默认 adapter。
- 通过实验性 Codex `app-server` 创建持久独立 thread，并原生注入项目内置 Skill 与 Bootstrap Packet。
- 创建只读 onboarding Task、Warm Session 和外部 thread / turn 关联，再打开 Codex Desktop。
- 创建 Task，选择 Agent、workstream 和 auto / warm / disposable policy。
- Dispatch 后生成并复制 Mission Packet。
- 通过手动结构化 JSON bridge 提交 candidate Task Result。
- 用户 Accept 后推进 Task、Checkpoint、Project HEAD 与 Session cursor；Disposable Session 自动 retired。
- base revision 不一致时拒绝 stale result 覆盖当前 HEAD。
- 使用 electron-builder 生成 Windows x64 portable EXE；桌面快捷方式指向成品而非开发 Electron runtime。
- portable 环境使用真实 resources cwd 和 ASAR 外 Skill；Electron IPC 错误进入界面前移除 `Error invoking remote method` 等内部包装。
- Windows adapter 同时支持原生 `codex.exe` 与 npm `codex.cmd` / `codex.bat`；CMD/BAT 参数不直接拼入 shell，含空格和命令元字符的项目路径保持为单个参数。
- Codex、Git 和开发启动链共享统一命令发现/执行层；只有 CMD/BAT shim 进入受控解释器，原生 EXE、Node/Vite 与 Electron 不经过 shell。
- app-server 初始化、thread/name/turn 创建和标准流错误统一进入可拒绝、可记录、可清理的失败路径，避免失败子进程残留。
- 项目接入按 Codex 检测、项目定位、Git 检查、Skill 检查、任务创建和状态保存推送真实阶段进度；操作期间输入和提交动作进入明确 busy 状态。
- 项目接入失败后 Dialog 保持打开并保留输入，显示可行动中文原因、唯一错误编号和重试动作，不再依赖会自动消失的 toast。
- Codex thread 已创建但 Desktop 打开失败时保留成功状态与 thread/run，显示持久 warning 和“重新打开 Codex”；重试成功会同步修正持久 `desktopOpened` 状态。
- “打开对话”优先调用本机注册的 `codex://threads/<threadId>` 精确深链；终态任务如仍有 Harness 遗留 app-server 进程会先释放整棵进程树，再执行精确跳转；运行中或无法释放时回退 `codex app <project>` 并明确返回 fallback capability。精确深链不依赖 `codex` CLI 是否位于 PATH。
- 顶栏和旧任务行提供“打开最近对话”：Harness 只读调用 Codex `thread/list`，按项目工作目录选择最近持久 thread 并尝试官方 deep link；没有候选或候选仍被 Harness app-server 占用时才回退项目入口，不把不确定的对话伪装成精确任务历史。
- `project/list` / `project/create` 现在是 Project 创建的唯一正式路径；项目接入先创建或复用真实 Codex Project，再把 CTO、Review 和任务 thread 的 `projectId` 传入 `thread/start`，形成可在 Codex 侧管理的 2+N 对话结构。
- 启动迁移会把旧 Harness 项目的本地 ID 升级为官方 Project ID，并为旧控制 Session 创建新的 Project 成员 thread；原有聊天历史只保留在 Codex 中，不删除、不覆盖。
- Codex Desktop 的 legacy 本地 Project ID 是兼容缓存，不是官方 Project 的事实源。现代 Harness 默认不再整文件重写该缓存；`APH_ENABLE_CODEX_LEGACY_STATE_SYNC=1` 仅用于旧版本实验兼容。当前进程不会热加载外部新增 Project，侧栏可见性必须在完全退出 `ChatGPT.exe` 后冷启动逐项核对。
- 5 秒 runtime 自动同步使用单次在途锁；所有 runtime 重绘保留任务/审核展开器、对话框值与选区、控件焦点以及三处滚动位置，不打断验收条件查看或表单编辑。
- 错误以 JSONL 持久化到应用 userData 的 `logs/harness-errors.jsonl`，记录操作、失败阶段、原始堆栈、应用版本与最小上下文；1 MiB 轮转并保留 3 份归档。renderer 异常、未处理 Promise 和主进程未捕获异常进入同一日志。

### 15.4 CTO 草稿与 Review 上下文控制

`IMPLEMENTED` 每个项目的 CTO 和 Review 控制 Session 都有独立的限长上下文文件，路径位于数据盘 `projects/<project-id>/context/`。CTO 文件只包含来源、项目身份、目标、当前 HEAD、已接受 checkpoint、活动任务、决策/阻塞和必要索引；点击“进入 CTO”会打开绑定 thread，并把 `@文件路径` 复制到剪贴板作为未发送引用，用户可继续提问后再发送。公开 Codex app-server 协议没有 composer 草稿或附件写入方法，Harness 不伪造该接口，也不自动发送。

Review 文件只包含当前候选和最近 checkpoint，长度有硬上限；Harness 在每次状态写入时按内容寻址重建，Review Agent 在后台审核并准备回写。普通任务仍等待用户明确接受后才推进 HEAD，只有显式 auto Section 或 Smoke 配置才自动推进，不要求用户手动压缩上下文。一次性任务的晚到 `turn/completed` 事件不会把已经自动接受的 Session 回退为“待回写”。

`LIMITATION` v0.23 定义的主题驱动收集器尚未实现；当前 importer 仍以 Codex Project/cwd 关系为主要入口，不能视为满足“跨全部历史、消息级归类”的新协议。该切片也尚未实现 Claude Code/Hermes 公共后台 adapter（当前仅支持用户主动 Skill/MCP 交接）、Git commit-on-accept、GitHub 写操作、SQLite + CAS、正式安装器和 macOS。另已实现 transcript 内容寻址归档、最小 MCP/CLI 双向写回、GitHub 只读摘要、Project Ledger、Section 生命周期和项目包导入导出。Codex 运行态、完成/失败回写、Git 快照持久化和事件驱动的 renderer 更新已实现；界面以 5 秒有界心跳自动同步，并由 renderer 在输入、对话框、指针交互和展开器操作期间保护临时 UI 状态，另保留“刷新状态”手动入口。Codex 精确对话打开依赖 `codex://threads/<threadId>` 注册，失败时按项目 fallback；当前 portable EXE 未做代码签名，Codex app-server 仍是实验性接口；packaged 回归按用户边界使用纯代码集成模拟、headless renderer 与产物资源审计，不使用桌面自动化。

### 15.5 v0.19.0 状态层与交接切片

`IMPLEMENTED` 本轮将“Section 是 Agent 容器、Project 是长期真相”落成可运行边界：

- 主控 Section 只做轻量调配和审核；可复用 Section 绑定同一 workstream 的温会话；一次性 Section 在任务被接受后关闭并保留来源。
- 项目契约支持目标、唯一 Objective 历史、技术栈、约束和阻塞编辑；项目可暂停、完成、归档和恢复，归档不删除 Git 或 Agent 原文。
- 每个项目在数据盘生成有界 `PROJECT-LEDGER.md`；每次状态写入原子更新，并把 checkpoint、Section、Git、GitHub 和归档 manifest 作为可追溯索引。
- 运行中的 Codex 通知流同时落盘为原始 JSONL，终态再进入 SHA-256 内容寻址归档；重复导入复用对象，不把全文塞回控制面。
- GitHub 仅读取 `origin`（缺少 origin 时回退读取 `upstream`）、仓库、最近 PR/Issue；未安装 `gh`、未认证或离线时以结构化降级显示，不阻断本地项目。
- Claude Code 与 Hermes 使用用户主动 Skill/MCP 交接；Harness 不包装 OAuth/PTY，不伪造后台执行。`npm run harness` 与 `npm run harness:mcp` 提供有界 context、result、event、decision 和 import 接口。
- 普通任务默认需要用户确认后推进 Project HEAD；自动 Review 仅在显式 Section 策略或 Smoke 配置开启时运行。

## 16. MVP 验收

选择一个真实项目，连续完成 5 个任务，并包含温 Session 复用、一次性 Session、一次 Codex → Claude Code 交接和一次隔天恢复。

必须满足：

1. 至少两个同 workstream 的连续 Task 复用同一温 Session，后续只注入 Delta Packet。
2. 至少两个隔离或跨领域 Task 使用全新一次性 Session；全流程零次依赖 resume 才能继续。
3. 新 Agent 仅凭 Bootstrap Packet，温 Session 仅凭 Delta Packet，都能复述当前目标、验收条件、已完成内容、阻塞和下一步。
4. 五次 Task Result 都经过用户审核；只有 Accept 会推进 Task、Checkpoint 和 Project HEAD。
5. 五次 checkpoint 都能正确还原并关联文件、diff、commit 或测试证据。
6. 至少制造一次 stale base revision，系统必须阻止旧 Run 静默覆盖新 HEAD。
7. 以一个不等于任何对话标题的近似主题，收集至少三个活跃/归档对话中的同一项目内容。
8. 至少一个来源对话混有两个项目；系统按 occurrence 拆分，不能把整条对话错误并入当前项目。
9. 快速模式的检索阶段消耗零模型 token；结构化整理只读取 20–40 个高价值 occurrence 及有界相邻 turn。
10. 原生搜索可用和不可用两种环境产生兼容的 occurrence 结构；回退 FTS 不要求用户手工重建全量索引。
11. 至少导入一个大型旧 session；导入过程不把完整内容送入单次模型上下文。
12. 随机抽取关键 decision 和 checkpoint，可以跳回原始来源验证。
13. 保存 query profile 后新增一段相关历史；再次同步只处理水位后的变化，相同 snapshot 不产生重复状态。
14. 主题零结果、多个候选簇同分、搜索能力缺失三个边界都给出可恢复结果，不猜测项目边界。
15. 关闭或 supersede objective 后，活跃列表不残留重复主目标。
16. 退役或删除任意 Agent session 不损坏 Project State Repository。
17. 未安装或无法使用某个 Agent 时，项目浏览、Git 状态和其他 Agent 仍可使用。
18. 在 Windows 完成完整闭环；随后在 macOS 验证 adapter 边界。

## 17. 成功指标

### 核心指标

- Resume-independent continuation rate：无需 resume 即成功继续的任务比例。
- Warm-session reuse success：相关 Task 复用温 Session 后无需全量 bootstrap 且状态正确的比例。
- Delta efficiency：Delta Packet 相对 Bootstrap Packet 节省的 tokens 与启动时间。
- Stale-result interception：基于旧 project revision 的结果被正确拦截比例。
- State recovery accuracy：新 Agent 对目标、状态、阻塞和下一步的复述正确率。
- Checkpoint completion rate：结束、暂停或受阻的 session 成功写回比例。
- Provenance coverage：accepted claims 中具有来源指针的比例。
- Active-objective hygiene：重复主 active objective 数量。
- Import dedup ratio：大型会话重复 payload 被去重的比例。
- Topic collection precision / recall：经用户抽检的 occurrence 归类准确率和历史覆盖率。
- Time to collection preview：输入主题到出现可审核候选簇的时间。
- Import token cost：每次快速模式在别名扩展与结构化整理上的模型 token 消耗。

### 反指标

- Mission Packet 持续增长并逼近完整 transcript。
- 温 Session 因缺乏退役条件重新演化成永久大对话。
- 大量无必要的一次性 Session 反复支付相同 bootstrap 成本。
- 用户为了修正文档而付出的时间高于重新解释项目。
- Agent 生成大量无证据“进度”。
- 适配器数量增加导致核心 schema 出现厂商专用字段蔓延。

## 18. 主要风险

### R1. “无损”被误解为无损语义摘要

缓解：产品语言固定为无损归档、有据编译、按需检出；公开可恢复边界。

### R2. Agent 忘记写 checkpoint

缓解：任务启动包内包含回写契约；提供明确结束动作；显示 stale 状态；允许用户或下一会话补录。MVP 必须测量实际写回率。

### R3. 自动提取产生可信但错误的项目状态

缓解：来源指针、Git/测试证据、verification state、冲突区和可重新编译 Raw Archive。

### R4. 厂商 transcript 格式频繁变化

缓解：adapter 隔离、版本化 parser、保留原始事件、能力协商；优先官方 export/API。

### R5. 变成另一个 Agent command center

缓解：MVP 不做并发编排、远程控制和 IDE。所有新功能必须回答它是否提高项目连续性。

### R6. 状态模型过度复制 Git

缓解：借用不可变历史、refs、diff 和 lineage，不要求实现完整 Merkle DAG、代码 merge 或分布式同步。

### R7. 大型会话导入本身再次撑爆资源

缓解：原生/FTS 零 token 检索、消息级 shortlist、流式解析、payload 外置、hash 去重、预算限制和可恢复导入状态；快速模式只给 Agent 20–40 个 occurrence 及有界邻居，禁止把完整 session 喂给单个 Agent。

### R8. Project Steward 变成新的永久主会话

缓解：Steward 状态全部来自 Project Ledger；调度优先使用确定性规则；临时 planner/reviewer 不保存为权威记忆，输出必须走同一审核协议。

### R9. Session 策略走向两个极端

缓解：不用固定“一任务一会话”或“一项目一会话”，而是按 workstream affinity、state cursor、上下文预算、revision lag 和隔离要求执行有界复用，并持续测量复用收益。

### R10. 主题检索误合并或漏召回

缓解：主题只触发搜索，不直接定义边界；同时展示正文命中、关系信号、候选簇、排除项和覆盖计数。低置信或并列簇必须由用户选择，已确认别名与排除规则保存到 query profile，后续同步不重复猜测。

## 19. 当前决策表

| ID | 状态 | 决定 |
|---|---|---|
| D-001 | DECIDED | 产品是 local-first AI project continuity harness，不是通用 Agent 控制台。 |
| D-002 | DECIDED | Project 是长期实体；Session 是可抛弃执行窗口。 |
| D-003 | DECIDED | Git 管代码事实，Harness 管项目意图和连续性。 |
| D-004 | DECIDED | 采用 Agent → Harness 与 Harness → Agent 的双向配套协议。 |
| D-005 | DECIDED | “无损”定义为原始可恢复、状态有出处、上下文按需检出，不承诺语义无损摘要。 |
| D-006 | DECIDED | 同一项目同时最多一个主 active objective。 |
| D-007 | SUPERSEDED | 早期决定为 MVP 先支持 Codex + Claude Code、Hermes 后置；现行决定见 D-051：Hermes 先走用户主动 Skill/MCP，后台 adapter 仍后置。 |
| D-008 | DECIDED | Windows 首发，架构从第一天隔离 OS adapter；macOS 第二验收。 |
| D-009 | DECIDED | Claude Code OAuth 模式不做第三方 wrapper 自动化。 |
| D-010 | PROPOSED | SQLite + 内容寻址对象库 + manifest 构成首版本地存储。 |
| D-011 | PROPOSED | 默认 Mission Packet 约 2,000 tokens，并设置硬上限。 |
| D-012 | OPEN | 最终产品名称与品牌表达。 |
| D-013 | OPEN | 桌面技术栈：Tauri、Electron 或其他方案。 |
| D-014 | OPEN | 是否开源以及开源边界。 |
| D-015 | OPEN | project-local pointer 是否默认写入 Git。 |
| D-016 | OPEN | Linux 支持优先级。 |
| D-017 | DECIDED | Task、Run、Session、Agent 是四个独立对象；任务与会话不强制一一绑定。 |
| D-018 | PROPOSED | Project Steward 是无长期聊天记忆的轻量控制角色，默认不执行代码任务。 |
| D-019 | PROPOSED | 同一 workstream 的相关任务默认复用有界温 Session；跨域、高风险和独立审核使用一次性 Session。 |
| D-020 | PROPOSED | Session 使用 state cursor；后续相关任务优先注入 Project HEAD delta 而不是完整 bootstrap。 |
| D-021 | DECIDED | Worker 只能提交 candidate Task Result；用户 Accept 后才推进 Task、Checkpoint 和 Project HEAD。 |
| D-022 | PROPOSED | Git 动作按项目策略执行，至少支持 evidence-only 与显式 commit-on-accept。 |
| D-023 | DECIDED | Agent 默认通过 Project Ledger、Task 和 provenance 协作，不互相转发完整 transcript。 |
| D-024 | PROPOSED | 基于 base project revision 和 task lease 进行乐观并发；stale result 必须 reconciliation。 |
| D-025 | DECIDED | Windows MVP 使用 Electron + Vite + TypeScript；正式跨平台栈仍可在协议稳定后复核。 |
| D-026 | DECIDED | v0.0.1 使用 JSON 作为可替换的本地状态层，只验证闭环，不推翻 SQLite + CAS 目标。 |
| D-027 | SUPERSEDED | v0.0.1–v0.0.2 全链路使用手动 JSON bridge；v0.0.3 已由 D-030 至 D-033 替代为 Codex 输入自动化、结果回写暂时手动。 |
| D-028 | DECIDED | MVP 自举管理自身仓库，Git evidence 必须来自真实工作区而不是展示假数据。 |
| D-029 | DECIDED | 桌面首屏采用渐进披露；当前目标、用户审核和任务列表常驻，Git / Agent / Session 技术细节进入项目详情抽屉。酸绿只表示状态与主操作。 |
| D-030 | SUPERSEDED | 早期统一“新增本地项目”入口只输入项目名；现已由 D-057 拆为空白创建与既有历史收集。Codex 仍是首发默认预连接 Agent。 |
| D-031 | SUPERSEDED | 早期项目接入统一采用名称解析后创建 thread；空白创建现遵循 D-057，既有历史收集遵循 D-060 至 D-063。 |
| D-032 | DECIDED | Harness Skill 随项目打包并在 `turn/start` 中显式注入，不要求用户全局安装。 |
| D-033 | SUPERSEDED | v0.14.0 的“结果仍需手动 JSON bridge”由 v0.15.0 的 Agent 事件监控与 fenced `harness-result` 自动审核回写替代；手动提交仍作为故障兜底。 |
| D-034 | DECIDED | Codex `app-server` adapter 标记为 experimental，协议变化必须被隔离，不能把当前实测能力宣传成稳定厂商承诺。 |
| D-035 | SUPERSEDED | 早期既有项目入口依赖项目名称近似解析；现行入口改为主题全文检索与候选簇审核，见 D-060。低置信和歧义仍禁止猜测。 |
| D-036 | SUPERSEDED | 早期发现策略扫描已知 Project 和最近 Git 根的一层子仓库；现行策略改为原生全文检索优先、关系扩展与 FTS 回退，见 D-060 至 D-063。 |
| D-037 | PROPOSED | 项目驾驶舱后续采用横向 Project Lineage Graph；以 Git 分支轨道为骨架，叠加 Harness checkpoint、Task、Agent、验收和状态 delta，节点点击后进入详情抽屉。 |
| D-038 | DECIDED | Windows MVP 先交付 electron-builder x64 portable EXE；无代码签名时明确披露，不把 portable 成品伪装成正式安装器。 |
| D-039 | DECIDED | portable adapter 必须使用 ASAR 外的真实 cwd 与 Skill 文件；外部 Agent 不得接收 Electron 虚拟文件路径。 |
| D-040 | DECIDED | 所有用户可见的项目接入失败必须持久化原始诊断、返回唯一错误编号并保留可重试界面；短暂 toast 不能作为唯一错误通道。 |
| D-041 | DECIDED | Windows Agent adapter 必须区分原生 executable 与 CMD/BAT shim；原生程序直启，shim 通过受控系统命令解释器兼容，参数不得裸拼接为 shell 文本。 |
| D-042 | DECIDED | Run 是独立于 Task 审核状态的运行态投影，必须记录阶段、百分比、PID、最近事件、完成/失败时间；`in_progress` 不能覆盖“已结束待回写”。 |
| D-043 | DECIDED | Agent 事件触发 Git 快照持久化和 renderer 推送；应用重启后无活动进程的旧 Run 必须被标记为已结束待回写，禁止永久显示运行中。 |
| D-044 | SUPERSEDED | 对话打开采用 capability-aware 设计；v0.15.0 仅承诺按项目打开的 fallback，并显示 thread ID。v0.18.0 已实证并接入 Codex Desktop 的 `codex://threads/<threadId>` 深链。 |
| D-045 | SUPERSEDED | renderer 不再运行全局定时刷新；该阶段性决策由 D-046 的受保护自动同步替代。 |
| D-046 | DECIDED | 保留 5 秒有界 runtime 自动刷新，并用单次在途锁避免重叠；renderer 对输入/对话框/指针交互延迟快照，对普通控件捕获并恢复焦点，同时保留手动“刷新状态”入口。 |
| D-047 | DECIDED | 所有由 runtime 快照触发的 renderer 重绘必须保留用户可见的临时 UI 状态：任务/审核 `<details>` 展开状态、对话框控件值与选区、焦点和滚动位置；Codex 任务打开优先走已注册的 `codex://threads/<threadId>`，失败才回退到项目目录。 |
| D-048 | DECIDED | 首页“最近一次进展”必须读取状态机头部的最新 checkpoint；checkpoint 由状态机以 `unshift` 写入，禁止从尾部读取旧进展。 |
| D-049 | DECIDED | Section 分为轻量 main、可复用 reusable 和一次性 one-shot；main 不执行实现任务，one-shot 在接受后关闭。 |
| D-050 | DECIDED | 普通任务默认需要用户确认；只有显式 Section `approvalMode=auto` 或 Smoke 配置才允许 Review Agent 自动推进 HEAD。 |
| D-051 | DECIDED | Claude Code 与 Hermes 只走用户主动 Skill/MCP 交接，不包装 OAuth/PTY；后台执行能力必须另经公共 adapter contract 验证。 |
| D-052 | DECIDED | transcript 原文以 SHA-256 内容寻址对象和 manifest 保存，控制面只携带路径、hash、计数和结构化候选结果。 |
| D-053 | DECIDED | GitHub MVP 只读 origin（缺少 origin 时回退 upstream）、仓库、PR 和 Issue；无远端、未认证或离线不阻断本地项目。 |
| D-054 | DECIDED | 现代 Codex 的官方 `project/list` / `project/create` 与 `thread/start(projectId)` 是 Project 事实源；SQLite/app-server 行存在不能代替 Desktop 侧栏可见性验收。 |
| D-055 | DECIDED | `.codex-global-state.json` 只作为旧 Desktop 的兼容缓存；Harness 默认不写它，`APH_ENABLE_CODEX_LEGACY_STATE_SYNC=1` 才允许实验性兼容写入，并必须标注冷启动核对。 |
| D-056 | DECIDED | 创建 Task 与 dispatch 是两个明确动作；创建只保存 `ready/run=null`，真正注入 Agent 后写入 `task.dispatched`，不以“任务已创建”冒充执行。 |
| D-057 | DECIDED | “新建空白项目”和“从既有历史收集项目”是两个独立事务；前者不检索 Agent，后者不走空白项目 onboarding。 |
| D-058 | SUPERSEDED | 早期 Codex 导入以官方 Project ID 和关联线程索引为主要边界；现行主题驱动、消息级收集见 D-060 至 D-063，Project ID 只保留为关系信号。 |
| D-059 | DECIDED | 控制 thread 必须有真实可读的侧栏历史：创建时执行一次有界 `turn/start`（当前模型最低稳定档为 `low`），控制线程级隔离已知故障 MCP；`thread/inject_items` 仅作历史补充，不替代首条用户 turn。 |
| D-060 | DECIDED | 既有历史收集以用户主题为入口；项目边界由正文 occurrence 与 Project/Git/目录关系图共同确定，不要求精确对话名、Project ID 或仓库路径。 |
| D-061 | DECIDED | Codex 0.154+ 优先使用 `thread/search` 与 `thread/searchOccurrences`；能力缺失时回退本地增量 SQLite FTS，所有厂商输出统一 occurrence schema。 |
| D-062 | DECIDED | 归类最小单位是消息 occurrence；完整 rollout 只进入无损 Raw Archive，不因一条消息命中而把整个混合对话并入项目状态。 |
| D-063 | DECIDED | 快速模式的检索阶段零模型 token，默认只对 20–40 个高价值 occurrence 执行一次有界整理；零结果或高歧义时才增加一次小型别名扩展 turn。 |

## 20. 下一步

桌面状态闭环与首发交接切片已经存在，但主题驱动收集器和真实 Codex Project 侧栏冷启动验收仍是开放门。下一阶段按顺序处理主题收集、兼容回退、持久层和跨平台：

1. 为 Codex adapter 实现 `thread/search` + `thread/searchOccurrences` 的活跃/归档并行检索、消息级 occurrence 和关系扩展。
2. 保存 query profile、确认/排除关系和增量水位；实现旧 Codex 的本地增量 SQLite FTS 回退。
3. 完成真实主题收集 Smoke：跨多个对话、一个混合项目对话、零结果、并列歧义和能力缺失；验证快速模式 token 与 evidence 上限。
4. 完成一次完全退出 Codex Desktop 后的真实三 Project 侧栏核对，并为旧控制 thread 替换缺失 rollout；未完成前不得把旧项目显示为“已连接”。
5. 将 JSON 状态索引迁移到 SQLite + CAS，同时保留当前原子 JSON/JSONL 的可回滚迁移。
6. 为公共 adapter contract 增加 Claude/Hermes 的能力版本协商和真实用户主动接力验收。
7. 验证 macOS 的命令发现、路径和 deep-link 边界，再评估 Linux；协议稳定后再决定正式安装器、代码签名、GitHub 写操作、工程谱系和团队协作。

## 21. 变更记录

### v0.23.0 — 2026-09-14（主题驱动项目收集）

- 将既有项目入口从“按 Codex Project/对话索引拉取”升级为“主题输入 → 全文检索 → 关系扩展 → 消息级归类 → 有界 Agent 整理 → 用户审核后创建”。
- Codex Project ID、标题、cwd、Git root 和 remote 降为关系证据；正式支持一个项目跨多个对话、一个对话混合多个项目。
- 本机 `codex-cli 0.154.0-alpha.6.2` 已只读验证 `thread/search` 与 `thread/searchOccurrences`；`thread/list.searchTerm` 仅搜标题。单关键词零召回实测同时证明必须保留查询扩展。
- 定义 Codex 原生搜索优先、旧 Codex 增量 SQLite FTS 回退和跨 Agent 统一 occurrence schema。
- 定义面向有限额度用户的快速模式：检索零模型 token，只对 20–40 个高价值 occurrence 做一次有界整理；完整 rollout 留在 Raw Archive。
- 明确该收集器仍是已决定、待实现能力；当前 Project/cwd importer 不得冒充已经满足新协议。

### v0.22.0 — 2026-09-05（真实新建 Project 与控制面修复）

- 真实面板新建 smoke 通过：输入项目名称和工作区后，Harness 调用 `codex://new`，等待官方 `project/list`，再以同一 `projectId` 创建 CTO 与 Review。
- 控制 thread 改为一次低 effort 真实初始化 turn，并回读 `thread/turns/list`；线程级禁用 Telegram、image-tools、node_repl 只作用于控制面，避免可选 MCP handshake 失败阻断建项。
- 已用真实 Codex Desktop `list_projects`/`list_threads` 回读到同一项目及两个控制对话；证据目录为 `E:\_iva_workspace\aph-real-connected-flow-20260905-0510`。
- 修正 `minimal` effort 与当前 `gpt-5.6-sol` 不兼容的问题；新增适配器回归和可重复 `smoke:codex-connected`。
- 仍未宣称旧项目冷启动迁移和真实 IMPORT 候选审核完成；旧 rollout 与对话不删除。

### v0.21.0 — 2026-09-05

- 将项目入口拆成“新建空白项目”和“从 Codex 拉取项目”。空白项目不会搜索 Codex 或读取 Git，并可在契约中后绑定工作区；已有空白项目也可显式选择“从 Codex 回填到此项目”。
- Codex 拉取只消费官方 `project/list`，支持错拼、缩写、省略分隔符、中文和受控语义别名；歧义/低置信拒绝猜测。本机只读实测 `个人网站`、`APH`、`local chat` 均定位到对应官方 Project。
- 新增专用 `MODE: IMPORT` Agent 运行、`harness-import` schema、候选审核门和接受/重试/拒绝事务；未接受前不改任务、Section、CTO/Review、checkpoint、Git 或 GitHub。
- `thread/list` 仅用于建立高置信关联线程索引并按 `updatedAt` 排序；关联 rollout 以 SHA-256 内容寻址方式在模型上下文外流式归档，Agent 通过 `rolloutPath` 做定向读取，禁止按目录 mtime 或文件名日期推断进展。
- 合并时重映射任务依赖和冲突 ID、绑定现有 CTO/Review 控制 Session、拒绝旧 source revision 回退 Git/GitHub；重复候选和重复导入不复制核心实体。
- 源码全量 223/223、TypeScript/Vite 构建、真实 Electron + 隔离 app-server 导入 Smoke、最终 packaged import 和 portable 启动均通过；v0.0.19 成品为 90,851,869 bytes，SHA-256=`51E957DFB8441B64C3161FB87AA881056AD31D924CC508D9EFE7D5821CBB24CB`。本轮未启动真实用户 Project 的 import turn、未重启 Codex、未修改 Codex SQLite/global state。

### v0.19.0 — 2026-09-04

- 落地主控 / 可复用 / 一次性 Section 状态模型、Section 审核生命周期和唯一 Objective 历史，避免多个 active 目标互相漂移。
- 增加项目契约编辑、项目暂停/完成/归档/恢复、动态项目 Ledger、项目包导入导出和 JSONL journal 轮转/损坏恢复。
- 增加 GitHub origin 与本机 `gh` 的只读仓库/PR/Issue 摘要；无远端、未认证和离线均可降级。
- 增加 Codex 运行原始通知落盘与 SHA-256 内容寻址 transcript 归档，重复快照不重复存储。
- 增加 Claude Code / Hermes 用户主动 Skill/MCP 交接、本地 CLI 和最小 MCP bridge；普通任务默认用户审核。
- 面板补齐 Hermes/Section 显示、任务改派、前置依赖和低高度对话框滚动；改派/关闭边界写入审计并阻止关闭 Section 被静默重开。
- 首发产品版本提升到 v0.0.17；最终 portable 为 90,828,787 bytes，SHA-256=`7FB8ECA57A06A0F748B90678F1A320E11E4877E3ED8BD1976D78D928F3686ADE`，发布门禁与 packaged/portable smoke 已通过。

### v0.20.0 — 2026-09-04

- 纠正“官方 Project 已写入”与“Desktop 侧栏可见”之间的验收混淆：真实审计同时对比了当前 Desktop API、fresh app-server、SQLite 和进程生命周期，确认常驻 Desktop 的缓存不会热加载外部 Project。
- 停止现代路径对 Desktop-owned legacy global JSON 的默认整文件写入；兼容写入改为显式 `APH_ENABLE_CODEX_LEGACY_STATE_SYNC=1`，避免成功 rename 后的 last-writer-wins 覆盖。
- 项目状态、CTO packet 和动态 Ledger 持久记录“官方 Project 已创建、侧栏待冷启动核对”；新增只读 `smoke:codex-project-readonly`，明确不声称侧栏通过。
- onboarding 优先使用精确 Codex thread deep link；任务 dispatch 写入独立 `task.dispatched` 事件，区分任务保存与真正注入。
- 六个旧控制 thread 的缺失 rollout 与 `程序项目注入` 未 dispatch 事实记录在 [qa/audit-20260904-codex-project-visibility.md](qa/audit-20260904-codex-project-visibility.md)。
- v0.0.18 修正候选 portable 为 90,833,904 bytes，SHA-256=`D965BF709C439A6980B86C169F9CE88FDB44194C0FF686F1FEA72D8FD3DE58E6`；真实侧栏冷启动门未完成前不替换桌面快捷方式。

### v0.18.12 — 2026-09-04（已被 v0.20.0 审计修正）

- 曾尝试补齐 Codex Project 的第二层 legacy 映射；后续实测确认该文件由 Desktop 自己维护，外部整文件写入会与 atom flush 冲突，不能保证侧栏。
- 官方 `project/list` 与 SQLite 记录仍可用于确认 Project 存在，但 renderer-facing `list_projects` 和真实侧栏必须在 Desktop 冷启动后单独验证。
- 该阶段“常驻心跳持续重申映射”的做法已废弃；现代路径改为默认不写 legacy JSON，兼容写入需显式开关。
- 产品版本提升到 v0.0.16；最终 portable 为 90,796,507 bytes，SHA-256=`1441772A25C061802C06CC1E67DE8438B0DFB34194576D625BE1916F657EFBCD`。

### v0.18.11 — 2026-09-03

- 修复核心概念错位：全局 `.codex-global-state.json` 的 `local-projects` 只能作为兼容索引，不能代表 Codex Desktop Project；新增官方 app-server `project/list` / `project/create` 适配。
- 所有新建 CTO、Review 和任务对话都带 `projectId`；app-server/SQLite 层已验证三个项目各生成一个官方 Project，并各有 CTO + Review 两个成员 thread。对应 Desktop 侧栏与 rollout 可读性不在该阶段的证据范围内。
- 新增确定性 idempotency key、旧控制 Session 升级策略和对应 104+ 单测，避免每次启动重复创建 Project 或控制对话。
- 产品版本提升到 v0.0.15；最终 portable 为 90,796,113 bytes，SHA-256=`A9155E2219D55440DC51B20C5216D596E2522C182E98CBF29DADEFEDD62328D6`。

### v0.18.10 — 2026-09-03

- `project/task open` 新增只读 thread 索引恢复：旧任务或项目缺少持久 thread ID 时，按精确项目 cwd 选择最近非 ephemeral Codex 对话，恢复“打开对话”能力。
- 对仍在 `activeCodexClients` 中的 thread 保留项目路径 fallback，避免项目级入口触发 Desktop writer-lock 错误；新增对应 opener 单元测试与跨路径边界。
- 隔离真实 portable UI 已切换到 `AI Project Harness` 项目并点击旧任务“打开最近对话”，实际 toast 为“已打开该项目最近的 Codex 对话。”，返回 capability=`thread-deep-link`。
- 产品版本提升到 v0.0.14；最终 portable 为 90,795,669 bytes，SHA-256=`F6A462F89E3D565CBA903FE0D3BE359A3E47441A49AEE505401F7EE240FB2128`。

### v0.18.9 — 2026-09-03

- 对话打开从主进程内联逻辑抽成可注入的 task/project opener；覆盖终态遗留 PID 清理成功、清理失败、运行中 fallback、CLI 不在 PATH 但 Desktop deep link 可用和旧任务项目入口五类行为。
- Windows npm `codex.cmd` 包装层关闭时改为结束整个进程树，避免只杀 `cmd.exe` 后 Node app-server 孤儿继续持有 thread writer lock。
- 顶栏新增“打开 Codex”，无独立 thread 的旧任务新增“进入 Codex”；运行中按钮明确标为“打开项目入口”，终态才显示“打开对话”，不再把项目级 fallback 伪装成精确跳转。
- 产品版本提升到 v0.0.13；本条只记录已实现代码，portable 哈希在发布门禁与重新打包后补记。

### v0.18.8 — 2026-09-03

- 修复 5 秒 runtime 心跳重申 Codex 项目文件夹时遗漏异步 IIFE 调用的问题；此前错误会在主进程周期性抛出 `TypeError: ... .catch is not a function`，导致运行态更新和真实 Electron Smoke 失效。
- 文件夹重申同时批量恢复项目状态中的 CTO、Review 和任务 thread 分组；真实数据盘测试清空两个项目的文件夹与 thread 映射后，最新 portable 在第 4 秒恢复完整归属。
- 增加生命周期回归断言，锁定异步心跳必须以 `})().catch(...)` 形式执行；真实复现确认项目详情抽屉和任务表单在 heartbeat 后保持，renderer 无 `pageerror` 或 `console.error`。
- 新鲜门禁：83/83 单测、构建、renderer/真实 Electron/自动审核 Smoke、packaged Codex/UI/portable Smoke 全部通过；最新 portable 为 90,793,692 bytes，SHA-256=`7CECC67D9A7A065181B6B41CFF623D106B7D4B8A6DDFB4E97D8BADD70EA45C06`。

### v0.18.7 — 2026-09-03

- 控制面每次启动、接入项目、派发任务和进入 CTO 都重新断言 Codex 项目文件夹存在；即使 Codex Desktop 重写全局状态，下一次 Harness 控制面动作也会按确定 ID 恢复文件夹和线程分组。
- 全量 83/83、renderer/真实 Electron/自动审核/packaged Codex/UI/portable Smoke 通过；最终 portable 为 90,794,570 bytes，SHA-256=`D16E9308D4EE2BDC67E77FC047A7D00101475119790CB1ABD696378BE89A4159`。

### v0.18.6 — 2026-09-03

- 数据盘加载时自动识别旧版本遗留的 `review + candidate + 无 review 元数据` 任务，并通过同一 Review Agent 状态机审核、回写和推进 HEAD；首屏不再留下假的人工“待确认”门。
- Electron Smoke 现在直接断言旧候选迁移后审核区为空，首屏不包含“接受并推进 HEAD / 退回修改”按钮；自动 `harness-result` 链路继续独立验证 Review Agent 推进下一版 HEAD。
- 真实数据盘重启后，`AI Project Harness` 与 `iva-local-chat` 均由 R1 自动迁移到 R2，待审核候选数为 0，原有 CTO/Review thread ID 保持不变。
- 全量 83/83、构建、renderer 浏览器、真实 Electron、自动审核、packaged Codex、packaged UI 和 portable Smoke 通过；`check:release` 与 `package:win` 已强制执行 renderer Smoke。最终 portable 为 90,794,090 bytes，SHA-256=`C445E287ED14CDCA811AF9841C24FFE897AA66F8911ECB2AF5861FC52D823682`。

### v0.18.5 — 2026-09-03

- 修复广域项目发现回归：Codex 存在近期 cwd 时仍会扫描有界默认根目录，因此“个人网站”可以从 `E:\_iva_workspace` 被定位，不再只看近期对话目录。
- 默认根扫描与显式 `APH_PROJECT_ROOTS` / `APH_PROJECT_SCAN_ROOTS` 隔离；显式或临时测试根不会意外混入本机目录，歧义阈值和扫描深度保持不变。
- 新增回归并用真实 Codex `thread/list` 复验：6 个近期 cwd 下“个人网站”稳定解析到 `E:\_iva_workspace\portfolio-layered-hero-2026-08-31`。

### v0.18.4 — 2026-09-03

- 为旧数据盘项目增加启动时幂等修复：自动补齐缺失的 CTO 主 Session、Review 审核 Session，并在 Codex 全局状态中创建或复用同名项目文件夹。
- 控制线程创建使用按项目/角色的并发锁，避免后台修复和用户点击“进入 CTO”重复创建线程；线程 ID、项目文件夹 ID 和分组关系均写回数据盘及 Codex 全局状态。
- 使用真实数据盘 `E:\_Codex数据\AI-Project-Harness` 启动打包程序验证：`AI Project Harness` 与 `iva-local-chat` 两个旧项目均获得 CTO/Review thread，四个 thread 均已分配到对应 Codex 项目文件夹。
- 重新打包并通过 `smoke:codex-packaged`、`smoke:packaged-ui`、`smoke:portable`；portable 成品为 90,791,746 bytes，SHA-256=`60F0C172971F3439AE3758FB950C961D1608EB631290C731AD40DEFDD4FA0557`。桌面快捷方式目标已核对为该 portable 成品。

### v0.18.3 — 2026-09-03

- 为每个项目建立数据盘上的限长 CTO / Review 上下文文件；状态 JSON、JSONL 和上下文投影一起原子更新。
- 新增“进入 CTO”入口：打开绑定控制 thread，复制未发送的 `@文件路径` 草稿引用；公开 app-server 没有 composer 草稿 API，因此不自动发送或伪造接口。
- Review Agent 对手动恢复提交也走自动审核；修复自动接受后晚到 `turn/completed` 把任务 Session 回退为“待回写”的状态回归。
- 新增上下文包单元测试与真实 Electron 自动审核 Smoke，覆盖 CTO 文件生成、线程绑定、未发送语义和 Review 限长。
- 重新生成 Windows x64 portable：90,791,623 bytes，SHA-256=`FB7C0E2EFE40412B33DA469A40E8A467F2BE05042CC037B9200F92CA650B540C`；桌面快捷方式已指向 `AI-Project-Harness-0.0.12-portable.exe`。

### v0.18.2 — 2026-09-02

- 将发布验收补为真实 Electron Smoke：启动隔离 user-data 的目标程序，使用 Playwright Electron API 通过语义控件验证手动刷新、项目详情、自动刷新期间的抽屉/滚动/焦点/表单保持、审核推进、Claude 能力缺失提示和最小桌面布局。
- 新增 `npm run smoke:app` 与 `npm run check:release`；`package:win` 通过 `prepackage:win` 自动执行全量测试、构建和真实程序 Smoke。
- 新增 Windows GitHub Actions CI，push 和 pull request 均执行 `npm run check:release`。
- 明确验收边界：禁止整机级 computer-use 和鼠标键盘模拟；隔离的被测软件可以通过 Playwright、Electron/CDP、IPC 或专用 MCP 自动化操控。

### v0.18.1 — 2026-09-02

- 修复首页“最近一次进展”读取方向错误：状态机将新 checkpoint 放在数组头部，首页现在展示最新已验收进展，不再显示最早 checkpoint。
- 新增 renderer 回归，使用“最新 + 较早”双 checkpoint 验证首页显示最新条目。
- 保持 v0.0.11 的 Codex thread deep link、5 秒受保护自动同步、任务/审核展开器、焦点、选区和滚动保护不变。
- 最终 Windows portable 成品为 90,782,659 bytes，SHA-256=`3EDE2F60F85155EBA46E7693C0FC27AB661C3A7955C30EC1619C73769348A1B0`；桌面快捷方式已指向该包。

### v0.18.0 — 2026-09-02

- 修复 5 秒 runtime 自动刷新收起任务卡“验收条件”和审核证据展开器的问题；为每个展开器建立稳定 preserve key，heartbeat 重绘后恢复 `open` 状态与 summary 焦点。
- 对话框状态保护扩展到复选状态、文本选区方向、输入滚动位置和控件焦点，避免受保护刷新丢失用户正在编辑的细节。
- Codex Desktop 打开对话改为优先调用官方注册的 `codex://threads/<threadId>` 深链；深链不可用时回退 `codex app <project>`，返回 capability 和具体错误，不再把项目目录 fallback 伪装成精确对话跳转。
- 新增 headless renderer 回归：任务验收展开器、审核证据展开器在 heartbeat 后保持展开；新增 adapter 深链成功、深链失败回退和 launch 传递 thread ID 测试。

### v0.17.0 — 2026-09-02

- 恢复 5 秒 runtime 自动同步，覆盖 Git、Agent availability 和项目快照；删除 Agent monitor 的独立定时轮询，单一心跳请求在途时不重叠。
- 保留输入、对话框、指针交互的延迟重绘和普通控件焦点恢复；手动“刷新状态”作为即时同步入口继续可用。
- 增加生命周期回归，锁定“一个受保护心跳 + 无 monitor 定时器”的结构。

### v0.16.0 — 2026-09-02

- 移除全局 3 秒 renderer heartbeat 和 Agent monitor 定时 Git 刷新，避免自动重绘打断输入法、表单编辑、滚动和焦点；新增顶栏“刷新状态”作为用户主动同步入口。
- Agent 运行态仍由真实 Codex 事件驱动推送；当用户正在操作 dialog 或控件时延后应用快照，交互结束后再同步，避免替换正在编辑的 DOM 节点。
- 新增 headless 回归：无后台定时器、手动刷新调用、编辑中的输入节点不被 runtime 事件替换；全量 smoke 继续覆盖三处滚动容器。

### v0.15.0 — 2026-09-02

- 桌面 MVP 升级为 v0.0.10，新增独立 `agent-run-monitor`：监听 Codex `turn/*`、`item/*`、错误和文件事件，记录 Run 阶段、百分比、PID、事件数、最近事件和终态。
- 完成通知不再只负责关闭客户端：任务会从真实 `in_progress` 转为“已结束，待回写”，失败转为“执行失败”；Agent 输出中的 fenced `harness-result` 自动归一化并进入现有 Review gate，用户仍通过 Accept 推进 Project HEAD。
- Agent 事件和定时刷新都会读取真实 Git 状态，将分支、工作区变更、提交和检查时间写回项目 JSON；renderer 通过 `agent:runtime-update` 实时重绘，不需要手动刷新。（已由 v0.16.0 的 D-045 替代：全局定时刷新移除，改为手动刷新；Agent 事件仍可推送。）
- 修复 `turn/start` 后 Desktop fallback 期间的通知竞态：Codex client 保留有限通知缓冲，主进程挂载 monitor 后回放早到的完成/失败事件。
- 任务行显示阶段、百分比、PID、最近事件和“打开对话”。对 Codex 仅使用经过实测的 `codex app <project>` 项目路径 fallback，并明确提示没有公开 thread deep link；Claude Code 仍只显示用户主动调用路径，不伪造后台连接。
- TDD 新增 parser、运行态终止、失败态、Git 回写、preload 事件桥和早到通知回放测试；全量测试、TypeScript/Vite 构建和 headless renderer smoke 均作为本版本门禁。

### v0.14.0 — 2026-09-02

- 桌面 MVP 升级为 v0.0.9；以错误编号 `APH-20260902-050607-1f3a30` 为起点，对同族进程启动、失败清理、错误传播与部分成功状态做统一审查，不再只修一个 `spawn EINVAL` 调用点。
- 新增共享 `command-runtime`：Codex、Git 和开发启动链统一按原生 EXE 与 CMD/BAT shim 分流；空 executable、NUL、CMD/BAT 引号与换行在进入子进程前拒绝。Vite 开发服务直接由 Node 执行 JS，Electron 直接调用原生 EXE，不再启动 `npm.cmd` 或 `electron.cmd`。
- app-server 初始化超时、thread/name/turn 创建失败和 stdin/stdout/stderr 错误均进入正常 reject 与关闭流程；失败时不再遗留半初始化客户端。Git 读取同时支持仅能发现 `git.cmd` 的 Windows 环境。
- `codex app` 打开失败不再显示“Codex 已启动”，也不再抹掉已经创建的 thread/run。IPC 写入 JSONL 并返回持久 warning；Dialog 保持打开、显示错误编号与“重新打开 Codex”。恢复成功后持久 `desktopOpened` 状态同步改正。
- TDD 对开发启动器、命令输入边界、CMD app-server、复杂项目路径、初始化/turn/标准流失败、Git CMD-only、Desktop warning、JSONL 和恢复写回建立回归。全量 61/61、192 次名称解析 0 漂移、headless renderer 的失败→重试→warning→恢复链、真实 source `codex.cmd` 只读 smoke 和最终 ASAR adapter + Electron 41 + CMD smoke 全部通过，返回 16 个近期 cwd；全程未创建 Codex 任务或操控桌面窗口。
- 成品 `AI-Project-Harness-0.0.9-portable.exe` 为 90,776,732 bytes，PE 产品/文件版本均为 `0.0.9`，SHA-256=`91303B8011F87DAA7D95CB087A995D99AD51F6CCFB936ACE3759B6E611C64427`，未签名；ASAR 内 8 个关键 runtime 模块与源码哈希一致且包含共享命令层，外置 Skill 与源码 SHA-256 一致，ASAR 内无重复 integrations。
- 桌面 `AI Project Harness.lnk` 已切换到 v0.0.9 成品并验证目标存在；未启动或操控任何桌面窗口。

### v0.13.0 — 2026-09-02

- 桌面 MVP 升级为 v0.0.8，修复错误编号 `APH-20260902-050607-1f3a30` 对应的项目接入 `spawn EINVAL`。
- 根因实证：系统 User/Machine PATH 包含 npm shim 目录但不包含 Codex Desktop 的版本化 `bin` 目录；桌面快捷方式启动的 Harness 因此选择 `codex.cmd`。Node 24 将 `.cmd` 直接作为原生 executable 调用会同步抛出 `EINVAL`；Codex 本体、portable 临时 resources cwd 和 Electron 41 runtime 均已排除。
- Codex adapter 新增 Windows CMD/BAT 兼容入口：原生 EXE 保持直启；shim 由 `cmd.exe /d /v:off /s /c` 执行，executable 与参数通过子进程专属环境变量整体引用，含空格与 `%&!()` 的项目路径仍作为单个参数传递。关闭 app-server 时先结束 stdin，避免 shim 子进程残留。
- `spawn EINVAL` 即使再次发生也会显示完整中文原因与错误编号，不再把两个英文单词直接暴露给用户。
- TDD 新增真实 CMD shim app-server 与复杂项目路径参数回归；全量 48/48、192 次名称解析 0 漂移、headless renderer、真实 npm `codex.cmd` 只读 app-server、最终 ASAR adapter + Electron 41 + CMD shim 全链路 smoke 均通过，返回 16 个近期 cwd，全程未创建 Codex 任务或操控桌面窗口。
- 成品 `AI-Project-Harness-0.0.8-portable.exe` 为 90,773,200 bytes，PE 产品/文件版本均为 `0.0.8`，SHA-256=`D3D381F62D2BA9965236FE682680FC39997A542669CE1E5515AB402DB5FCE537`，未签名；ASAR 内 6 个关键 runtime 模块与源码哈希一致，命令兼容代码存在，外置 Skill 与源码 SHA-256 一致且 ASAR 内无重复 integrations。
- 桌面 `AI Project Harness.lnk` 已切换到 v0.0.8 成品并验证目标存在；未启动或操控任何桌面窗口。

### v0.12.0 — 2026-09-02

- 桌面 MVP 升级为 v0.0.7，修复输入项目名后长时间没有任何进度反馈、失败只出现短暂且不可追踪错误的问题。
- 项目接入服务新增 7 个真实阶段事件；Dialog 显示确定进度、当前步骤和 busy 状态，失败后保留项目名并允许原地重试。
- 新增本地 JSONL 错误日志、唯一 `APH-*` 错误编号、1 MiB × 3 归档轮转和“打开错误日志”入口；onboarding、renderer、主进程未捕获异常和未处理 Promise 统一记录原始堆栈。
- `fetch failed`、初始化超时、app-server 不可写/退出和 Codex executable 缺失均转换为可行动中文原因；Electron remote-method 包装不再进入用户可见正文。
- TDD 新增日志落盘与轮转、失败阶段、progress IPC、preload 订阅、renderer 状态与三类 Codex 连接错误回归；headless renderer 代码模拟验证 loading → 46% Git 阶段 → 持久错误 → 打开日志 → 重试成功，全程不启动或操控桌面窗口。
- 全量自动化为 45 项；6 个真实项目名各 32 次乱序共 192 次解析保持 0 漂移，`Local Chat` 稳定定位 `iva-local-chat`。真实 Codex app-server 在 packaged `resources` cwd 完成只读 `initialize + thread/list`，返回 16 个近期 cwd，未创建任务或打开窗口。
- 成品 `AI-Project-Harness-0.0.7-portable.exe` 为 90,775,319 bytes，版本 `0.0.7`，SHA-256=`0D6E321A6FF6CF95E4A0E8934EAE464E3CA8AE3D36A109F88FCE9B08941D0C5B`，未签名；ASAR 内 7 个关键 runtime 模块与源码哈希一致，外置 Skill 与源码 SHA-256 一致且 ASAR 内无重复 integrations。
- 桌面 `AI Project Harness.lnk` 已切换到 v0.0.7 成品并验证目标存在；未启动或操控任何桌面窗口。

### v0.11.0 — 2026-09-02

- 桌面 MVP 升级为 v0.0.6，修复 packaged EXE 输入项目名后出现 `spawn ... codex.exe ENOENT` 与 `Error invoking remote method` 的故障。
- 根因实证为 Codex EXE 存在且可运行，但 portable 主进程把 `resources/app.asar` 文件作为 app-server `cwd`；Windows 对无效工作目录返回 `ENOENT`。
- packaged app-server 改用真实 `resources` 目录；内置 Skill 通过 electron-builder `extraResources` 放到 ASAR 外，外部 Codex 得到普通文件路径。
- 项目接入抽成与 IPC 共用的可注入生产服务；代码级完整模拟验证 `Local Chat` → `iva-local-chat` Git 仓库 → onboarding Task/Warm Session → 持久 thread/turn → Skill 输入 → 状态落盘。
- 四个失败边界覆盖 Codex 不可用、项目不存在、Skill 缺失和 app-server 失败；失败不伪装成功，Skill 缺失不创建 phantom project，协议失败保存为可重试任务。
- Electron IPC 错误在 renderer 显示前净化，不再向用户暴露 remote method 名和内部包装；`spawn ... ENOENT` 转为可行动中文提示。
- 全量自动化为 31 项，代码集成 Smoke 约 1 秒；验收禁止桌面自动化和低效率重复测试，固定为一条成功链路、四个机制不同的边界、全量回归与一次资源审计。
- 成品 `AI-Project-Harness-0.0.6-portable.exe` 为 90,773,854 bytes，版本 `0.0.6`，SHA-256=`2306DF140953C0CCF5A5592348F03BAA18589FC20BD4E9D9B7DA394E0A7B57D6`，未签名；外置 Skill 与源码 SHA-256 一致，生产服务与 runtime path helper 均存在于 ASAR，ASAR 内不重复打包 integrations。
- 桌面 `AI Project Harness.lnk` 已更新为 v0.0.6 成品，目标存在；未启动或操控任何桌面窗口。

### v0.10.0 — 2026-09-02

- 使用 electron-builder 26.0.12 将 v0.0.5 封装为 Windows x64 portable EXE，应用代码进入 ASAR。
- 打包复用项目已安装的 Electron 41.3.0 runtime，避免重复下载同版本 143 MB 运行时。
- 当前 Windows 账户无法为 `winCodeSign` 的 macOS 兼容文件创建 symlink，因此关闭 EXE 元数据/签名编辑；成品明确标记为未签名 portable 软件。
- 成品 `AI-Project-Harness-0.0.5-portable.exe` 为 90,773,410 bytes，PE 产品名和版本正确，SHA-256=`681354AAA0CB53BF3FBAB0592083B4297938554380440F123C01797FA27D12B8`，并完成真实窗口启动 smoke。
- 桌面 `AI Project Harness.lnk` 已改为直接指向 portable 成品，不再调用开发目录中的 Electron runtime。

### v0.9.0 — 2026-09-02

- 将后续 Git 可视化定义为 Project Lineage Graph（工程谱系图），采用横向时间轴与 branch lane 骨架。
- 明确 Git commit / branch / merge 是代码事实层，Harness Task / Agent / checkpoint / 用户验收 / state delta 是工程语义叠加层。
- 定义节点点击详情：时间戳、功能变化、代码 diff、文件、测试、PR / Issue、项目状态变化与 provenance。
- 默认按 checkpoint / milestone 聚合，按需展开 commit；使用窗口化横向滚动并默认聚焦当前 HEAD。
- 将该能力列为 schema 稳定后的后置原型，不改变当前自动回写、Ledger 协议和存储层优先级。

### v0.8.0 — 2026-09-02

- 桌面 MVP 升级为 v0.0.5，修复输入 `Local Chat` 无法发现 `E:/Cloudflare/my-workflow/iva-local-chat` 的真实故障。
- 根因是 Codex 最近 cwd 只有父项目 `my-workflow`，v0.0.4 只扫描其同级目录，没有把父项目中的独立嵌套 Git 仓库加入候选；模糊评分本身无误。
- 候选发现现在额外检查 Codex 已知项目和最近 Git 根的一层直接子目录，并且只接纳包含 `.git` 的仓库；普通文件夹和更深层目录不会被无界递归。
- 新增真实目录形态的 RED → GREEN 回归、非 Git 子目录和递归深度边界；全量测试增至 20 项。
- 本机 Codex 16 个近期 cwd 上加入 `Local Chat` 后完成 6 个项目 × 32 次乱序，共 192 次解析，错配与顺序漂移均为 0；真实返回 `iva-local-chat`，substring 分数 `0.94`，Git 根与 `main` 分支校验通过。

### v0.7.0 — 2026-09-01

- 桌面 MVP 升级为 v0.0.4；项目接入从精确目录名升级为置信度有界的近似名称解析。
- 支持大小写/全半角规范化、空格与连接符省略、缩写、核心子串、少量中英文错拼；Codex cwd 位于仓库子目录时向上回溯最近 Git 根。
- 增加最低置信阈值、短输入严格阈值和第二候选 `0.07` 分差门；同名、近邻歧义和低置信状态一律拒绝猜测。
- 自动化回归覆盖错拼、缩写、中文近似名、顺序稳定、嵌套 cwd、歧义和低置信候选；本机 Codex `thread/list` 的 16 个真实 cwd 上完成 5 个项目 × 32 次乱序，共 160 次解析，错配与顺序漂移均为 0。
- 接入 Dialog 仍只有一个输入框；新增一段近似名说明，不增加项目选择器或常驻配置面板。

### v0.6.0 — 2026-09-01

- 桌面 MVP 升级为 v0.0.3；“接入项目”由文件夹选择改为只输入项目名。
- Codex 成为首发默认 Agent；项目接入自动完成名称解析、Git 校验、独立持久 thread 创建、命名和 Desktop 打开。
- 新增项目内置 `ai-project-harness` Skill，并通过 Codex `turn/start` 原生 Skill 输入与 Bootstrap Packet 同时注入；Onboarding 固定为只读和 candidate-result 边界。
- 新增项目名歧义、路径拒绝、preload IPC、onboarding 复用和 Skill 注入测试；真实 app-server 已读取 15 个近期 cwd，并成功创建带 Skill 输入的独立 Codex thread。
- 首屏仍只保留当前目标、审核和任务列表；接入 Dialog 仅一个输入框、一行 Codex 默认连接状态和一个主操作。
- 明确 app-server 是 experimental；自动捕获 `harness-result` 与写入审核区仍是下一门槛，不伪装为已完成双向闭环。

### v0.5.0 — 2026-09-01

- 桌面 MVP 升级为 v0.0.2；不改状态机，重构首屏信息架构。
- 从三列常驻控制台改为“项目列表 + 单一工作区”，移除永久 Git evidence rail、竖排 Task ID、重复技术标签和底部状态栏。
- 首屏只保留当前目标、待确认结果和任务列表；Git、Agent、Session 与项目路径进入可用 Esc 关闭的项目详情抽屉。
- 酸绿从大面积装饰收敛为待确认、选中、在线状态与主操作信号；中文成为主要界面语言。
- 1480×920、1100×700、长标题、抽屉焦点与 Esc、审核推进、Disposable Session 退役和控制台零错误通过。

### v0.4.0 — 2026-09-01

- 交付首个可运行 Windows 桌面 MVP v0.0.1，采用 Electron + Vite + TypeScript。
- 实现真实 Git 读取、Task dispatch、Mission Packet、candidate result、用户接受事务和 Project HEAD 推进。
- 实现 Warm / Disposable Session 状态、cursor 推进和 stale-result 拦截。
- 在 Agent Pack 完成前采用明确标注的手动 JSON bridge。
- 8 个状态机与 Git 边界测试、TypeScript、生产构建和真实 Electron 交互通过。
- 完成 1480×920、1100×700、长标题、任务 dialog、键盘焦点和控制台检查。

### v0.3.0 — 2026-09-01

- 将 Task、Run、Session 和 Agent 解耦，取消“一任务一新会话”的绝对策略。
- 增加无长期聊天记忆的 Project Steward 控制角色。
- 引入 Warm Workstream Session、Disposable Specialist Session 和 Review Session。
- 增加 Session Lease、state cursor、Bootstrap / Delta Packet 和自动退役条件。
- 增加基于 base project revision 的 task lease 与 stale-result 拦截。
- 增加 candidate Task Result、用户审核卡和原子接受事务。
- 明确 Agent 通过 Project Ledger 协作，不互相灌入完整 transcript。
- 修改 MVP 验收，同时验证温会话复用和一次性会话隔离。

### v0.2.0 — 2026-09-01

- 将产品从泛化“桌面项目面板”收敛为 Git-native Project State Version Control System。
- 明确 Code Repository 与 Project State Repository 双仓模型。
- 增加 Agent → Harness 和 Harness → Agent 双向配套关系。
- 将“无损压缩”校正为 Raw Archive、Project Ledger、Mission View 三层架构。
- 增加 Session Import Protocol、内容寻址归档、幂等导入和 provenance 要求。
- 明确 skill 是导入控制入口，不负责把 GB 级 transcript 送入模型上下文。
- 纳入 Claude Code OAuth wrapper 安全边界。

### v0.1.0 — 2026-09-01

- 确立“项目长期存在，Agent 会话随时轮换”。
- 初步定义项目列表、项目驾驶舱、启动任务抽屉。
- 确定 Codex + Claude Code、Windows 首发和 5 任务接力验收方向。
