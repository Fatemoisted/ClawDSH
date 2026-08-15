# OpenClaw 渠道平面同步规范

[English](openclaw-channel-sync.md) | 中文

本规范治理 ClawDSH 渠道平面使用的 OpenClaw host、渠道目录、bridge 兼容范围或支持声明的全部变更，并落实 [ADR-0008](../adr/0008-openclaw-channel-plane.md)、按 [ADR-0010](../adr/0010-harness-contract-first.md) 组合 Harness contract，同时把 [ADR-0011](../adr/0011-deferred-channel-images-and-address-continuity.md) 限定为仅 legacy 决策。它与 `upstream-sync.md` 分离：DeepSeek Harness 上游和内嵌的 OpenClaw 通信 host 有独立 lock 与审查周期。

## 权威来源

| 项目 | 机器可读权威 | 人类可读投影 |
|---|---|---|
| Production host | `tools/openclaw-channel-host/host.production.json` | ADR-0008 与 bridge 规格 |
| Production catalog | `tools/openclaw-channel-host/channels.production.json` | `docs/matrix/parity.zh.md` |
| Production support | `tools/openclaw-channel-host/support.production.json` | `docs/matrix/parity.zh.md` |
| Production external 治理 | `tools/openclaw-channel-host/governance.production.json` | host-lock README |
| Canary source | `tools/openclaw-channel-host/host.canary.json` | ADR-0008 与 bridge 规格 |
| Canary catalog | `tools/openclaw-channel-host/channels.canary.json` | 仅审计记录 |
| Canary support | `tools/openclaw-channel-host/support.canary.json` | 仅审计记录 |
| Canary external 治理 | `tools/openclaw-channel-host/governance.canary.json` | 仅审计记录 |
| Runtime admission | `packages/openclaw/channel-openclaw/src/locks.ts` 加 handshake 校验 | 软件包 README 与 bridge 规格 |
| Installer runtime 投影 | `packages/openclaw/channel-openclaw/runtime/production-lock.json`，并与 Provider lock 做相等性校验 | public bundle 与 CLI |

不要把摘要或渠道名单复制成另一个可执行事实源。Installer JSON 是经过校验的 Provider lock 发行投影，不是独立权威。文档可陈述批准的 tag、commit、聚合计数和有意义的差异，但精确 artifact 与逐渠道 metadata 属于这些 manifest。

## Track 策略

