# ClawDSH 组装层

[English](README.md) | 中文

本目录是 ClawDSH 的应用组装层。它通过 profile、bundle、preset、patch 与 nested-build mechanism 组合公开 dsh 能力和自有 package，且不修改上游源码。物理 `preset-openclaw` 目录名仍是窄仓库例外；安装 id 与产品文案使用 `clawdsh`。

本目录不是 Cordis plugin。它提供：

1. `clawdsh` Agent preset（`preset.yml`、`agent.cordis.yml` 与 `souls/assistant.md`），显示为 `ClawDSH 模式`；
2. `clawdsh` profile template（`profile/`），把 dsh base 与 Web bundle 和 ClawDSH Host plugin 组合；
3. nested ClawDSH browser shell 与 `@clawdsh/dsh-product-runtime`，包含能力总览、可编辑 Settings 控制面与跟随当前 Session 的语义 Activity；
4. 供 `tools/link-clawdsh.sh` 消费的开发安装源；
5. `@clawdsh/dsh-bundle`、`@clawdsh/cli` 与 fail-closed 发行验证的 nested 公共发行源码。

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

## 托管安装 CLI

`@clawdsh/cli@0.1.0-rc.1` 精确依赖 `@clawdsh/dsh-bundle@0.1.0-rc.1` 与 `@deepseek-ai/dsh@0.1.0-rc.6`。

发布条件通过后，npm 入口是：

```bash
npx --yes @clawdsh/cli@0.1.0-rc.1
```

安装后的命令集合是：

```text
clawdsh
clawdsh init
clawdsh init --reset-preset
clawdsh start
clawdsh start --profile <name>
clawdsh doctor
clawdsh channel install
clawdsh channel doctor
```

没有子命令时，CLI 幂等地初始化或升级托管 profile，再通过自身精确 dsh 依赖启动 ClawDSH GUI。`start` 原样传递 `--host`、`--port` 与 `--trusted-host`；具名 custom profile 只会启动，不会被接管或修改。安装过程构建完整 staging candidate，验证 bundle 顺序 `@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @clawdsh/dsh-bundle`，随后以 `.clawdsh.json` manifest 原子发布托管 profile、presets 与 runtime asset。它保留 Settings、Credentials、Memory、Skills、OpenClaw state 与 custom profile patch。没有 marker 或被修改的 preset 会阻止静默替换；`--reset-preset` 在恢复托管副本前创建带时间戳和 integrity 的备份。同名且没有 marker 的 profile 绝不会被接管，旧 `openclaw` asset 只产生警告，不会被删除。

Channel 获取与 `init` 分离。`clawdsh channel install` 要求当前 Node 可执行文件满足已锁定 Gateway engine，只接受 checked production track，下载精确 OpenClaw artifact，校验 SHA-512 与每个 archive member，在禁用 lifecycle script 的情况下组装 checked runtime，并且只在配置不存在时创建不含凭证且 fail-closed 的配置。既有 OpenClaw 配置与 state 保持不变，canary 只用于审计。`clawdsh channel doctor` 校验托管 identity，并把完整 fail-closed 配置检查委托给已安装 Provider，而不选择、返回或打印 platform credential。因此普通产品安装保持轻量；即使没有 OpenClaw artifact，也能在 Gateway 关闭时启动。

## 通信平面

Profile 始终按以下顺序挂载完整 communication seam：

1. `@clawdsh/dsh-channel`，platform-independent Service Definition；
2. `@clawdsh/dsh-channel-agent`，durable Agent Driver 与 route-scoped `message` tool；
3. `@clawdsh/dsh-channel-openclaw`，authenticated IPC Provider 与 locked Gateway supervisor。

Channel Protocol 始终提供 Service Definition，Agent Bridge 始终注册自身 network-inert Driver。OpenClaw Gateway 保持 mounted，其经过校验的 `enabled` setting 默认为 false，因此不执行 artifact check、socket binding、process launch 或 Provider registration。旧进程内 Telegram 与 Feishu package 不在 active profile 中，external extension selection 默认为空。OpenClaw 仍是 platform credential 的唯一 owner；本 profile 不读取或复制这些凭证。绝不能让 legacy adapter 与 OpenClaw 通信平面连接同一 platform account。

Provider 配置、artifact check、admission default 与 runtime limitation 见 [channel-openclaw README](../channel-openclaw/README.md)。受检支持 catalog 采用保守语义：存在于 OpenClaw catalog 不表示渠道 installable、certified 或 enabled。[ADR-0008](../../../docs/adr/0008-openclaw-channel-plane.md)拥有架构与替换条件。

### Managed Gateway deployment

OpenClaw release artifact 与 checked npm runtime 必须在启动前组装完成。Provider 绝不在 runtime 下载、安装或更新它们。

