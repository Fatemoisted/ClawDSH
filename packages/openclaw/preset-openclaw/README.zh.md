# ClawDSH 源码组装层

[English](README.md) | 中文

本目录是 ClawDSH 应用的源码开发组装层。它组合公开 dsh bundle、私有开发 bundle、自有功能包、两个 Agent preset、嵌套产品 browser／runtime 与可选 OpenClaw 通信平面，且不修改上游源码。物理 `preset-openclaw` 名称是仓库内部例外；安装 id 与产品文案使用 `clawdsh`。

终端用户的 npm 安装、升级、迁移与恢复归 [`@clawdsh/cli` 参考](distribution/cli/README.md)所有。产品配置与凭据归[根用户指南](../../../README.md#configuration-and-data)所有。本页只覆盖干净源码 checkout 与高级 Gateway 组装。

## 干净 checkout

使用 Node.js `22.19.x` 或 `>=24.0.0`，以及仓库指定的 pnpm 版本：

```sh
git clone https://github.com/Fatemoisted/ClawDSH.git
cd ClawDSH
pnpm install
pnpm run build
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/run-clawdsh-dev.sh
```

嵌套产品壳保持在根 workspace 与 Client aggregate 之外，因此拥有自己的 lockfile。`tools/link-clawdsh.sh` 要求 `product-shell/runtime/lib/index.mjs` 与 `product-shell/runtime/web/index.html` 同时存在；任一文件缺失时，脚本会退出并打印精确的产品壳构建命令。

包装脚本会刷新 source profile，把开发 home 导出为 `DSH_HOME`，再启动 `pnpm dsh --profile clawdsh`。新 Web Session 使用显示为 `ClawDSH 模式` 的 `clawdsh` preset；`clawdsh-messaging-safe` 继续作为受限 Channel preset。Web Host 无需模型、Ark 或平台凭据即可启动。只有对话发起依赖模型的请求时才需要模型密钥。

如需使用另一个隔离开发目录或 Web 端口：

```sh
CLAWDSH_DEV_HOME=/absolute/path/to/clawdsh-dev tools/run-clawdsh-dev.sh --port 3090
```

`CLAWDSH_DEV_HOME` 默认为 `~/.clawdsh-dev`。源码工具绝不 fallback 到 `DSH_HOME`，因此默认位于 `~/.dsh` 的普通公开 home 可以和源码开发并存。

## 开发 home 所有权

源码安装器写入 `.clawdsh-dev.json` schema v1，并且只拥有其中记录的开发 profile、package symlink 与两个 presets。Marker 记录 repository root、profile 与私有 bundle 完整性、精确的 home-relative link target，以及 preset digest。所选开发 home 中存在公共 `.clawdsh.json` marker 时会立即拒绝；无标记的同名资产、未知 schema 或未知 inventory 也会被拒绝。

Profile 按顺序包含 3 层 bundle：

1. `@deepseek-ai/dsh-base`；
2. `@deepseek-ai/dsh-web-app`；
3. 私有 `@clawdsh/dsh-dev-bundle`。

私有 bundle 携带 ClawDSH 产品组合与源码包依赖。`$CLAWDSH_DEV_HOME/profiles/clawdsh/cordis.patch.yml` 是用户层：首次安装创建检入的空文件，后续刷新保留其字节。源码安装器绝不把产品组合写进该用户 patch。

`$CLAWDSH_DEV_HOME/profiles/node_modules/@clawdsh/` 下的 package entry 是指向同一 checkout 的 symlink。两个 presets 是受管副本。刷新会更新未修改的 presets 与 link，但拒绝用户修改过的 preset、profile manifest 或受管 link。刷新前显式保留修改过的开发自有资产：

```sh
tools/link-clawdsh.sh --backup-modified
tools/run-clawdsh-dev.sh
```

第一条命令会先把当前开发 profile、两个 presets 与 link 证据复制到仅属主可访问的 `$CLAWDSH_DEV_HOME/.clawdsh-dev-backups/source-<timestamp>-<digest>/` 目录，再执行替换。它不复制 Settings、凭据、Sessions、Memory、Skills、Activity 或 OpenClaw state。Source refresh 与 public source-to-managed migration 是独立生命周期；只有在公开 `$DSH_HOME` 中发现历史 source-linked 布局时，才使用 [`clawdsh migrate source`](distribution/cli/README.md#source-installation-migration)。

## 组装内容

源码组装层提供：

- `clawdsh` Agent preset（`preset.yml`、`agent.cordis.yml` 与 `souls/assistant.md`）；
- `clawdsh` profile template 与私有开发 bundle；
- 提供 `/clawdsh/` 且在 `/` 保留原生 Harness 的嵌套 browser shell 与 `@clawdsh/dsh-product-runtime`；
- 始终挂载的 Soul、Memory、Skills、Activity、Automation、Channel Service Definition、Agent Bridge 与 OpenClaw Gateway 插件；
- 供显式 Gateway 设置使用的锁定 OpenClaw Host、runtime、bridge、support catalog 与 governance 输入。

Memory、Skills Hub 与 Activity 默认启用。Automation 与 OpenClaw Gateway 默认关闭。Ark 只在 embedding 调用时解析 `ARK_API_KEY`。Gateway 关闭时不会校验 artifact、绑定 socket、启动进程或注册 Provider。平台账号、凭据、策略与 state 继续只归 OpenClaw 所有。

已检查的 Channel catalog 采用保守语义。Telegram、飞书、Discord 等平台出现在 catalog 中，不表示它们 installable、certified、enabled 或获得支持；源码组装层也不交付直连平台适配器。

## 高级 Gateway 组装

受管用户路径是先运行 `clawdsh channel install`，再运行 `clawdsh channel doctor`。源码部署也可以显式准备同一组不可变输入。启用 Gateway 前，先把以下内容准备为普通文件与目录：

- 兼容的 Node 可执行文件；
- SHA-512 与锁定值一致的已检查 production OpenClaw tarball；
- 禁用生命周期脚本后得到的精确 npm runtime tree；
- stable ClawDSH bridge；
- 隔离 state 目录与 fail-closed OpenClaw 配置。

Provider 绝不在 runtime 下载、安装或更新这些资产。启动 source profile 前配置对应路径：

```sh
export CLAWDSH_OPENCLAW_TRACK=production
export CLAWDSH_OPENCLAW_GATEWAY_INSTANCE_ID=personal-gateway
export CLAWDSH_OPENCLAW_ARTIFACT_PATH=/srv/clawdsh/openclaw/openclaw.tgz
export CLAWDSH_OPENCLAW_RUNTIME_ROOT=/srv/clawdsh/openclaw/runtime
export CLAWDSH_OPENCLAW_HOST_ROOT=/srv/clawdsh/openclaw/runtime/node_modules/openclaw
export CLAWDSH_OPENCLAW_STATE_DIR=/srv/clawdsh/openclaw/state
export CLAWDSH_OPENCLAW_CONFIG_PATH=/srv/clawdsh/openclaw/state/openclaw.json
export CLAWDSH_OPENCLAW_STAGING_ROOT=/srv/clawdsh/openclaw/state/staging
export CLAWDSH_OPENCLAW_ENDPOINT=/srv/clawdsh/openclaw/state/clawdsh.sock
export CLAWDSH_CHANNEL_CWD=/srv/clawdsh/workspace

tools/run-clawdsh-dev.sh
```

默认 profile 使用 WebUI 进程的 Node 可执行文件运行 Gateway。只有要选择另一份经过独立验证的兼容 executable 时，才设置 `CLAWDSH_OPENCLAW_NODE_PATH`。npm `10.9.7` pin 是确定性的 runtime assembly 工具，不是第二套 Node runtime。

平台账号与凭据保留在 OpenClaw 账号设置和隔离 state 中。DeepSeek 与 Ark key 保留在 dsh credential source 中。IPC bearer token 与 startup nonce 每次启动时生成，不是 operator config。

外部 OpenClaw Channel plugin 默认全部被拒绝。源码部署若单独验证了某个插件，需要通过 `CLAWDSH_OPENCLAW_EXTENSIONS_JSON` 传入精确 lock 数组；隔离 npm project 与 OpenClaw installed-plugin index 必须在启动前匹配每个 lock entry。变量缺失表示 `[]`，不会准入任何外部 extension。

DM pairing 只授予 ingress，不授予 owner preset。受管 OpenClaw 配置会禁用 runtime config write，因此需要在 `commands.ownerAllowFrom` 中列出每位 human operator，并使用 `feishu:<open_id>` 这类带 Channel 前缀的原生 id。修改 owner 列表后重启 ClawDSH，并在对话中发送 `/new`。Owner direct message 随后选择 `clawdsh`；non-owner 与 group conversation 继续使用 `clawdsh-messaging-safe`。

只有部署身份通过 preflight 后，才能从 ClawDSH Settings 启用 Gateway。Preflight 失败会让已保存设置与 revision 保持不变。认证、installability 与真实平台行为需要健康的本地 Gateway–Bridge handshake 之外的独立证据。

## 源码验证

修改 browser、runtime、profile 或品牌后，运行嵌套产品检查：

```sh
pnpm --dir packages/openclaw/preset-openclaw/product-shell run typecheck
pnpm --dir packages/openclaw/preset-openclaw/product-shell run test
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/link-clawdsh.sh
```

最后一次刷新可以证明真实构建的 runtime 与 browser 资产存在，且所选开发 home 仍是已知 source-managed 布局。公共 tarball 与干净安装校验归 distribution release tools 所有，不属于本源码组装层。
