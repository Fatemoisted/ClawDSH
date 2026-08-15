# Agent Note: test1 重建保留唯一规范渠道平面

Status: implemented

[English](2026-08-15-test1-channel-plane-rebuild.md) | 中文

## 问题

test1 分支包含有价值的旧版 Telegram、Discord 与飞书实现、真实平台证据、文档和 fork CI 修复。若把该分支作为一个历史快照整体覆盖回来，也会让进程内渠道 seam 重新成为生产架构，并覆盖基线 commit `20f0910dbe` 已有的锁定 OpenClaw 渠道平面。两套实现使用近似词汇，但所有权、安全、持久性和认证边界不同；若静默合并到同一个 Cordis Service，会让两个契约都变得含糊。

该分支还必须保持为 DeepSeek Harness 的扩展。在渠道包内重新实现 Session、Agent、model、tool、preset、attachment、timer、credential 和 Cordis lifecycle，会形成第二套逐渐偏离 Harness 行为的 runtime。

## 决定

分支保留 `20f0910dbe` 的锁定 OpenClaw 设计，作为唯一规范生产渠道平面。其 Service Definition 继续是 `ctx.channels`；`@clawdsh/dsh-channel-agent` 驱动 Harness 既有 Agent 与 Session，`@clawdsh/dsh-channel-openclaw` 拥有已认证 sidecar Provider。完整 sidecar group 已存在于 `clawdsh` profile，但默认关闭，因为当前没有任何单独 OpenClaw Channel 达到 certified 或 enabled。

恢复的进程内 adapter 只属于兼容代码。其 registry 改名为 `ctx.legacyChannels`，package 描述与文档明确标为 legacy，Telegram、Discord 与飞书也只 inject 该 Service。Profile 把它们放在独立的 `clawdsh-legacy-channel-plane` group 中；必须同时设置总开关 `CLAWDSH_LEGACY_CHANNELS_ENABLED=1` 与一个逐 adapter 开关才会启用，默认保持关闭。存在该总 opt-in 时，canonical Gateway 启动与 Settings preflight 会在产生副作用前 fail-loud。该互斥规则防止同一个平台账号被两套 runtime 同时消费。ClawDSH 发布集合继续排除 legacy package。

该集成遵循 [ADR-0010](../../../../docs/adr/0010-harness-contract-first.md) 的 contract-first 规则：渠道代码先组合 Harness 的 Agent、Session、model、tool、preset、attachment、credential、timer、effect 与 Cordis Service，再引入本地代码。持续维护的入口索引是 [Harness 复用矩阵](../../../../docs/matrix/harness-reuse.md)。本地渠道代码只负责平台转换、route 与呈现策略、兼容 bookkeeping，以及 Harness 尚未提供的规范 sidecar 协议 surface。

## 证据与认证边界

历史有凭据运行仍是其实际经过的 legacy path 的有效回归证据：2026-08-14 的飞书文本往返通过；2026-08-15 的 Telegram 私聊、群组、topic、reply、caption、图片、reaction、分段、重启与离线重连案例通过。Discord 具备无密钥 contract 覆盖，但没有完成有凭据 server E2E。[Telegram cookbook](../../../../docs/cookbook/telegram-e2e.md)记录了可重复操作和这些结论的精确范围。

上述证据都不会晋级任何 OpenClaw catalog row。它们没有经过锁定 Gateway artifact、认证 IPC handshake、`ctx.channels`、delivery ledger 或当前 sidecar release composition。因此，规范 sidecar 在自身 assembled keyless transcript 与所需真实平台测试通过前，继续处于 cataloged、默认关闭且未认证状态。Legacy credential 仍只通过环境变量引用，绝不存入仓库。

## CI 与验证

Fork-safe CI 在不假设每个 mirror 都拥有上游仓库 GitHub App、project credential 或 API secret 的情况下保持检查信号有效。Issue lifecycle 与 policy automation 只在 `deepseek-ai/deepseek-harness` 运行。真实 DeepSeek API E2E 在该规范仓库默认运行；mirror 必须设置 `DSH_REAL_API_E2E_ENABLED=true`，pull request 只接受可信同仓库来源，已启用的运行若缺少 `DEEPSEEK_API_KEY_EXTERNAL` 会在 preflight 失败。Wine 与原生 host build 都使用 `tsconfig.host.json`，`scripts/ci-workflow.spec.ts` 固定这些 workflow contract。

分支通过 legacy adapter unit 与 presentation suite、profile smoke test、规范 channel-plane suite、workspace typecheck/lint/JSDoc gate、CI-workflow test、translation pairing、Markdown link/wrap、文档预算和 Agent Note 格式检查验证。有凭据 live E2E 仍是显式手工或 secret-backed release 步骤，并按实际执行路径报告，不能从 unit coverage 推断。

Root `AGENTS.md` 文档上限窄幅设为 1,950 words。保留的上游规则自身已有 1,904 words，必需的 30-word fork ownership/Harness-map 路由使当前文件达到 1,934；该有限上调避免为了满足旧 1,900-word ceiling 而改写上游正文，同时 manifest 继续作为阻止无关增长的 ratchet。

## 取代关系

本 Note 不取代[锁定 OpenClaw 渠道平面决策](2026-08-15-openclaw-channel-plane-bridge.md)。后者继续对规范架构、协议、安全、持久性和认证阶梯保持权威。[旧版身份呈现](../feature/2026-08-14-channel-identity-presentation.md)与 [ack-reaction](../feature/2026-08-14-ack-reaction-scope.md) Note 继续负责其兼容行为，[ClawDSH 身份与干净安装默认值](../feature/2026-08-15-clawdsh-identity-and-safe-defaults.md) Note 继续负责安装身份和无凭据启动。本 Note 负责重建中的兼容隔离、Harness-first 集成边界、历史证据分类和 fork CI 行为；没有其他 active Agent Note 覆盖这一组合决策。

## 曾考虑的替代方案

- **整体恢复旧分支**：拒绝，因为这会用进程内平台 seam 取代已评审的 sidecar 边界，并让历史 live test 看起来像是在认证其从未执行过的代码。
- **删除所有 legacy adapter 与证据**：拒绝，因为在 sidecar 尚未认证时，这些实现和 Telegram/飞书真实测试结论仍是有用的兼容与迁移资产。
- **让两套实现都暴露为 `ctx.channels`**：拒绝，因为 Cordis injection 会变得含糊，profile 也可能为同一平台账号启动两个 consumer。
- **默认启用任一渠道平面**：拒绝，因为 sidecar 尚无逐 Channel 认证，而 legacy path 只为显式兼容用途保留。
- **在渠道包内重建 Harness 设施**：拒绝，因为这会复制稳定契约、扩大安全与持久性所有权，并提高未来同步上游的难度。

## 影响

分支保留更完整的 legacy 功能，同时不削弱锁定生产架构。开发者拥有一个规范 Service、一个清楚隔离的兼容 Service、一套显式 opt-in 与互斥规则，以及一份标明应复用哪些 Harness contract 的地图。历史 live evidence 得以保留而不夸大认证范围，每个 sidecar Channel 仍必须独立通过支持晋级。

代价是临时双线维护：在锁定 sidecar 达到等价认证前，兼容 adapter 与测试继续保留；profile operator 必须显式选择执行路径；文档与 release report 在报告渠道状态时必须写明该路径。
