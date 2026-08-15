# ClawDSH 项目目的与实施计划

[English](roadmap.md) | 中文

> 本章程说明 ClawDSH 存在的原因与工作顺序。决策位于 `docs/adr/`，精确状态位于 `docs/matrix/parity.md`，运维规则位于 `docs/standards/`。

## 1. 目的

**ClawDSH 在 DeepSeek Harness 的 Cordis plugin 基础上重建 OpenClaw 的个人助手形态。** dsh 拥有 Agent 执行、Sessions、tools 与可组合 capability seam；ClawDSH 以独立 package 提供 persona、memory、skills、automation、产品展示与通信平面集成。

本项目避免把社区功能变成对单体 core 的修改。每项功能属于一个完整 capability seam 或建立在既有 seam 上，声明依赖，可逆挂载，记录每个模型可见输入，并让 specification 与 verification evidence 随实现维护。

## 2. 原则

1. **dsh upstream 保持只读。** 自有代码限于 `packages/openclaw/`、指定 docs、tools 与 ClawDSH workflow；root build registration 只是有 ADR 支撑的窄增量。
2. **只接受完整 seam。** 新能力包含 Service Definition、Service Provider 与 Consumer。缺少 dsh seam 时，需要 ADR 及自有实现或明确 proposal。
3. **在正确边界复用完整子系统。** 非渠道功能在足够时使用早期 OpenClaw reference。通信跟随另行批准的当前 OpenClaw lock，因为平台覆盖与安全行为位于该处。
4. **输入不可变，支持状态明确。** Floating ref 永远不是 deploy dependency。渠道支持只按 `cataloged → installable → certified → enabled` 推进。
5. **垂直证据。** Package test 证明局部行为，assembled snapshot 证明用户可见 composition，credentialed smoke 证明一个外部传输。三者不能互相替代。
6. **ClawDSH 是产品。** 本地 GUI 默认展示 ClawDSH，并把原生 Harness 保留为高级入口。切换 Agent preset 不会卸载 Host capability。
7. **不 patch 上游 GUI。** 产品壳消费公开 dsh Web 与 Host API，不增加 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、generated file 或上游 GUI source。
8. **不提前删除 legacy。** 只有等价 assembly、snapshot、live behavior 与 failure handling 通过后，替换项才删除旧路径。

## 3. 已完成基础

### 阶段 0 · 可行性 spike

`soul` plugin 证明自有 package 可以贡献或替换 system-prompt section，通过 Cordis lifecycle 回卷，并经 profile 组合且不修改上游 Agent code。

### 阶段 1 · 功能领域映射

项目选择 OpenClaw `v2026.1.5` 作为紧凑的非渠道 reference，并将 Sessions、tools、persona、memory、skills、automation、channels、federation 与 clients 分类为 reuse、plugin、new seam、product assembly 或 deferred。早期 tag 缺少选定领域时，仍可引用后续源码。

### 阶段 2 · 个人助手 vertical slice

`soul`、Memory 与 Embeddings package、内部 `preset-openclaw` 组装，以及旧 `channel-core` / Telegram / Feishu path 建立首个可运行个人助手 composition。旧 adapter path 证明 Session routing，但不建立当前 channel certification。

### 阶段 3 · 本地生态 plugin

`skills-hub` 与 opt-in `automation` 使用既有 dsh seam。Channel identity presentation 与 acknowledgement behavior 通过旧路径继续可用。Federation 按 ADR-0005 保持 evaluation-only。

## 4. 当前阶段 4 · 产品 GUI、渠道平面与发行

阶段 4 有三个并行 workstream。它们共享 `clawdsh` 产品 identity 与 clean-install 要求，但各自拥有独立证据。

### 4.1 ClawDSH 本地 GUI

`clawdsh` profile 把原生 dsh Web 应用与自有 nested 产品 runtime 组合起来。[ADR-0007](../adr/0007-clawdsh-local-gui-product.md)的产品壳与 Settings 增量已经实现：

- `/clawdsh/` 是默认产品 route；`/` 保留原生 dsh Web，并标记为 Harness 高级。
- 导航为对话、ClawDSH 设置、ClawDSH 活动与 Harness 高级。
- 对话复用公开 dsh client plugin graph 与 renderer；ClawDSH 拥有 shell、Settings、Activity 与 Control Runtime。
- ClawDSH 设置把只读 capability 与 Loader 总览同 schema-driven mutation、optimistic revision、desired/runtime state、restart requirement 以及不含 secret 的 dsh credential metadata 组合起来。
- ClawDSH 活动跟随当前 Session，并呈现从 standard history 与有界 sidecar 合并而来的限制隐私 Prompt、Memory、Channels、Skills 与 Automation 记录；raw Trajectory 留在 Harness 高级。
- `dsh --profile web` 保持纯 Harness 入口。
- real-profile browser 旅程从没有模型 key 或 OpenClaw artifact 的 clean home 启动，并验证两个 route、四个目的地、已挂载的 Settings namespace、关闭的 Gateway 状态、secret absence、未知 route 处理与 keyless 产品 snapshot。Focused control-plane test 覆盖 mutation、reset 与 stale-revision 拒绝。

### 4.2 当前渠道平面

