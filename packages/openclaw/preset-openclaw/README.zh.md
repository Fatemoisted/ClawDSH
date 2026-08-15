# ClawDSH 组装层

[English](README.md) | 中文

本目录是 ClawDSH 的应用组装层。它通过 profile、bundle、preset、patch 与 nested-build mechanism 组合公开 dsh 能力和自有 package，且不修改上游源码。物理 `preset-openclaw` 目录名仍是窄仓库例外；安装 id 与产品文案使用 `clawdsh`。

本目录不是 Cordis plugin。它提供：

1. `clawdsh` Agent preset（`preset.yml`、`agent.cordis.yml` 与 `souls/assistant.md`），显示为 `ClawDSH 模式`；
2. `clawdsh` profile template（`profile/`），把 dsh base 与 Web bundle 和 ClawDSH Host plugin 组合；
3. nested ClawDSH browser shell 与 `@clawdsh/dsh-product-runtime`，包含只读能力总览，并明确标示后续 Settings 与 Activity 增量的 deferred 状态；
4. 供 `tools/link-clawdsh.sh` 消费的开发安装源。

OpenClaw Gateway 是产品内的外部通信平面 provider。它不定义产品、profile 或 Agent preset identity。

## 本地开发

安装或刷新 profile、自有 package link 与两个 Agent preset：

```bash
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

新 Web Session 默认使用显示为 `ClawDSH 模式` 的 `clawdsh` preset。受限渠道 preset 安装为 `clawdsh-messaging-safe`。只有对话发起模型请求时才需要模型凭证；Web Host 本身无需外部凭证即可启动。

产品壳保持在根 workspace 和 Client aggregate 之外，因此拥有独立 lockfile；构建前先安装这个 nested workspace。开发安装器要求 `product-shell/runtime/lib/index.mjs` 与 `product-shell/runtime/web/index.html` 已存在；任一产物缺失时，它会失败并给出精确 build 命令。安装器把 nested runtime 链接为 `@clawdsh/dsh-product-runtime`，检测到旧 `openclaw` profile 或 preset asset 时会警告，并保持其不变。它不创建 compatibility alias，也不删除、移动、改写或接管用户数据。移除保存的 Session 可能仍引用的旧 preset 前，先检查旧 `agent-presets.default` override。

## 通信平面

除非 `CLAWDSH_OPENCLAW_CHANNELS_ENABLED=1`，`clawdsh-communication-plane` group 保持关闭。启用时，它按以下顺序挂载完整当前 seam：

1. `@clawdsh/dsh-channel`，platform-independent Service Definition；
2. `@clawdsh/dsh-channel-agent`，durable Agent Driver 与 route-scoped `message` tool；
3. `@clawdsh/dsh-channel-openclaw`，authenticated IPC Provider 与 locked Gateway supervisor。

Template 不启用任何渠道。旧进程内 Telegram 与 Feishu package 不在 active profile 中，external extension selection 默认为空。OpenClaw 仍是 platform credential 的唯一 owner；本 profile 不读取或复制这些凭证。绝不能让 legacy adapter 与 OpenClaw 通信平面连接同一 platform account。

Provider 配置、artifact check、admission default 与 runtime limitation 见 [channel-openclaw README](../channel-openclaw/README.md)。受检支持 catalog 采用保守语义：存在于 OpenClaw catalog 不表示渠道 installable、certified 或 enabled。[ADR-0008](../../../docs/adr/0008-openclaw-channel-plane.md)拥有架构与替换条件。

### Sidecar opt-in

OpenClaw release artifact 与 checked npm runtime 必须在启动前组装完成。Provider 绝不在 runtime 下载、安装或更新它们。

```bash
export CLAWDSH_OPENCLAW_CHANNELS_ENABLED=1
export CLAWDSH_OPENCLAW_TRACK=production
export CLAWDSH_OPENCLAW_GATEWAY_INSTANCE_ID=personal-gateway
export CLAWDSH_OPENCLAW_ARTIFACT_PATH=/srv/clawdsh/openclaw/openclaw-2026.7.1-2.tgz
export CLAWDSH_OPENCLAW_RUNTIME_ROOT=/srv/clawdsh/openclaw/runtime
export CLAWDSH_OPENCLAW_HOST_ROOT=/srv/clawdsh/openclaw/runtime/node_modules/openclaw
export CLAWDSH_OPENCLAW_NODE_PATH=/srv/clawdsh/node/bin/node
export CLAWDSH_OPENCLAW_STATE_DIR=/srv/clawdsh/openclaw/state
export CLAWDSH_OPENCLAW_CONFIG_PATH=/srv/clawdsh/openclaw/state/openclaw.json
export CLAWDSH_OPENCLAW_STAGING_ROOT=/srv/clawdsh/openclaw/state/staging
export CLAWDSH_OPENCLAW_ENDPOINT=/srv/clawdsh/openclaw/state/clawdsh.sock
export CLAWDSH_CHANNEL_CWD=/srv/clawdsh/workspace
export DEEPSEEK_API_KEY=sk-xxx

