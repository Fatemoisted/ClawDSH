# Agent Note: 删除重复的旧渠道平面

Status: implemented

[English](2026-08-16-remove-legacy-channel-plane.md) | 中文

## 问题

ClawDSH 同时携带两套相互竞争的渠道集成平面：规范的锁定 OpenClaw Gateway seam，以及带 Telegram 与飞书直接适配器的进程内 `channel-core` 注册表。两条路径都拥有传输配置、生命周期、平台行为和测试。保留两者会使受支持的运行时含糊不清，并要求 ClawDSH 重复 OpenClaw 已经负责的工作。

## 决定

唯一可运行的渠道集成是[渠道平面架构 Note](../architecture/2026-08-15-openclaw-channel-plane-bridge.md)描述的规范 `ctx.channels → channel-agent → channel-openclaw` 平面。`@clawdsh/dsh-channel` 定义协议，`@clawdsh/dsh-channel-agent` 负责 agent 执行，`@clawdsh/dsh-channel-openclaw` 连接锁定的 OpenClaw Gateway。`channel-core`、`channel-telegram` 和 `channel-feishu` 包及其 workspace、图、目录、notice 和 profile 引用均不存在。

对已删除包的两类引用会被有意保留。只读迁移清单识别旧包名和凭证名，但不会加载适配器、把凭证值读入报告或复制秘密。发布工具 denylist 拒绝旧包名，确保发行版不会意外重新引入第二套运行时。

Telegram、飞书和 Discord 的支持状态只遵循规范渠道支持阶梯及其当前证据。删除直接适配器不会认证、启用这些平台，也不声称其中任何一个已通过实时 e2e。

## 考虑过的替代方案

**通过独立配置保留两套平面。** 否决：两个实现仍会分割所有权、重复平台行为，并让运维人员无法确定哪条路径定义支持状态。

**把直接适配器的呈现和 reaction 行为移入规范包。** 否决：平台身份、mention、reaction、凭证和 SDK 生命周期属于 OpenClaw；DSH 包只负责认证协议与 agent 执行。

**删除对旧包的每一处文本引用。** 否决：迁移识别与发布 denylist 是负向保护，不是可执行适配器。删除它们会降低迁移可观测性，并允许意外重新发布。

## 后果

源码树、workspace 图、生成目录和发行版只保留一套渠道运行时。直接适配器特有的身份、mention、ack 与 reaction 行为不再是 ClawDSH 包约定；已归档的[身份呈现](../../archived/feature/2026-08-14-channel-identity-presentation.md)与 [ack reaction](../../archived/feature/2026-08-14-ack-reaction-scope.md) Note 只作为历史快照。任何平台能力都必须通过规范支持阶梯推进，而迁移检测和发布 denylist 继续防止不安全切换或重新引入。
