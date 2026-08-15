# Agent Note：由锁定的 OpenClaw Gateway 拥有渠道平面

Status: implemented

[English](2026-08-15-openclaw-channel-plane-bridge.md) | 中文

## 问题

首个 ClawDSH 渠道 seam 完成了有价值的架构验证，但选择了错误的复用边界。其进程内 `ChannelAdapter` 把平台缩减为文本 receive/send，因此每新增一个传输，ClawDSH 仍需拥有 SDK、凭证、webhook 或轮询生命周期、身份模型、准入策略、丰富动作、附件、重试与平台漂移。OpenClaw 当前生产目录已有 27 种聊天传输。重复这些工作会把一个难维护的上游生态替换成数十个不完整的本地 fork。

相反的捷径同样不安全：在 dsh 旁启动任意 OpenClaw checkout，会让运行时身份、模型 fallback、消息 replay 与投递歧义保持隐含。通信软件接收不可信网络输入并能触发工具，因此“进程已启动”不是可接受的准入条件。

## 决定

ClawDSH 现在通过严格认证的 V1 协议分离通信平面与 Agent 平面。受监督且不可变的 OpenClaw Gateway 继续负责平台插件、凭证、入口、配对与 allowlist、身份规范化、原生动作、媒体暂存和投递。dsh 继续负责 Session、Agent、工具、模型选择、attachment store 和可重建的模型输入。Gateway 配置 ClawDSH AgentHarness 为唯一 provider 与 model path；fallback 到 OpenClaw model 属于无效配置。

三个包表达 seam 角色。`@clawdsh/dsh-channel` 是 Service Definition 与严格 wire vocabulary，包含一个 Provider 和一个 Driver。`@clawdsh/dsh-channel-openclaw` 是 Provider：校验 host lock、认证一个私有 IPC peer、强制 handshake、报告健康、转发 action，并拥有 delivery ledger。`@clawdsh/dsh-channel-agent` 是 Consumer/Driver：把完整 OpenClaw 路由身份绑定到 dsh Session，持久化 generation 与幂等，导入已验证媒体，驱动 Agent，注册路由限定的 `message` 工具，并把完整、已净化的 provenance 存在已知 `user/message` source 上。

Production 只接受 OpenClaw `v2026.7.1-2`、commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`，并同时锁定 NPM artifact、解包宿主文件树、已检查的 NPM 依赖 lock 与完整安装运行时字节。安装运行时摘要按 platform 和 architecture 区分；首个获批 assembly 是 Darwin arm64，其他组合会 fail closed，直到具备各自已评审的 lock。Canary 只接受 source commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0` 用于隔离审计与兼容工作；它没有锁定的构建 host，不能使用 managed execution。稳定目录是 1 个 core + 2 个 bundled + 21 个 repo-official + 3 个 external，即 **24+3**。QQ Bot 在该 lock 中是 repo-official；external 条目是 WeChat、Yuanbao 与 Zalo ClawBot。各轨道治理目录把每个 external 条目绑定到相同的精确包，并分别记录许可证声明、平台条款审查和安全审查；全部审查仍待完成，因此会阻止可安装性晋级。

一个 opt-in 外部插件对应一个隔离 NPM 项目，而不是一个主 package。其 lock 覆盖项目 manifest、可见与隐藏 NPM lock、主插件、每个传递依赖文件和内部文件链接目标。可选的嵌套 `openclaw` peer 只能指向单独校验过的宿主；项目摘要仍包含该链接的存在性，而目标字节由宿主运行时 lock 负责。空 extension 列表保持为默认值，并拒绝每个未跟踪项目。

## 协议与所有权

handshake 绑定 protocol version、Gateway state lineage、逐次启动 nonce、精确 tag、commit、artifact SHA-512、Node engine、AgentHarness generation、action、notification 与 extension。任一不匹配都会关闭 peer。POSIX endpoint ownership 通过私有 `0700` parent、`0600` socket 与 ephemeral token 强制。Windows 在 native named-pipe ACL seam 能提供同等授权前 fail closed。每个 Node 预检和 Gateway 还会收到用于删除继承 `NODE_*`、native-loader、OpenSSL 模块与配置、TLS 信任路径和 TLS 密钥日志变量的条目，使 ambient 进程设置无法替换 loader 或削弱已校验执行环境。

入站操作是 `turn.run`、精确 `turn.cancel` 和 generation-aware `session.reset` / `session.close`。Provider 可查询 `health.get`；bridge 可协商 `turn.progress` 与 `delivery.report`。Agent 发起的 `channel.action` 覆盖消息、回应、投票、输入状态、目录与解析操作，但 capability negotiation 可缩窄集合，平台对支持情况保持权威。

持久性区分重复传输与重复 Agent 执行。相同幂等请求会附着到 live run 或 replay terminal record。用不同内容复用 key 会失败。崩溃遗留的 running record 变成 `needs-recovery`，因为工具可能已产生副作用，自动重跑不安全。Reset 和 close 会先写入持久 bridge transition，再请求 DSH、commit 已确认 route 与 previous-Session control identity，最后删除 transition；启动和下一次 turn 会恢复任何中断的 transition。Delivery receipt 同样持久且单调；`ambiguous` 是 operator/provider 对账状态，绝不是隐式重发许可。