pnpm dsh --profile clawdsh
```

Platform credential 保留在 OpenClaw 隔离 state 与 account setup 中。Model 与 tool credential 保留在 dsh credential source 中。IPC bearer token 与 startup nonce 每次启动时生成，不是 operator config。

要在不复制 secret value 的情况下盘点 legacy adapter reference 与 credential name，请运行：

```bash
pnpm exec tsx tools/openclaw-channel-migration.ts --input /absolute/path/to/old-profile-or-env
```

不设置 `CLAWDSH_OPENCLAW_CHANNELS_ENABLED` 时，Web profile 不启动 communication sidecar。启用后，已准入 owner direct message 使用 `clawdsh`；每个 non-owner 或 group conversation 使用 `clawdsh-messaging-safe`。

## Clean-install 默认值

Memory 与 Skills Hub 保持启用。Ark Embeddings 只在 embedding call 需要时解析 `ARK_API_KEY`。Automation 与完整 communication-plane group 保持关闭。Disabled capability 可以缺少 credential；enabled capability 缺少所需配置时在最早 validation point 失败。

Optional feature 暂时使用 Loader `disabled` row。Settings control-plane 增量会保持 business plugin mounted，并把用户控制迁到 validated `enabled` setting，同时展示 desired 与 runtime revision、restart requirement 和 credential reference。

## 产品壳

[ADR-0007](../../../docs/adr/0007-clawdsh-local-gui-product.md)与[本地 GUI 规格](../../../docs/specs/feature-gui-web.md)定义产品壳。`/clawdsh/` 拥有对话、ClawDSH 设置、ClawDSH 活动与 Harness 高级；`/` 保留原生 dsh Web。对话复用公开 dsh client graph 与 renderer，初始 ClawDSH 设置目的地呈现只读总览，Activity 则明确标示 deferred 状态。未知产品 path 会渲染明确的未找到页面，不会落入 Harness。

Profile 关闭原生 `dsh web:` readiness line，并挂载 `@clawdsh/dsh-product-runtime`。Loader 结算后，该 runtime 打印 `clawdsh web: http://127.0.0.1:<port>/clawdsh/`，拥有产品静态 route，同时保持 `/` 的原生 fallback 不变。Nested browser build 把 asset 写入 `product-shell/runtime/web/`；两个 nested package 都不进入根 workspace 或 Client aggregate。

该组装不注册新的 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、generated file 或上游 GUI source。Raw Trajectory 留在 Harness 高级，`dsh --profile web` 保持纯 Harness 入口。

## Managed-preset 限制

由于 launcher 没有 installation-owned ClawDSH preset root，preset 当前位于 dsh user preset root。ClawDSH 产品 Settings 页面不会提供删除操作，但 Harness 高级仍把它们视为 user preset。公共发行 CLI 拥有 managed manifest、integrity check、reset 前 backup 与 `clawdsh doctor`；在此之前，重新运行开发安装器会恢复已检入 preset file。

## 验证边界

锁定 production host、local IPC handshake、Provider 与 Driver ledger、fail-closed model route、extension-integrity check 与 keyless protocol test 建立当前 channel foundation。真实 Telegram、Feishu 或其他平台认证仍需专用账号、当前凭证与已记录 live-smoke evidence。在这些证据存在前，profile 保持每个 channel 关闭，support catalog 不把任何渠道提升为 `certified` 或 `enabled`。