Production 使用 signed 或解引用的 release tag 与精确可运行 artifact。当前 lock 是 OpenClaw `v2026.7.1-2`、commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`、npm `openclaw@2026.7.1-2`，并校验 npm integrity，以及经审查的 Darwin arm64 与 Linux x64 installed-runtime 摘要。其目录有 27 项：1 个 core + 2 个 bundled + 21 个 repo-official + 3 个 external，简写为 **24+3**。

Canary 使用一个明确批准的 commit，绝不使用浮动 `main`。当前 commit 是 `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`。其 source archive 与 31 项目录只支持审查和兼容开发。Source archive 不是构建后的部署 artifact；在 build output 及其来源获得独立 lock 前，managed canary execution 保持不可用。

Production 与 canary 可使用不同 AgentHarness generation。Bridge build 必须声明其实现的 generation，认证 handshake 必须精确匹配所选 host lock。

## 更新流程

1. **解析候选，不修改 lock。**读取 OpenClaw release tag object、解引用 commit、已发布 npm metadata、Node engine、license 与 notices、plugin SDK compatibility 和当前渠道文档。把 canary 解析为一个 commit，并记录观察时间。
2. **获取不可变输入。**把 production npm tarball 与 canary source archive 下载到临时目录。manifest 要求时记录 byte length。绝不使用本地修改过的 checkout 作为 lock 输入。
3. **校验来源与内容。**检查 production package name/version 和 registry integrity；计算 archive SHA-512 和确定性 ordinary-file tree digest；verifier 要求普通文件时拒绝 symlink 与非文件项。对 canary 校验 source archive digest，并明确记录不存在 runnable tree。
4. **重新生成渠道目录与 external 治理。**从 OpenClaw 文档、bundled/core 注册、仓库扩展和明确记载的 external plugin 推导渠道身份。仓库内条目记录 source path 与 package manifest；外部条目记录精确 package name、version 和 registry integrity。每个 external 条目还要分别记录许可证声明，以及有证据支持的许可证、平台条款和安全审查结论。拒绝重复 id、未记载条目、计数漂移、不可校验外部包，以及渠道目录与治理记录之间不一致的 external 包身份。
5. **先分来源，再谈支持。**`core`、`bundled`、`repo-official` 与 `external` 只描述所有权，不是支持状态。尤其当前 production lock 中 QQ Bot 是 `repo-official`，WeChat、Yuanbao 与 Zalo ClawBot 是 external。必须保持稳定版 **24+3**，不得把 QQ Bot 重分类为 external。
6. **更新 bridge lock 与兼容性。**同步修改 runtime lock、bridge peer range、notices 与生成的 bridge artifact。验证 OpenClaw 仍提供所需 AgentHarness 注册、唯一 provider 配置、plugin load path、action surface、渠道生命周期与 delivery hook。兼容 shim 必须按 host track 隔离，并随该 track 退役而删除。
7. **运行静态与无密钥验证。**运行 host manifest verifier、package tests、protocol tests、persistence/resume tests、三个渠道包的 typecheck、license/notices 检查、fail-closed config 检查、精确 runtime plugin inspection，以及装配后的无密钥 Gateway-to-Agent smoke。在 upstream ignorable-append seam 存在前，resume 必须证明可运行路径只持久化已知 Session event name。缺少必需 lane 会阻止认证，不能成为放宽定义的理由。
8. **逐渠道运行带凭证认证。**每个候选渠道测试账号启动、已准入私聊、允许的群 mention、拒绝的 sender/group、文本和图片入站、Agent 结果、原生出站动作、重复入站、delivery retry/ambiguity、reset/close、重连与净化 health。渠道有更丰富动作时增加平台特定场景。记录 host commit、channel package integrity、OS、Node version、时间与脱敏证据。
9. **明确推进状态。**只有精确装配成功后才把 support catalog 从 cataloged 推到 installable；external 渠道还要求许可证、平台条款和安全审查全部通过。只有全部所需发布证据通过后才推到 certified；只有交付 profile 有意激活时才推到 enabled。用 `tools/openclaw-channel-host/generate-parity.ts --write` 重新生成四级 parity 投影；绝不从早期状态推断后期状态。
10. **原子审查与落地。**Host lock、catalog、bridge compatibility、notices、tests、ADR/spec 投影、parity matrix 和 Agent Note 更新在同一变更落地。Production 晋级必须审查 catalog delta 与每个新增 external dependency。

## Runtime fail-closed 要求

- 配置的 OpenClaw model mode 是 `replace`；`clawdsh` 是唯一 provider；`clawdsh/local` 是唯一 allowed 与 primary model；fallback 为空；每个 model entry 选择 ClawDSH AgentHarness。
- 已验证的 `clawdsh-bridge` path 在 `plugins.load.paths` 中恰好出现一次，存在于 `plugins.allow`，并明确 enabled。
- Gateway 使用 local mode 与 loopback bind。Supervisor 只把逐次启动 IPC credential 传入子进程，不把它们持久化到 OpenClaw config。
- Runtime plugin inspection 必须显示 bridge 已加载且已 import，包含预期 `text-inference` provider 与 `agent-harness` capability id，且无 error diagnostic。只有静态 manifest 不够。
- 第一帧 IPC 认证 peer 并提供完整 handshake。Tag、commit、artifact digest、Node engine、Gateway instance、startup nonce、AgentHarness generation、protocol version 或 capability 不匹配都会关闭连接。
- POSIX 要求私有 `0700` socket parent 与 `0600` Unix socket。Windows 在 named-pipe ACL enforcement 有 native 实现前不受支持；它 fail closed，不绑定更弱端点。
- 未知协议字段与未协商方法失败。瞬时 detach 不取消已接纳工作；显式 shutdown 在关闭 durable storage 前 abort 并 drain 工作。重连只对账匹配的持久终态结果，绝不切换模型或静默重跑 Agent 工具或平台动作。

## 支持状态证据

| 状态 | 最低证据 | 不证明什么 |
|---|---|---|
| Cataloged | 批准的 catalog entry、来源分类、精确 source 或 package identity | 可安装性、凭证、运行行为 |
| Installable | 兼容锁定 host、已解析精确 artifact/source、integrity 与 manifest 检查，以及已记录的配置说明、capability probe 和无密钥 Channel contract test | 平台访问或真实端到端行为 |
| Certified | Installable 加精确组合所需 contract、composition、security、snapshot、delivery 与当前 live transport 证据 | 某部署选择运行它 |
| Enabled | Certified 加明确激活的交付 profile entry 与已记录 operator config | 未列出的账号、模式或动作支持 |

Host commit、channel artifact integrity、bridge protocol、AgentHarness generation、安全配置、attachment 语义或相关平台 API 变化都会使证据过期。纯文档重命名不会使证据过期，除非它揭示了不同 artifact 或行为。

## 当前认证阻塞项

交付 profile 包含 canonical sidecar 组合及三个 invariant companion，Gateway 仍显式默认禁用。另一个 compatibility group 只注册 `ctx.legacyChannels`，也默认关闭；存在 legacy opt-in 时，canonical Gateway 启动与 Settings preflight 必须在产生副作用前失败。无密钥证据现已覆盖锁定 schema 下策略完整的 Telegram 与 Feishu 配置，以及装配后的 Gateway-to-Agent 路径，但仍没有完整的逐 Channel 配置/capability/delivery 证据或带凭证 live 证据；缺少 Windows endpoint authorization；稳定版 AgentHarness V1 不能提供安全 staging 的入站媒体；非图片 dsh attachment 与出站媒体仍不完整；锁定 host 既没有关联最终回答的 delivery report，也没有公开的聚合账号 health seam；downstream namespaced Session event 必须保持禁用；全部 external 治理审查仍待完成；本次变更没有新的、带凭证的 Telegram、飞书或 Discord sidecar smoke。这些是明确 blocker：production sidecar 的全部条目保持 `cataloged`，当前支持目录中没有任何 sidecar Channel 达到 installable、certified 或 enabled。

旧 `channel-telegram`、`channel-discord` 与 `channel-feishu` package 保留到 ADR-0008 替换条件通过。它们历史上带凭证的 Telegram 与飞书流量、Discord 无密钥覆盖，以及 ADR-0011 的媒体/地址测试，都不能复用为 sidecar 认证，因为 host、Service namespace、执行路径、准入 owner 与 delivery ledger 均不同。

## 回滚与事故

回滚选择前一个完整 production lock 及匹配 bridge build；绝不原地编辑一个 digest，也不混用旧 host 与新 catalog。保留 delivery ledger 与 Gateway state 以便对账。如果 receipt 是 ambiguous，停止自动重发，通过平台或 provider ledger 对账。如果来源、package ownership、credential 或 IPC authorization 可疑，在恢复流量前禁用受影响渠道或整个 sidecar。
