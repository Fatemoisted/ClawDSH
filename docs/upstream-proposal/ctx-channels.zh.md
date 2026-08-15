# `ctx.channels` Service Definition 记录

[English](ctx-channels.md) | 中文

> 本文是历史 `docs/upstream-proposal/` 位置中的内部 seam 记录。目前没有提议上游 pull request。ADR-0008 取代 ADR-0002 描述的 adapter registry；当前代码全部位于 `packages/openclaw/`。

## 动机

DeepSeek Harness 拥有 Agent 执行与持久 Session，但没有 provider-neutral 消息传输 seam。ClawDSH 需要一个窄连接点，让外部通信平面提交已准入回合，也让 Agent 请求平台原生动作。平台 SDK、凭证、准入策略与投递不能泄漏进 Agent driver；Agent 与 Session 生命周期也不能移入传输 host。

## 当前 seam

`@clawdsh/dsh-channel` 提供带两个生命周期限定 slot 的 `ctx.channels`：

- 一个由通信平面拥有的 `ChannelProviderV1`，实现 `action()` 与 `health()`；
- 一个由 Agent 平面拥有的 `ChannelDriverV1`，实现 `runTurn()`、精确取消、reset、close 和可选 delivery-ledger reconciliation。

Service 在两个角色之间 dispatch，并在所需角色缺失或重复时失败。它包含严格 provider-neutral V1 protocol type 与 validator，但没有 OpenClaw import、平台分支、credential、Session 创建逻辑、transport retry 或默认 provider。

## 协议义务

已准入回合命名 Gateway lineage、OpenClaw session key、reset generation、channel、account、conversation、可选 thread、direct/group kind、sender admission class、platform message、idempotency key、turn/run id、text、排序的 staged media 与可选 trace。Terminal result 可 replay，并区分 completed、silent、cancelled 与 failed。

`channel.action` 是 send、edit、delete、react、poll、typing、directory query 与 resolution 的闭合 union。Provider delivery receipt 区分 accepted、confirmed、retrying、ambiguous 与 dead-letter。可选 `delivery.report` extension 把最终回合投递与 Agent 侧持久 ledger 对账。Ambiguous receipt 绝不授权 Service 重跑回合或重发动作。

## 装配

当前 Provider 是 `@clawdsh/dsh-channel-openclaw`，它认证并校验锁定的本地 OpenClaw Gateway。当前 Driver 是 `@clawdsh/dsh-channel-agent`，它拥有持久 route/session binding、幂等、Agent 执行、模型可见日志与 attachment import。当前行为与限制见 `docs/specs/feature-channel-plane-bridge.zh.md`。

ClawDSH 只交付 `ctx.channels → channel-agent → channel-openclaw` runtime path。它没有 `ctx.legacyChannels` alias 或直连平台 adapter package；旧名称只保留在只读迁移清单与发行 denylist 中。

## 所需上游 Session-event seam

Channel provenance 经已知 `user/message.source.kind = 'channel'` 路径到达模型。Admission、idempotency 与 delivery 权威留在 channel ledger。当前实现不 append `channel/turn-admitted` 或 `channel/delivery`：dsh static known-event vocabulary 排除 downstream name，`Session.append()` 不能把 non-surface event 标为 `ignorable: true`，所以持久化会使 resume 拒绝该 log。

`session-plugin-events.zh.md` 提议 ClawDSH 增加冗余 namespaced diagnostic 前需要的独立上游 seam。它不属于 `ctx.channels`，因为安全 event-envelope creation 属于 Session owner，并可服务任何 downstream plugin。

## 上游边界

如果 DeepSeek Harness 日后需要通用渠道能力，只有 provider-neutral Service Definition 是上游候选。OpenClaw Provider、channel catalog、host lock 与迁移策略仍由 ClawDSH 拥有。上游 proposal 需要独立 consumer 与 provider、ClawDSH 之外的稳定需求，以及常规 complete-seam 要求；本文不声称这些条件已经满足。

## 当前验证限制

软件包层 protocol 与 lifecycle 证据不能认证平台。Production sidecar 没有在交付 profile 中启用，缺少自有无密钥 assembled snapshot，缺少 Windows endpoint ACL enforcement，namespaced Session event 保持禁用，且本次变更没有当前 Telegram 或 Feishu live smoke。因此支持声明遵循 `cataloged → installable → certified → enabled`；本文没有任何渠道达到最后两个状态。