[ADR-0008](../adr/0008-openclaw-channel-plane.md)把 production OpenClaw Gateway 锁定为 `v2026.7.1-2` / commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`，记录 source-only canary，并建立 **24 个 core/bundled/repository-official + 3 个 external** public chat transport 的 production catalog。

基础由 `@clawdsh/dsh-channel`、`@clawdsh/dsh-channel-agent`、`@clawdsh/dsh-channel-openclaw` 与 `tools/openclaw-channel-host` 组成。Profile 始终挂载三个 runtime package；Channel Protocol 与 Agent Bridge 保持可用，OpenClaw Gateway 业务 setting 则默认关闭。没有渠道 certified 或 enabled；逐渠道 assembly、自有 keyless snapshot evidence、当前 live smoke、Windows endpoint authorization 与剩余 media support 尚未完成。

旧渠道 package 在 `ctx.legacyChannels` 下单独保留，用于替换验证。它们不得与 OpenClaw 通信平面连接同一 platform account，并且只能在替换条件通过后删除。

### 4.3 公共发行

`tools/link-clawdsh.sh` 是开发安装器。它只安装 `clawdsh` identity，检测到旧 `openclaw` profile 与 preset asset 时警告，并保持其不变。公共发行工作拥有 idempotent CLI、精确 dsh 与 ClawDSH bundle version、managed manifest、`clawdsh doctor`、preset backup 与 repair、clean-home smoke，以及 public npm provenance。

## 5. 工作顺序

### 产品 GUI 顺序

1. ✅ nested ClawDSH Web entry、产品 runtime、`/clawdsh/` route、四目的地导航、capability overview 与 keyless real-profile 旅程已经实现。
2. ✅ schema-driven Settings、credential reference、optimistic revision check、desired/runtime state、restart requirement 以及专用 Automation 与 Gateway editor 已经实现。
3. ✅ Current-Session Activity 使用有界且受权限限制的 sidecar JSONL，并从 standard Session history 提供 fallback projection。
4. 在 browser 与 real-profile regression test 中持续保留 native GUI、raw Trajectory 与 `dsh --profile web`。

### 渠道顺序

1. 维护可复现 production host 与 bridge assembly，包括 sole-AgentHarness routing 与精确 runtime inspection。
2. 增加自有 keyless Gateway-to-Agent snapshot lane，并关闭 protocol、recovery、delivery、action 与 attachment evidence gap。
3. 运行逐渠道 certification，从 Telegram 与 Feishu 开始，记录精确 host、channel、OS 与 live-traffic evidence。
4. 只启用 certified combination，然后在同一变更中删除 legacy package 并归档其 Agent Note。
5. 按 ecosystem value、credential availability、platform risk 与 external-package review 分批提升更多 production catalog entry。

### 发行顺序

1. 在 ClawDSH bundle 中打包 profile、presets、Control Runtime、GUI assets 与精确 feature dependencies。
2. 只有 npm scope ownership、public-source provenance 与精确 dsh compatibility 通过后，才把 CLI 与自有 package 以 `0.1.0-rc.1` 发布到 public npm `next` tag。
3. 证明 clean installation、second-run idempotency、user-change preservation、tarball integrity，以及不存在 private registry、workspace、file 或 symlink reference。

## 6. 成功标准

1. Clean dsh home 无渠道凭证也能启动 `/clawdsh/`，新 Session 默认使用 `ClawDSH 模式`。
2. 对话、ClawDSH 设置、ClawDSH 活动与 Harness 高级均可访问，同时纯 `dsh --profile web` 行为不变。
3. ClawDSH capability setting 由 schema 驱动，可安全处理冲突，不泄露 credential，并诚实展示 restart requirement 与 runtime state。
4. Activity 解释 ClawDSH Prompt、Memory、Channels、Skills 与 Automation behavior，不声称能重建最终 flattened prompt，也不替代 raw Trajectory。
5. 一个已批准 OpenClaw production host 暴露 stable 27-entry catalog，且 ClawDSH 不复制 platform SDK integration。
6. OpenClaw model fallback 不能回答 channel turn，重复 input 或 ambiguous delivery 不能静默复制 Agent 或 delivery side effect。
7. Support label 与 evidence 对应，交付 profile 只激活 certified host-and-channel combination。
8. Public installation 精确、idempotent、可恢复，并保留用户 settings、credentials、memory、skills 与 custom patch。

## 7. 开放条件

- [x] 实现 ClawDSH 产品壳与只读 capability overview。
- [x] 实现 Settings control plane 与 credential-safe mutation flow。
- [x] 实现 semantic Activity 与 sidecar degradation behavior。
- [x] 为产品壳增加自有 real-profile browser 与 keyless snapshot。
- [ ] 在把任何 production entry 提升为 installable 前增加逐渠道 configuration、capability probe 与 keyless contract evidence。
- [ ] 完成新的 Telegram 与 Feishu certification；两者都未 certified 或 enabled。
- [ ] 在 Windows channel support 推进前增加 Windows named-pipe ACL enforcement。
- [ ] 在宣传对应 media path 前增加 durable non-image attachment 与 outbound staging。
- [ ] 在持久化冗余 `channel/*` event 前增加 ignorable Session append mechanism。
- [ ] 只有全部替换条件通过后才能删除 legacy channel package。
- [ ] 发布前完成 public npm ownership、provenance、exact-version compatibility 与 clean-install smoke。
