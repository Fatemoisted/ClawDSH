# OpenClaw AgentHarness bridge

[English](README.md) | 中文

本目录是唯一会加载进锁定 OpenClaw Gateway 的代码。它让平台凭据、准入策略、协议客户端和最终投递留在 OpenClaw 内，并通过已认证的本地 NDJSON JSON-RPC 把获准的 Agent turn 转发给 ClawDSH。

## 入口

- `stable-v1/index.js` 是适配 OpenClaw `v2026.7.1-2`（`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`）的已构建 JavaScript。
- `canary-v2/index.ts` 适配审计快照 `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0` 的 AgentHarness V2 API。
- `canary-v2/provider-policy-api.js` 是由宿主加载的 provider route policy。OpenClaw 只会从经宿主校验的官方外部安装中加载这份公共制品；普通的不可信安装会在 harness 运行前因 route 选择失败而终止。

注册和插件检查保持惰性：两个入口都不会在注册时读取 supervisor 环境、打开 socket、打开状态或读取 staging root。它们各自注册一个 OpenClaw 后台 service；service 只会在真实 Gateway 中运行，并且只有在已认证握手与持久 route-transition 恢复全部完成后才报告 ready。后续 Agent turn、健康查询和出站 action 会复用这条连接。握手或恢复失败时 ClawDSH supervisor 不会进入 ready，也不会转而调用 OpenClaw 模型。

OpenClaw 可能通过不同插件 registry 实例创建启动 service 与进程级 AgentHarness。因此两个适配器会租用一条进程共享 transport，并以 AgentHarness 代际及完整不可变 bridge 环境、握手和 bridge 配置的摘要作为身份。身份不匹配的实例会在打开第二条 socket 前使 service 启动失败。最后一个匹配租约会关闭并排空该 transport；后续首个租约会创建全新的 bridge 与连接，因此 Gateway service 重启不会复用已释放状态。

## IPC

首个 UTF-8 NDJSON frame 是认证握手，后续每个 frame 都是严格的 JSON-RPC 2.0。客户端限制 frame 字节数和并发调用数，以背压方式串行写入，在接受 RPC 前校验握手确认，并且只会在连接完全断开后重连。关闭连接会拒绝新调用、中止每个已准入入站 handler 的 signal，并等待这些 handler 全部结束后才完成 bridge dispose。启动 token 只出现在首帧。

必需环境变量：

- `CLAWDSH_CHANNEL_ENDPOINT`
- `CLAWDSH_CHANNEL_TOKEN`
- `CLAWDSH_CHANNEL_STARTUP_NONCE`
- `CLAWDSH_CHANNEL_GATEWAY_INSTANCE_ID`
- `CLAWDSH_CHANNEL_STAGING_ROOT`
- `CLAWDSH_CHANNEL_MAX_FRAME_BYTES`
- `CLAWDSH_CHANNEL_MAX_IN_FLIGHT`
- `CLAWDSH_CHANNEL_MAX_MEDIA_BYTES`
- `CLAWDSH_OPENCLAW_TAG`
- `CLAWDSH_OPENCLAW_COMMIT_SHA`
- `CLAWDSH_OPENCLAW_ARTIFACT_SHA512`
- `CLAWDSH_OPENCLAW_NODE_ENGINE`
- `CLAWDSH_OPENCLAW_AGENT_HARNESS`（`v1` 或 `v2`，必须匹配所选适配器）

插件配置提供 `controlTimeoutMs`、`routeStateMaxEntries` 和 `deliveryStateMaxEntries`。三者都必须是正整数，并在 manifest 中提供默认值。可信官方安装使用 OpenClaw 的 keyed state service。锁定的外部安装在稳定宿主中无法访问该 service，因此 bridge 会改用位于 OpenClaw state 目录下私有 `0700` 目录中的 crash-consistent `0600` 单键文件；其他任何 state-service 错误都不会触发静默降级。Reset 和 close 会先持久写入 route-transition intent，再请求 DSH、提交已确认的 route 变更，最后删除 intent。启动和下一次 turn 都必须先恢复未完成的 intent；OpenClaw 的前一 Session id 还会使完全相同的 reset hook 重试保持幂等。

