# ClawDSH 项目目的与实施方案

[English](roadmap.md) | 中文

> 本文档是 ClawDSH 的纲领：回答"为什么做、做什么、怎么做"。决策细节在 `docs/adr/`，功能对齐在 `docs/matrix/parity.md`，规范在 `docs/standards/`。

## 一、项目目的

**ClawDSH = OpenClaw 的个人助手功能集，重建于 DeepSeek Harness (dsh) 的 Cordis 插件底盘之上。**

OpenClaw 的困境的本质，不是"社区 PR 太多"，而是**架构没有接缝（seam）**：任何社区功能都无法以插件形式落地，只能不断堆进核心，导致耦合失控、代码不可维护，最终走向崩塌。

dsh 的 Cordis 架构（everything is a plugin：插件用 `inject` 声明依赖、通过类型化事件协作、挂载卸载可逆）从架构上根治这个问题：**每个社区功能是一个独立插件，新增能力不再触碰核心**。用户通过 profile/patch 机制自由组合出自己想要的个人 Agent。

## 二、核心原则（不可妥协）

1. **上游只读**：dsh 上游代码（`vendor/`、`packages/*`（openclaw/ 除外）、`apps/`、`website/`）保持不改；一切定制落在 ClawDSH 自有插件或应用组装、profile 与 patch 中。
2. **Upstream-first**：缺少 dsh seam 时，先向上游提 PR，本地用 patch 过渡，上游合并后删除 patch。ClawDSH GUI 消费 dsh 既有公开 API，属于应用组装而非缺失接缝；如果实现需要上游改动，本 GUI 工作会停止，并在批准的 local-only 边界内重新设计，而不是发起上游 PR（[ADR-0007](../adr/0007-clawdsh-local-gui-product.md)）。
3. **移植对象是功能类别，不是 PR**：OpenClaw 上万 PR 里绝大多数是 bugfix/重构/重复功能，我们要的是 20~40 个功能域。
4. **垂直切片优先**：每个阶段都要有"能跑起来的东西"，不做大而全的空想。
5. **反 OpenClaw 病**：任何 PR 必须链接规格 + 更新矩阵 + 过契约测试才可合入（见 `docs/standards/pr-policy.md`）。

## 三、实施阶段

### 阶段 0 · 可行性 Spike ✅（2026-08-14 完成）

- 产出：功能对齐矩阵 v1；`@clawdsh/dsh-soul` 插件（replace/append 双模式 + 灵魂文件加载）。
- 退出标准**全部达成**：soul 能替换/叠加 agent 系统提示词（契约测试 10/10）、热插拔（卸载即回卷）、未改上游一行源码（仅构建注册豁免，见 ADR-0001 决策 4）；全量 typecheck 绿；`--profile openclaw --dump-config` 冒烟通过。
- **结论：接缝假设成立，项目继续。** 验证细节见 docs/specs/feature-soul.md 的验收标准节。

### 阶段 1 · 基线选型 + 矩阵定稿 ✅（2026-08-14 完成）

- **基线定稿：`v2026.1.5`（`197b8f7c3b`）**——首个发布 tag，网关+5 渠道+cron+sessions 核心体验完整，所有 tag 中代码量最瘦（1537 文件/1.6MB），无 bloat 迹象；v2026.1.15 起文件数翻倍、extensions/plugins/部署矩阵出现。功能补全参考：whatsapp/memory/channels → v2026.1.15（`9c4c9c5edd`）。
- OpenClaw 派生功能域的四分类已经定稿，见 `docs/matrix/parity.md`（矩阵 v2，含每个移植域的基线出处路径）。ClawDSH 原生产品面另用「产品组装」分类。

### 阶段 2 · 核心骨架（垂直切片）✅（2026-08-14 完成）

- `channel-core`（新 seam，按 ADR-0002 设计）+ `channel-telegram`（第一个渠道）+ **`channel-feishu`（发起人第一优先，ADR-0002 seam 验证备选渠道）** + `soul` + `memory` + `preset-openclaw`。
- 退出标准：`pnpm dsh --profile openclaw` 启动，Telegram 消息进 → 人格化 agent 跑 → 回复出；`ctx.channels` 契约同时通过 Telegram 与飞书两个适配器的验证（飞书出处：OpenClaw `extensions/feishu`，v2026.2.12）。
- **状态（2026-08-14）**：核心交付完成并收口——渠道 seam + 双适配器（飞书真实 e2e 全链路验证；Telegram 凭证阻塞）、soul 深读定稿（replace/append 即最终形态，相对 `source` 按 `ctx.baseUrl` 解析）、memory 三包 + `ctx.embeddings` seam（ADR-0003）+ 真实 ARK e2e（tools/ark-e2e.ts）、preset 常驻化且 embeddings-ark 已启用、双语 26 对完成。见 docs/journal/2026-08-14.md。

### 阶段 3 · 渠道铺开 + 自动化 ✅（2026-08-14 完成）

- 每个渠道一个包（WhatsApp/Email/Web Chat…），互不阻塞；`automation`（schedule 桥接）、`skills-hub`（ClawHub provider）。
- **渠道范围原则**：只做 OpenClaw 上游有出处的渠道（见 docs/matrix/parity.md「国内平台」节）——微信系/钉钉/QQ 上游无对应，不实现。
- 联邦节点（clawd）走 `ctx.subagents` transport，作为独立里程碑评估。
- **状态（2026-08-14）**：`skills-hub` 与 `automation` 已交付（automation 默认 disabled、croner 走 `ctx.agents`/`ctx.sessions`）；ack-reaction 渠道身份呈现、memory 宿主 watcher、npm 发布（ADR-0004）、clawd 联邦（ADR-0005，仅评估）均已收口。其余渠道与联邦实现仍暂缓。见 docs/journal/2026-08-14.md。

### 阶段 4 · 用户生态（进行中）

- 插件开发模板 + 契约文档公开；接入 dsh 的 `dsh-plugin` 发现机制。
- 仅 preset 的 dsh Web GUI 基线已经可用。[ADR-0007](../adr/0007-clawdsh-local-gui-product.md) 定义了待实现的 ClawDSH 产品壳、能力 Settings、语义 Activity 与 Harness 高级入口，且不修改上游 GUI。
- 可安装发行物与老 OpenClaw 用户迁移指南（Session/Skill 导入）仍是阶段 4 交付项。

### 贯穿全程

- 上游同步 CI（每周 rebase + 冒烟）；里程碑功能冻结（只修 bug 不收新功能）。

## 四、成功标准

1. 一个社区功能 = 一个插件包，合入不碰核心——OpenClaw 的死亡模式在架构上不可能发生；
2. 用户能用一份配置自由组合渠道/人格/记忆/自动化，得到自己的个人 Agent；
3. 对 dsh 上游的净分叉趋近于零（能上游化的全部上游化）；
4. 本地用户无需编辑原始 Cordis entry，即可配置、理解并检查 ClawDSH，同时纯净 dsh Web profile 与原始 Harness 诊断仍然可用。

## 五、待定事项

- [ ] OpenClaw 基线 commit（阶段 1 首个任务）
- [x] Soul Spike 结论（✅ 可行，继续）
- [ ] `ctx.channels` seam 是否被 dsh 上游接受（影响 patch 层厚度）
- [ ] ClawDSH 本地 GUI 产品壳（[ADR-0007](../adr/0007-clawdsh-local-gui-product.md)）
- [x] 私有远程仓库创建（Fatemoisted/ClawDSH，2026-08-14 完成）
