# 提案：通过 OpenClaw AgentHarness 暴露完整渠道回合事实

[English](openclaw-agent-harness-channel-seams.md) | 中文

- **状态**：提议中；OpenClaw 与 ClawDSH 均未实现
- **期望 owner**：OpenClaw Gateway 与 AgentHarness 维护者
- **驱动 consumer**：把 OpenClaw 复用为通信平面的外部 AgentHarness

## 动机

OpenClaw 已拥有渠道认证、准入、规范化身份、媒体暂存、原生动作、账号生命周期和最终平台投递。只有 host 通过一个版本化、渠道无关的 surface 导出相应事实，外部 AgentHarness 才能复用这份所有权。锁定生产版的 AgentHarness V1 能把文本回合交给外部 Agent，但其 public surface 不提供可信的已物化入站媒体事实、与 harness invocation 关联的最终投递更新、聚合账号健康状态或稳定的原生动作 dispatcher。直接访问各渠道 plugin 会重新引入 AgentHarness 本应消除的耦合。

这些缺口让文本生成成功可观测，却无法证明平台投递成功。它们也让 consumer 无法安全导入媒体、在崩溃后对账状态不明的发送，或报告哪些配置账号真实在线。因此，ClawDSH 对这些能力保持 fail-closed，且不会仅凭 bridge protocol 支持就认证任何渠道。

## 提议的 host 契约

通过 AgentHarness 或相邻 public Gateway service 暴露以下能力。精确 TypeScript 名称可以遵循 OpenClaw 当前约定，但以下所有字段与生命周期义务必须保持渠道无关。

### 入站回合投影

每个已准入 harness request 携带：

- 稳定的入站幂等键，以及规范 channel、account、conversation、thread、sender、reply、group 与 mention 标识；
- OpenClaw 生成的 admission classification，不包含凭据或原始鉴权材料；
- 有序媒体 descriptor，其路径相对于明确配置的 staging root，并包含字节数、观测 media type、digest 与生命周期；
- 在 Agent 执行和所有后续投递尝试中保留的 correlation id。

该投影只在 OpenClaw 准入成功后生成。Plugin 可以省略不支持的事实，但不得合成权威值。

### 最终投递生命周期

为每个最终 AgentHarness result 与原生 outbound action 提供有序 event 或 callback。每次更新包含 correlation id、幂等 attempt id、channel/account destination、action kind、已知时的平台 message id，以及一个终态：`delivered`、`failed`、`ambiguous` 或 `dead-letter`。

平台可能已接受请求但没有权威回执时，host 必须发送 `ambiguous`。不能仅因 Agent 生成了文本就报告成功；重放已完成 harness result 时必须复用或对账既有投递尝试，不能静默发起无关的新发送。

### 账号健康快照

为每个已配置渠道账号提供已净化的聚合快照与变更通知。最小字段为稳定 channel/account id、configured/enabled 状态、连接状态、最近转换时间、重连状态，以及可安全暴露到凭据进程之外的诊断码。读取健康状态不得初始化、登录或修改账号。

### 原生动作能力与分发

为 `send`、`edit`、`delete`、`react`、`poll`、`typing`、目录查询与身份解析提供稳定的 capability query 和 dispatcher。Capability result 作用于精确 channel/account/conversation，并区分不支持、暂不可用和禁止。Dispatch 接受幂等键，并返回与最终回复相同的关联投递生命周期。

### Fail-closed Agent 所有权

路由选中外部 AgentHarness 后，其 `completed`、`silent`、`cancelled` 或 `failed` 终态具有权威性。失败、超时、畸形输出或断连绝不能 fall through 到 OpenClaw model provider。Host 应在 diagnostics 中暴露所选 harness identity，使 supervisor 能在接受流量前验证排他路由。

## 安全与兼容性

- Media descriptor 是指向已准入暂存字节的 capability，不是任意文件系统路径或远程 URL。
- Health 与 delivery surface 排除 token、cookie、webhook secret、本地绝对路径和原始平台鉴权证据。
- Correlation 与 idempotency identifier 是 opaque 的，并在 host 声明的保留期内跨进程重启保持稳定。
- Capability negotiation 允许旧 host 省略完整能力。部分实现不得宣告该能力。
- AgentHarness V1 可以接受 additive backport。AgentHarness V2 可以使用不同 TypeScript type，但必须保持相同的跨进程语义。

## 验收标准

1. 一个 fake channel 和一个代表性真实渠道通过 public harness surface 演练已准入文本与媒体，不导入渠道内部 module。
2. 测试覆盖投递成功、永久失败、回执丢失、重启后重放，以及平台接受状态不明且不自动重复发送。
3. 多账号使用相同 conversation id 时，入站投影、健康状态、动作分发和投递更新仍保持隔离。
4. 不支持的原生动作在平台 dispatch 前失败，且绝不表示为成功。
5. 断开或破坏所选外部 harness 时，证明不会发生 OpenClaw model request。
6. Public API 与 type test 同时覆盖维护中的 V1 release line 和 V2 canary line。

## ClawDSH 过渡策略

ClawDSH 不会用逐渠道代码绕过这些缺口。如果 release-critical path 在上游发布前必须修改 host，临时补丁必须针对一个精确 OpenClaw commit、携带校验和、只实现缺失 public seam，并在采用已发布契约时删除。最终投递、聚合账号健康、稳定入站媒体与原生动作认证保持阻塞，直到相应 public host capability 通过 contract 与 live test。