```bash
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

检入的 deployment path 组成 installer-managed profile base，并在 ClawDSH Settings 中保持只读。Runtime 组装完成后，从 Settings 页面启用 OpenClaw Gateway；Host 会在持久化修改前完成 deployment preflight。Preflight 失败会让 setting 与 revision 保持不变。启用后，已准入 owner direct message 使用 `clawdsh`；每个 non-owner 或 group conversation 使用 `clawdsh-messaging-safe`。

## Clean-install 默认值

Memory、Skills Hub 与 Activity 保持启用。Activity 是必需能力，并且只记录限制隐私的产品语义；它的失败不能阻断业务能力。Ark Embeddings 只在 embedding call 需要时解析固定 `ARK_API_KEY` credential reference。Automation 与 OpenClaw Gateway 保持关闭。Disabled capability 可以缺少 credential；enabled capability 缺少所需配置时在最早 validation point 失败。

Optional business plugin 保持 mounted，并暴露自身 Config schema。经过校验的 `enabled` setting 控制 runtime effect，ClawDSH Settings 则显示 desired/runtime revision、restart requirement、field ownership 与不含 secret 的 credential state。Reset 只移除 user layer，并恢复 profile base 加 schema default。

## 产品壳

[ADR-0007](../../../docs/adr/0007-clawdsh-local-gui-product.md)与[本地 GUI 规格](../../../docs/specs/feature-gui-web.md)定义产品壳。`/clawdsh/` 拥有对话、ClawDSH 设置、ClawDSH 活动与 Harness 高级；`/` 保留原生 dsh Web。对话复用公开 dsh client graph 与 renderer。ClawDSH Settings 把 capability health 与 allowlist schema editing、optimistic revision、managed Gateway deployment、Automation rules 以及只写 dsh credential update 组合起来。Activity 跟随当前 Session，合并 standard history 与有界 sidecar，并通过 filter 与 cursor pagination 呈现固定且隐私安全的 Prompt、Memory、Channel、Skill 与 Automation 记录。未知产品 path 会渲染明确的未找到页面，不会落入 Harness。

Profile 关闭原生 `dsh web:` readiness line，并挂载 `@clawdsh/dsh-product-runtime`。Loader 结算后，该 runtime 打印 `clawdsh web: http://127.0.0.1:<port>/clawdsh/`，拥有产品静态 route，同时保持 `/` 的原生 fallback 不变。Nested browser build 把 asset 写入 `product-shell/runtime/web/`；两个 nested package 都不进入根 workspace 或 Client aggregate。

该组装不注册新的 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、generated file 或上游 GUI source。Activity 不增加上游 Session event type，Raw Trajectory 留在 Harness 高级，`dsh --profile web` 保持纯 Harness 入口。[Activity 规格](../../../docs/specs/feature-activity.md)拥有其存储、隐私与降级行为。

## 托管 preset

Launcher 没有 installation-owned ClawDSH preset root，因此两个 preset 都位于 dsh user preset root。ClawDSH 产品 Settings 页面不提供 preset 删除操作，但 Harness 高级仍把它们视为 user preset。CLI 的 managed manifest、integrity check、reset 前 backup 与 `clawdsh doctor` 会把已安装资产同普通 user preset 区分开来。开发安装器仍是 source-tree convenience，会恢复已检入 preset file，但不会接管用户数据。

## 公共打包

公共候选版本包含精确的 [13 包发行集合](../README.md#public-release-set)，版本均为 `0.1.0-rc.1`。`@clawdsh/dsh-bundle` 携带 profile patch、主 preset、Control Runtime、构建后的 `/clawdsh/` asset、Channel lock 与 bridge notice，并精确依赖十个 runtime feature package 和受限 preset。真实 tarball 验证会拒绝 `workspace:`、`file:`、symlink、未声明 asset、私有 registry URL、意外 package，以及固定发行图之外的任何依赖版本。

发行 workflow 只以公共 npm 与 `next` tag 为目标。Dry run 打包并审计全部 13 个 tarball，按依赖顺序发布到临时 loopback registry，并在隔离 dsh home 中完成干净安装。Registry 状态仍是 `bootstrap-required`：npm trust 与 staged publishing 都要求 package 已存在，但 13 个 package name 均不存在。必须先由用户另行授权交互式 2FA bootstrap 创建 package object，才能把全部 13 条 trust 记录绑定到 `clawdsh-publish.yml`、environment `npm` 与 `npm publish`。OIDC readiness 还要求 GitHub `npm` environment 只允许 `clawdsh` branch，并通过 workflow 的精确 `refs/heads/clawdsh` 检查。本次实现不选择或发布 bootstrap artifact、不配置 trust、不改变仓库可见性，也不发布候选版本；完整条件由 [ADR-0009](../../../docs/adr/0009-public-npm-distribution.md)管理。

## 验证边界

锁定 production host、local IPC handshake、Provider 与 Driver ledger、fail-closed model route、extension-integrity check 与 keyless protocol test 建立当前 channel foundation。真实 Telegram、Feishu 或其他平台认证仍需专用账号、当前凭证与已记录 live-smoke evidence。在这些证据存在前，profile 保持每个 channel 关闭，support catalog 不把任何渠道提升为 `certified` 或 `enabled`。
