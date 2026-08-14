# 功能规格：渠道网关 seam（channel-core）

[English](feature-channel-core.md) | 中文

- **状态**：implemented（阶段 2 ✅，2026-08-14）
- **实现包**：`packages/openclaw/channel-core`（`@clawdsh/dsh-channel-core`）
- **OpenClaw 对应**：渠道网关（`src/gateway/`，基线 v2026.1.5）。OpenClaw 的每个渠道直接长进网关与 agent 逻辑，是"架构无接缝"的典型病灶；本规格把网关拆成「薄装配层 + 渠道适配器」两层。

## 目标

- 提供 `ctx.channels` 服务——本项目**唯一新增 seam**（设计见 docs/adr/0002-channel-seam.md）：
  - **适配器注册表**：渠道插件注册一个 `ChannelAdapter`，按 id 唯一，注销即回卷（HMR 安全）；
  - **入站路由**：可等待的 parallel `channel/inbound` 消息 → 解析会话/topic → 恢复/创建持久 Harness agent session → 写入 session log → 驱动并 flush 一个 FIFO turn；成功或失败都会返回 adapter；
  - **出站投递**：agent 回复 → `channel/outbound` + 对应 `adapter.send`。
- 渠道插件实现 `receive`、`send` 和可选 `react`；路由、确定性 session 绑定、preset 组合、turn 串行、群聊策略与空闲生命周期归 `channel-core`。
- 契约继承 dsh 不变式：一切入站消息与出站回复必须写进 session log（"model-visible means logged"）。

## 非目标

- 经 `ctx.attachments` 传输二进制附件，以及交互卡片/action 事件；
- 跨进程/多 daemon ownership 与多 sender batching；单进程已对首次创建 single-flight，并按会话/topic 串行；
- adapter/SDK 重试耗尽后的持久 provider outbox；
- 渠道特性（引用、卡片模型）的统一抽象——不预设，等第二个渠道特征沉淀后再提炼。

## 接缝（阶段 2 已确认）

`ctx.channels`（`ChannelRegistry extends Service`，`super(ctx, 'channels')`）：

- `static inject = ['agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'sessionPersistence', 'timer']`；
- `registerAdapter(adapter)`：id 唯一校验 → `ctx.effect` 内 `adapter.start(ctx)` + 存 map，返回可异步排空的 disposer；
- `getAdapter(id)` / `listAdapters()`；
- 私有 `route(message)`：结构化群聊 mention 门控 → 从 channel/conversation/topic 生成确定性不透明 id → `sessionPersistence` inspect + `agents.resume/create` → `agentPresets.mount` → FIFO `followup`/`whenIdle`/`sessions.flush` → 携带原生引用元数据的 `adapter.send` + `ctx.emit('channel/outbound', outMsg)`；失败返回调用者，内部已吸收的队列 tail 让后续回合继续；
- 地址归一化：`conversationId` + 可选 `threadId`；legacy thread-only 输入视为一个 conversation，并在出站回填其 thread id；
- 事件（declaration merging）：parallel `channel/inbound` 与仅 emit 的 `channel/outbound`。adapter 等待 `ctx.parallel`；旧 `ctx.emit` producer 仍可使用，但没有完成背压。

**结论：接缝假设成立**——渠道接入 = 一个 `ChannelAdapter` 实现，不改上游一行源码、不动 `agent-loop`。

## 配置面

提供 `agentPreset`、`groupMode`、`ackReactionScope`、`idleTimeoutMs` 与纯呈现的 identity/prefix/reaction 配置；provider 凭证仍归各 adapter Config。

## 验收标准（阶段 2 结论）

1. ✅ **注册/注销（HMR 回卷）**：`registerAdapter` 后 `listAdapters` 含之、dispose 后移除（测试覆盖）；
2. ✅ **重复 id fail-loud**：注册同名适配器抛错（测试覆盖）；
3. ✅ **入站 → 出站回投闭环**：MockAdapter + 七件套 harness 验证「入站 → 真 agent turn → 回复出」+ `channel/outbound` 收到 + 回复文本非空（测试覆盖，无 key）；
4. ✅ **持久复用**：稳定不透明 id、首条 single-flight、FIFO turn、JSONL 进程式重启恢复与日志记录 preset 复用均有测试；
5. ✅ **可等待持久化 + 兼容**：adapter handler 会等待路由回合经过 `sessions.flush`/投递，失败向上传播，正常 teardown 排空已准入工作；旧 thread-only source 形态仍可接入，同时不混淆新 conversation/topic 地址；
6. ✅ **策略/呈现**：结构化群聊 mention fail-closed 与全部 ack scope 均有测试；
7. ✅ **双渠道验证**：Telegram 轮询覆盖定向 bot command、官方有界 API 重试、UTF-16-safe 4096 分片及 middleware 排空；官方飞书 SDK 1.73 `LarkChannel` 覆盖身份退避、topic-safe 3500 分片及失败握手清理，核心无 provider 分支；
8. ✅ **构建/发布链**：独立 aggregate types/bundle、测试类型检查、profile 安装冒烟、独立共享版本 `clawdsh` release family、packed-install 验证与受保护 workflow 均已完成。实际 npm 发布仍是有意的手动操作，当前工作树尚未执行。