## 已实现能力

Bridge 会发送 `turn.run`、`turn.cancel`、`session.reset` 和 `session.close`，处理 `channel.action`、内部只读的 `channel.reconcile` 和 `health.get`，并接收协商后的 `turn.progress` 通知。它声明的出站 action 只有 `send` 和 `poll`。每个 action 都通过 OpenClaw 公共 `api.runtime.config.current()` API 解析当前宿主配置，因此仅 Channel 的 hot reload 与凭据轮换不会继续使用 bridge 启动时的配置。Send 支持已校验的 staging media，多个 media 对象必须通过一次原子 `sendPayload` adapter 调用。每个 action 都会在派发到平台前持久 claim；重复的 running action 不会再次发送，派发后的不确定故障会返回 `ambiguous`。Reconciliation 只能回放完全匹配的已完成 ledger 记录；缺失、已变化或非终态的记录都会直接失败，不会触发派发。

稳定宿主的公共出站 adapter 方法不接受 `AbortSignal`。关闭 signal 可以在 adapter 派发前中止校验、授权与对账；平台 adapter 调用一旦开始，bridge shutdown 就会等待它结束，并把确认不明的结果记录为 `ambiguous`，而不会声称已取消或重新发送。

平台入站使用 OpenClaw 的稳定平台 message id 生成 DSH 幂等键。缺少平台 message id 的 Gateway `agent` request 使用带命名空间的稳定 OpenClaw run id；两种身份都不存在时会在 DSH 执行前失败。系统会在 `turn.run` 前校验完整生成的 envelope，包括拒绝 NUL、media 顺序以及 route/principal trust 一致性。

`edit`、`delete`、`react`、`typing`、全部 `directory.*` 操作和 `resolve` 在协议中合法，但会明确返回 JSON-RPC method-not-supported 错误。Bridge 不声明 `delivery.report`，因为两个锁定 track 的 OpenClaw 都没有暴露可关联最终投递的公共 hook。

稳定版 V1 AgentHarness 没有暴露可安全使用的已 materialize 入站媒体事实。遇到图像或媒体 turn 时它会拒绝，而不是丢弃媒体或信任不受限路径。V2 只接受配置 staging root 下的本地 materialized fact，并检查 realpath 包含关系、无符号链接、普通文件类型、字节数和 SHA-256；远程 URL 会被拒绝。

对于非 owner 私聊，稳定版 V1 只能证明 OpenClaw 已准入发送者，不能暴露 pairing 还是 allowlist 授权了该准入。Bridge 记录保守的 `admitted` class，而不虚构更具体的安全事实。Owner 私聊保留 `owner`；所有群组都投影为 `group-allowlisted`，包括 owner 发起的群组消息，因此 Agent consumer 始终为群组选择安全 preset。

合成 provider 只包含 `clawdsh/local`，把 `agentRuntime.id` 固定为 `clawdsh`，且没有 model fallback 列表。Harness 只接受该精确 provider、model 和 runtime。V2 还要求 route 没有 transport override，且 runtime policy 明确兼容 `clawdsh`；不支持的决策不会提供 OpenClaw fallback runtime。

OpenClaw 只收到最小 user/final-assistant transcript mirror。DSH 仍是模型历史的权威来源，任何 DSH transcript 都不会被复制回 OpenClaw。

Bridge 故障只使用一组固定的公开 code 与消息。任意本地异常、RPC 消息、路径和疑似凭据值都不会复制到 assistant 输出或 OpenClaw transcript mirror。

## 本地检查

```sh
node --test packages/openclaw/channel-openclaw/bridge/test/*.test.mjs
node packages/openclaw/channel-openclaw/bridge/verify.mjs
```
