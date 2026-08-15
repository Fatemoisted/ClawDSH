# @clawdsh/dsh-channel

[English](README.md) | 中文

`@clawdsh/dsh-channel` 是 ClawDSH 通信能力的 Service Definition。它在 `ctx.channels` 后维护一个通信平面 provider 和一个 Agent 平面 driver，并定义与 OpenClaw Gateway 交换的版本化数据。平台凭据、协议客户端、Agent 执行、Session 持久化和投递 ledger 均不归本包所有。

## 服务 API

| 成员 | 契约 |
|---|---|
| `registerProvider(provider)` | 占用唯一通信平面槽位。空 id 或第二个 provider 在发布前失败。返回的 disposer 随 Cordis fiber 释放槽位。 |
| `registerDriver(driver)` | 占用唯一 Agent 平面槽位。第二个 driver 在发布前失败。返回的 disposer 随 Cordis fiber 释放槽位。 |
| `runTurn(turn, execution)` | 把已验证的入站 envelope 交给 driver。`execution.signal` 属于 run 生命周期；短暂 IPC 断开不得据此中止 run。可选进度通过 `execution.notify` 发布。 |
| `cancel`、`reset`、`close` | 把显式 turn 和 Session 控制转发给 driver，并原样传递 `AbortSignal`。 |
| `reportDelivery(report)` | 把 provider 已持久提交的最终 turn 回执投影给实现了协商后 `delivery.report` 扩展的 driver。provider ledger 的持久化先于此调用。 |
| `action(action, signal?)` | 把一种判别明确的原生操作交给 provider，并返回投递回执、已脱敏目录条目或目标解析结果。 |
| `health(signal?)` | 返回已脱敏的 provider、Gateway 和逐账号状态。 |

角色缺失、重复注册、非法 provider id 和不支持的投递回执投影会抛出带稳定 code 的 `ChannelError`。Provider 和 driver 自身的失败原样传播。

## 协议

每个基础 payload 都携带 `protocolVersion: 1`。`CHANNEL_BRIDGE_METHODS_V1` 命名六个 request：`turn.run`、`turn.cancel`、`session.reset`、`session.close`、`channel.action` 和 `health.get`。`CHANNEL_BRIDGE_NOTIFICATIONS_V1` 命名不带 id 的 `turn.progress` notification 以及可选 `delivery.report` 扩展；未协商对应能力时，对端不得发送二者。

`protocol.ts` 为握手、入站与终态 turn、控制请求、出站和查询 action、action 结果、投递回执、进度通知、健康状态及投递报告导出严格 zod 校验器。`ChannelBridgeRequestMapV1` 与 `ChannelBridgeNotificationMapV1` 提供对应的编译期方法映射。校验器拒绝未知对象字段，以及每个外部不透明 id、展示值和文本字段中的 NUL。群组 route 必须使用 `group-allowlisted` trust，direct route 则拒绝该 trust class。外部不透明 id 在校验后才添加 brand。暂存媒体携带相对路径、精确字节数、规范小写 SHA-256、媒体类型和连续 ordinal；provider 在发布前仍必须验证实际打开的字节及 staging root 包含关系。

Sender trust 只记录 host 实际暴露的最强准入事实。`admitted` 表示 host 已证明私聊通过准入，但没有暴露由 pairing 还是 allowlist 作出决定；consumer 对它的权限不得高于 restricted preset。

握手标识 Gateway lineage、锁定的 OpenClaw tag 与 commit、制品 SHA-512、Node engine、AgentHarness 代际、支持的 action 与 notification、可选 extension 和启动 nonce。握手本身不认证对端；provider 负责本地 IPC 认证，并把这些字段与部署 lock 比较。

`ChannelActionV1` 是由 `send`、`edit`、`delete`、`react`、`poll`、`typing`、四种 OpenClaw 目录操作和目标解析组成的封闭 union。目录结果省略 provider 的 `raw` 数据和头像 URL；解析结果中的平台 id 只有通过校验后才会添加 brand。Provider 执行前检查所选账号的实时能力；不支持的操作必须失败，不能报告成功。`ChannelDeliveryReceiptV1` 区分 accepted、confirmed、retrying、ambiguous 和 dead-letter。ambiguous 回执不得授权盲目重发。

## 扩展点

Provider 注册 `ChannelProviderV1`；预期实现是 OpenClaw sidecar provider。Consumer 注册 `ChannelDriverV1`；Agent consumer 负责 DSH Session 映射、preset、模型执行、模型可见日志和可选的投递回执投影。生产与 canary 使用不同 context，因此各自仍然只有一个 provider 和一个 driver。

## Model Experience

### Channel Service Definition

#### What the model sees

模型不会直接看到 `ctx.channels` 的内容。Consumer 可以把准入消息变成模型输入，或把 Channel action 暴露成工具；其精确文本、schema、权限和 Session Event 均由 consumer 所有。

#### Token effect

直接 token 增量为零。本包不贡献 system prompt、user message、tool schema 或 model request。

#### KV Cache effect

不会直接使缓存失效。Provider 注册、健康检查、wire 校验和投递回执均不改变 model request prefix。

## Known Limitations and Deferred Work

- **仅限聊天与目录 action**：语音通话和会议流需要各自的生命周期类型；本包不会把它们伪装成聊天 action。
- **协商后的投递投影仍是可选能力**：provider 始终拥有权威 delivery ledger。driver 未实现 `reportDelivery` 时会得到 `CHANNEL_DELIVERY_REPORT_UNSUPPORTED`；该 assembly 不得声明支持此扩展。
- **数据校验不等于传输安全**：帧大小限制、Unix socket 权限、Windows named-pipe ACL、临时认证、制品校验和暂存文件打开均归 provider 所有。
