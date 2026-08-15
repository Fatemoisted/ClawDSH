# ClawDSH 组装层

[English](README.md) | 中文

本目录是 ClawDSH 的组装层。它通过 profile、bundle、preset 与 patch 机制，把 dsh 能力和 `packages/openclaw/*` 插件组成个人助手，不修改上游源码。物理目录名 `preset-openclaw` 只作为仓库内部豁免保留；安装后的 id 与产品文案均使用 `clawdsh`。

对应的 OpenClaw 功能是由 gateway、渠道、Soul、Memory、Skills 与 Automation 组成的完整个人助手形态。

本目录不是插件，它提供：

1. `clawdsh` agent preset（`preset.yml`、`agent.cordis.yml` 与 `souls/assistant.md`），显示为 `ClawDSH 模式`，安装在 dsh 用户 preset 根目录；
2. `clawdsh` profile 模板（`profile/`），将 `dsh-base`、`dsh-web-app` 与 ClawDSH Host 插件组合起来；
3. 开发安装脚本 `tools/link-clawdsh.sh`，用于安装 profile、preset 并链接本地 `@clawdsh/*` 包。

干净安装的 profile 默认关闭飞书、Telegram 与 Automation，因此无需这些功能的凭据也能启动原生 dsh Web GUI。Memory 与 Skills Hub 保持启用；Ark Embeddings 仅在 embedding 调用需要时解析 `ARK_API_KEY`。这三个可选功能暂时通过 Loader `disabled` 配置项关闭；能力 Settings 增量会改为始终挂载业务插件，并由其 `enabled` 设置控制运行行为。

## 本地开发

```bash
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

新 Session 默认使用显示为 `ClawDSH 模式` 的 `clawdsh` preset。只有对话实际发起模型请求时才需要模型凭据；Web Host 本身无需外部凭据即可启动。

## 临时启用可选功能

在能力 Settings 交付前，通过后置 `--patch` overlay 启用可选行为。下面三行互相独立：删除不准备运行的能力，并在使用前替换 Automation 示例规则。飞书沿用 profile 已提供的环境变量引用；Telegram 与 Automation 必须在后置层给出完整 Config，因为按 id 定位的 patch 会替换其中每个提供的字段。

```yaml
- id: channel-feishu
  disabled: false

- id: channel-telegram
  disabled: false
  config:
    botToken: !!js process.env.TELEGRAM_BOT_TOKEN

- id: automation
  disabled: false
  config:
    rules:
      - id: daily-check-in
        schedule:
          kind: cron
          expr: "0 9 * * *"
        message: Review today's priorities.
```

把选中的配置项保存为 `clawdsh-enable.cordis.yml`。只为已启用的渠道提供凭据，然后检查最终组装或启动：

```bash
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml --dump-config
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml
```

功能关闭时可以缺少凭据；启用后，所属插件会在最早的配置校验点明确拒绝缺失的必需配置。飞书配置项读取 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`，Telegram 示例读取 `TELEGRAM_BOT_TOKEN`。

`tools/link-clawdsh.sh` 检测到旧 `openclaw` profile 或 preset 时只给出警告，并保留原资产。它不创建兼容别名，也不迁移或删除用户数据。删除旧 preset 前，应检查 `$DSH_HOME/settings.yaml` 中是否仍有旧的 `agent-presets.default` 覆盖。

由于 dsh launcher 没有提供 ClawDSH 自有的安装级 preset 根目录，该 preset 目前位于 dsh 用户 preset 根目录。ClawDSH 产品 Settings 页面不会提供删除操作，但 Harness 高级界面仍把它视为用户 preset，因而可以删除。公共发行 CLI 负责正式的 `clawdsh doctor`、托管安装 manifest、完整性检查与显式修复；在此之前，重新运行开发安装脚本会恢复仓库中的 preset 文件。

目标产品壳、能力 Settings、Activity 视图与 Harness 高级入口见[本地 GUI 功能规格](../../../docs/specs/feature-gui-web.md)。
