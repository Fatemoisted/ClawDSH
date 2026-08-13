# ClawDSH 项目目的与实施方案

> 本文档是 ClawDSH 的纲领：回答"为什么做、做什么、怎么做"。决策细节在 `docs/adr/`，功能对齐在 `docs/matrix/parity.md`，规范在 `docs/standards/`。

## 一、项目目的

**ClawDSH = OpenClaw 的个人助手功能集，重建于 DeepSeek Harness (dsh) 的 Cordis 插件底盘之上。**

OpenClaw 的困境的本质，不是"社区 PR 太多"，而是**架构没有接缝（seam）**：任何社区功能都无法以插件形式落地，只能不断堆进核心，导致耦合失控、代码不可维护，最终走向崩塌。

dsh 的 Cordis 架构（everything is a plugin：插件用 `inject` 声明依赖、通过类型化事件协作、挂载卸载可逆）从架构上根治这个问题：**每个社区功能是一个独立插件，新增能力不再触碰核心**。用户通过 profile/patch 机制自由组合出自己想要的个人 Agent。

## 二、核心原则（不可妥协）

1. **上游只读**：dsh 上游代码（`vendor/`、`packages/*`（openclaw/ 除外）、`apps/`、`website/`）一行不改；一切定制走插件、profile、patch。
2. **Upstream-first**：缺接缝时先向上游提 PR，本地用 patch 过渡，上游合并后删 patch（避免分叉死亡）。
3. **移植对象是功能类别，不是 PR**：OpenClaw 上万 PR 里绝大多数是 bugfix/重构/重复功能，我们要的是 20~40 个功能域。
4. **垂直切片优先**：每个阶段都要有"能跑起来的东西"，不做大而全的空想。
5. **反 OpenClaw 病**：任何 PR 必须链接规格 + 更新矩阵 + 过契约测试才可合入（见 `docs/standards/pr-policy.md`）。

## 三、实施阶段

### 阶段 0 · 可行性 Spike（目标：1~2 周）

- 产出：功能对齐矩阵 v1；一个最小插件（Soul）验证接缝假设。
- 退出标准：Soul 插件能替换 agent 系统提示词、可热插拔、不改上游源码。
- **如果这一步做不通，就说明整体方向错误，止损成本极低。**

### 阶段 1 · 基线选型 + 矩阵定稿

- 选 OpenClaw 基线：目标窗口 2025-12 ~ 2026-01（"网关+渠道+人格+记忆已稳定、功能未爆炸"），按**功能集合边界**选 commit，不按日期拍脑袋；对比代码量后定稿。
- 每个功能域四分类：`复用 dsh` / `新 seam` / `纯插件` / `暂缓`，写进 `docs/matrix/parity.md`。

### 阶段 2 · 核心骨架（垂直切片）

- `channel-core`（新 seam，按 ADR-0002 设计）+ `channel-telegram`（第一个渠道）+ `soul` + `memory` + `preset-openclaw`。
- 退出标准：`pnpm dsh --profile openclaw` 启动，Telegram 消息进 → 人格化 agent 跑 → 回复出。

### 阶段 3 · 渠道铺开 + 自动化

- 每个渠道一个包（WhatsApp/Email/Web Chat…），互不阻塞；`automation`（schedule 桥接）、`skills-hub`（ClawHub provider）。
- 联邦节点（clawd）走 `ctx.subagents` transport，作为独立里程碑评估。

### 阶段 4 · 生态化

- 插件开发模板 + 契约文档公开；接入 dsh 的 `dsh-plugin` 发现机制；老 OpenClaw 用户迁移指南（会话/技能导入）。

### 贯穿全程

- 上游同步 CI（每周 rebase + 冒烟）；里程碑功能冻结（只修 bug 不收新功能）。

## 四、成功标准

1. 一个社区功能 = 一个插件包，合入不碰核心——OpenClaw 的死亡模式在架构上不可能发生；
2. 用户能用一份配置自由组合渠道/人格/记忆/自动化，得到自己的个人 Agent；
3. 对 dsh 上游的净分叉趋近于零（能上游化的全部上游化）。

## 五、待定事项

- [ ] OpenClaw 基线 commit（阶段 1 首个任务）
- [ ] Soul Spike 结论（决定是否继续）
- [ ] `ctx.channels` seam 是否被 dsh 上游接受（影响 patch 层厚度）
- [ ] 项目官方名称确认（ClawDSH 为暂定名）与私有远程仓库创建