模型执行前，Driver 把 admission 与 idempotency commit 到持久 ledger。已知 `user/message` 包含完整、已净化的渠道 provenance。Owner 私聊可 mount owner preset；其他 sender 和 group 都 mount restricted preset，且 group 必须已经携带 OpenClaw group-allowlist admission。

## Session 日志

原实现声明了 `channel/turn-admitted` 与 `channel/delivery` Session event，但 dsh 无法让 out-of-tree plugin 安全持久化它们。`Session.append()` 没有设置 `ignorable: true` 的 surface，而 resume 只接受上游生成的 static `KNOWN_SESSION_EVENT_TYPES`。写入任一 downstream name 都会使后续 reader fail closed，即使 TypeScript declaration merging 在编译时接受该 payload。

因此，已实现的安全降级不会 append 两个 name。模型重建使用既有 `user/message` envelope 及其可 declaration merge 的 `source.kind = 'channel'`；admission、idempotency 与 delivery state 在 channel-agent 和 Provider 持久 ledger 中保持权威。Delivery metadata 不是模型输入。Namespaced Session event 保持 deferred，直到 dsh 提供 ignorable append option 或另一个 composition-independent downstream event registration seam；`docs/upstream-proposal/session-plugin-events.zh.md` 记录所需 surface。

## 媒体与动作限制

入站图片只有经过 canonical-root 约束、逐层 symlink 拒绝、size 检查、media-type 检查与 SHA-256 校验后才能跨越 staging 边界，并成为 dsh image attachment。音频、视频与通用文件保持拒绝，因为 dsh 没有持久非图片 attachment seam。出站媒体也保持拒绝，因为尚无 dsh staging writer。这些失败是明确的，不会静默退化成纯文本。

路由限定的模型工具暴露发送、编辑、删除、回应、投票、输入状态、目录查询与目标解析。每次调用仍必须通过已连接 Gateway 协商的 action list；锁定 bridge 当前只宣传 send 与 poll。某动作仅在协议中合法或被另一个渠道实现，都不等于当前调用成功。

## 支持与替换

支持只按 `cataloged → installable → certified → enabled` 推进。Cataloged 记录来源；installable 证明精确锁定装配以及逐 Channel 配置、capability probe 与无密钥 contract 证据；certified 还证明当前发布的装配、安全与投递行为、无密钥装配 transcript 和所需真实平台流量；enabled 是明确激活的交付 profile 决策。实现基础不会跳过这些门禁。

当前 sidecar 没有任何单独 Channel 达到 installable、certified 或 enabled。Production profile 已用 default-disabled group 包含完整新 seam，也不再启动 legacy adapter；但上游 snapshot runner 不发现自有渠道包，本次变更也没有新的 Telegram 或 Feishu live smoke。稳定版 V1 不能投影安全 staging 的入站媒体；锁定 host 既没有关联最终回答的 delivery hook，也没有聚合账号 health；external 审查仍待完成；persistence 与 resume evidence 还必须证明上述 known-event degradation。在自有 snapshot path 和等价 live smoke 通过前，旧包以不冲突的 Service namespace 另行保留；它们的历史测试不能认证新 host 或执行路径。

## 曾考虑的替代方案

- **继续增加原生进程内适配器**：拒绝，因为 ClawDSH 将拥有每个平台接入，并持续落后于上游行为与修复。
- **把 OpenClaw 渠道源码移进 ClawDSH 包**：拒绝，因为内部 import 与 Gateway lifecycle 假设会让复制源码成为 fork，而不是代码复用。
- **把 OpenClaw 嵌进 dsh 进程**：拒绝，因为依赖、故障与凭证所有权会和 Agent runtime 混合，也让精确 host 替换更困难。
- **跟踪浮动 OpenClaw 分支**：拒绝，因为它不能提供可复现 artifact、可审查 delta 或持久认证证据。
- **用可选 pre-Agent hook 交接**：拒绝，因为 hook 缺失或未处理时可能 fail open；唯一配置的 AgentHarness 是更强的执行控制点。

## 影响

迁移单元现在是经审计的 Gateway release 与 catalog，而不是渠道实现。这让 ClawDSH 无需容纳平台 SDK 就能触达当前 OpenClaw 生态覆盖面，也为 dsh 提供了可超越特定 Gateway release 的窄 Service Definition。代价是一个真实部署子系统：不可变 artifact、受监督 child、私有 IPC、持久对账、track-specific compatibility、逐渠道 live certification、明确的媒体与 Windows 后续工作，以及在持久化冗余 namespaced channel event 前需要的上游 Session append seam。ADR-0008 拥有架构，bridge feature spec 拥有当前行为与缺口，channel sync standard 拥有未来 lock promotion。
