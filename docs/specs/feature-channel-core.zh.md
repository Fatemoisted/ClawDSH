# 功能规格：渠道网关 seam（channel-core）

[English](feature-channel-core.md) | 中文

- **状态**：implemented（阶段 2 ✅，2026-08-14）
- **实现包**：`packages/openclaw/channel-core`（`@clawdsh/dsh-channel-core`）
- **OpenClaw 对应**：渠道网关（`src/gateway/`，基线 v2026.1.5）。OpenClaw 的每个渠道直接长进网关与 agent 逻辑，是"架构无接缝"的典型病灶；本规格把网关拆成「薄装配层 + 渠道适配器」两层。

## 目标

- 提供 `ctx.channels` 服务——本项目**唯一新增 seam**（设计见 docs/adr/0002-channel-seam.md）：
  - **适配器注册表**：渠道插件注册一个 `ChannelAdapter`，按 id 唯一，注销即回卷（HMR 安全）；
  - **入站路由**：`channel/inbound` 消息 → 定位/创建 per-thread agent 会话 → 写入 session log → 驱动 agent turn；
  - **出站投递**：agent 回复 → `channel/outbound` + 对应 `adapter.send`。
- 渠道插件只实现 `receive`（入站事件）与 `send`（出站投递）两个能力面；路由、会话绑定、turn 串行化、重试策略全部归 `channel-core`。
- 契约继承 dsh 不变式：一切入站消息与出站回复必须写进 session log（"model-visible means logged"）。

## 非目标

- 附件 / 引用回复 / 富文本 / 交互卡片——阶段 3 渠道扩展（ADR「最小面」）；
- 跨消息交错、多 sender 归并、消息分组——阶段 3；本阶段以 per-thread tail-chain 串行化兜底；
- 渠道特性（引用、卡片模型）的统一抽象——不预设，等第二个渠道特征沉淀后再提炼。

## 接缝（阶段 2 已确认）

`ctx.channels`（`ChannelRegistry extends Service`，`super(ctx, 'channels')`）：

- `static inject = ['agents', 'sessions', 'agentDefaultModel']`；
- `registerAdapter(adapter)`：id 唯一校验 → `ctx.effect` 内 `adapter.start(ctx)` + 存 map，返回 disposer；
- `getAdapter(id)` / `listAdapters()`；
- 私有 `route(message)`：per-thread 会话 map（key = `${channel}\0${threadId ?? ''}`）→ `ctx.agents.create`（首条）或复用（后续）→ `followup(createUserMessage(...))` → `whenIdle()` → `sessions.flush()` → 扫 `assistant/message` 文本块取回复 → `adapter.send(outMsg)` + `ctx.emit('channel/outbound', outMsg)`；
- 事件（declaration merging）：`channel/inbound`、`channel/outbound`。

**结论：接缝假设成立**——渠道接入 = 一个 `ChannelAdapter` 实现，不改上游一行源码、不动 `agent-loop`。

## 配置面

无 `Config`（service 包，非函数插件）。适配器插件通过 `ctx.channels.registerAdapter(adapter)` 注册；部署级凭证在各自适配器插件的 `Config` 中，经 profile/patch 覆盖。

## 验收标准（阶段 2 结论）

1. ✅ **注册/注销（HMR 回卷）**：`registerAdapter` 后 `listAdapters` 含之、dispose 后移除（测试覆盖）；
2. ✅ **重复 id fail-loud**：注册同名适配器抛错（测试覆盖）；
3. ✅ **入站 → 出站回投闭环**：MockAdapter + 七件套 harness 验证「入站 → 真 agent turn → 回复出」+ `channel/outbound` 收到 + 回复文本非空（测试覆盖，无 key）；
4. ✅ **per-thread 会话复用**：同 thread 复用同一 session、异 thread 各自新建（测试以 `ctx.agents.list().length` 断言）；
5. ✅ **双渠道验证**：Telegram（轮询）+ 飞书（webhook）两适配器挂同一契约，核心无渠道特判（`channel-telegram`/`channel-feishu` 契约测试覆盖）；
6. ✅ **全量 typecheck 绿**：构建链三处注册（tsconfig.base paths、tsconfig.host references、tsdown exclude 移出）。
