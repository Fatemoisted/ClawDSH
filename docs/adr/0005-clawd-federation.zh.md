# ADR-0005: clawd 联邦（`clawd-federation` transport provider）—— ClawDSH 原生多节点委托

[English](0005-clawd-federation.md) | 中文

- **状态**：已接受（2026-08-14）
- **日期**：2026-08-14
- **依赖**：ADR-0001（构建链豁免）、ADR-0002（自有接缝先例）

## Context

「clawd」即 ClawDSH 个人助手：一个常驻 daemon，把 OpenClaw 功能集跑在 dsh 的 Cordis 底盘上。**联邦**是让一个 clawd 实例（节点）能够通过一条线路把一轮委托给另一个节点、并在委托前发现与授权该对等方的能力——也就是 OpenClaw「gateway + node bridge」那套让多个助手分担工作的能力（家庭节点把长任务交给工作站节点、个人节点调用共享节点的某个能力）。发起人已确认本 ADR 必须说明「联邦是什么/为什么 ClawDSH 需要它」，因为这是新的产品概念，而非移植。

深读与两个 tag 验证（`v2026.1.15`、`v2025.9.13`）确认**没有可移植的 OpenClaw 出处**：上游 gateway/node-bridge 与 OpenClaw 自己的消息网关和 IM 事件循环纠缠在一起，不存在可分离的「联邦」包。因此联邦是 ClawDSH 原生设计。其设计模板是 OpenClaw 的 node bridge（`hello` + `caps`、`pair`/`approve`/`verify` 5 分钟配对 TTL、带 `idempotencyKey` 的 `invoke`）及其 gateway 协议（版本化 `connect`/`hello-ok` 握手 + 能力 `snapshot` 交换）——代码不可移植，但协议的*形状*可移植。

dsh 已经提供了联邦传输所需的部件：

- **subagent 接缝** —— `ctx.subagents.registerProvider(provider: SubagentProvider)`（`packages/subagent/subagent/src/index.ts`）注册一个具名、effect 作用域、HMR 安全的 provider；
- **进程外结算词汇** —— `NO_START_CAPABILITIES`、`settleRunResult`、`subprocessRunHandle`（`packages/subagent/subagent/src/out-of-process.ts`）——接缝契约：远程 run 的 `result` 永不 reject，并摊平成 stop reason；
- **stdio JSON-RPC 模板** —— `@deepseek-ai/dsh-subagent-dsh-sdk`（`packages/subagent/subagent-dsh-sdk/`）——已经通过 `@deepseek-ai/dsh-sdk-client` 以 stdio JSON-RPC 驱动一个完整的子 DeepSeek Harness 运行时。

本 ADR **仅评估**：发起人决定本批**不做 spike 包**。ADR 记录设计与已发现的缺口；实现保持延后。

## Decision

1. **联邦 = 一个 `'clawd-federation'` subagent transport provider。** 节点被建模为注册在既有 subagent 接缝上的 `SubagentProvider`，而非新的顶层服务。委托给对等方复用 `ctx.subagents` 的 start/run/dispose；provider 拥有线路驱动。
2. **节点注册 + 配对。** 对等方按地址（stdio 命令/URI）注册，并通过仿 OpenClaw node bridge 的配对交换（`pair`/`approve`/`verify`，5 分钟 TTL）授权，使未配对的节点永不可被 invoke。
3. **能力交换 = `SubagentCapabilities`。** `hello`/`caps` 握手映射到既有能力形状（`outputSchema`/`depthLimit`/`toolFilter`/`persona`）；远程节点宣告 `NO_START_CAPABILITIES`——进程外子进程无法兑现父方强制的 start 特性，接缝已在 `start` 前拒绝这些请求。
4. **线路 = 版本化 JSON-RPC，stdio 优先。** 传输复用 `subagent-dsh-sdk` 模板（版本化 `connect`/`hello-ok` 握手、能力 snapshot 交换）；远程节点是独立二进制，故 stdio 是零依赖默认，线路版本化为后续 TCP/WS 升级留口。
5. **`invoke` 幂等。** 每次 invoke 携带 `idempotencyKey`（OpenClaw node-bridge 模式），使传输重试永不重复执行一轮。
6. **结算复用接缝契约。** provider 经 `subprocessRunHandle` 发布、经 `settleRunResult` 结算，故 `result` 永不 reject，对等方失败成为 `stopReason: 'error'` / `'aborted'`，与任何其他进程外后端一致。

## Deferred implementation 与已发现缺口

本 ADR 写下方案与侦察期发现的一个缺口；本批不落任何代码。

- **`list_agents` 发现缺口。** `list_agents`（`packages/subagent/tool-subagent-control/src/list-agents.ts`）读取 `ctx.subagents.listChildren(parent.id)`——session 背书的 continuable 投影——并过滤到 `entry.mode === 'continuable'`（第 77 行）。远程联邦节点不是 session 子节点，故永不出现在发现结果里，模型无法将其命名为委托目标。**已记录扩展方案**：要么拓宽 registry 视野（让投影浮现已注册的远程节点条目），要么新增联邦专用发现工具；两者都在实现联邦时评估，而非现在。
- **安全加固、重连、背压。** 配对 TTL 之外的对等方授权（密钥轮换、吊销）、对等方重启后的重连、每次 invoke 的背压，都随实现一起延后。

## Consequences

- ✅ clawd 获得原生联邦设计，复用 subagent 接缝（无新顶层服务）与 stdio 模板，未来实现是「provider + 线路驱动」而非新接缝；
- ✅ 保留 OpenClaw 协议*形状*（node bridge + gateway），同时有意不移植纠缠的上游代码；
- ⚠️ 这是仅评估 ADR——尚无 spike 包与契约代码；设计的正确性依赖上述侦察，而非可运行的样机；
- ⚠️ `list_agents` 发现缺口真实存在，必须在联邦从模型视角可用前解决；本批记录而非修复；
- ⚠️ 未来联邦传输会重新引入网络面（配对、线路信任、重连），stdio 优先默认在之前将其保持最小。

## Alternatives

- **gateway-WS-first（spike 期否决）**：WebSocket 优先传输会在单节点 stdio 路径被证明之前，直接跳到网络面；stdio 优先默认推迟该风险。
- **本批扩展 `list_agents`（否决）**：该缺口只有联邦存在后才可达；现在拓宽 session 背书的投影，会为一个尚不存在的消费者加一个无主的改动。
- **移植 OpenClaw 设备联邦（否决——无物可移）**：两个 tag 验证发现 gateway/node-bridge 与 OpenClaw 的 IM 事件循环纠缠，并非可分离包；协议形状是唯一可移植产物，且已在此捕获。
