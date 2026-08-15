# ClawDSH 组装层

[English](README.md) | 中文

本目录是 ClawDSH 的组装层。它通过 profile、bundle、preset 和 patch 机制，把 dsh 能力与 `packages/openclaw/*` 插件组合成个人助手，不修改上游源码。物理目录名 `openclaw-preset-openclaw` 只是仓库内部例外；安装 id 与产品文案统一使用 `clawdsh`。

它对应 OpenClaw 的整体个人助手组合：gateway、渠道、Soul、Memory、Skills 与 Automation。

本目录不是插件，提供：

1. `clawdsh` agent preset（`preset.yml`、`agent.cordis.yml` 与 `souls/assistant.md`），界面显示为 `ClawDSH 模式`，安装到 dsh 用户 preset 根目录；
2. `clawdsh` profile 模板（`profile/`），把 `dsh-base`、`dsh-web-app` 与 ClawDSH Host 插件组合起来；
3. 开发安装器 `tools/link-clawdsh.sh`，构建本地包、安装 profile 与 preset、初始化 Memory，并链接本地 `@clawdsh/*` 包及 Harness `dsh-agent-presets` bridge。

干净安装默认关闭飞书、Telegram、Discord 与 Automation，因此无需这些外部凭证即可启动 dsh Web GUI。Memory 与 Skills Hub 保持启用；Ark Embeddings 只在实际 embedding 调用时解析显式 Harness 凭证引用 `ARK_API_KEY`。

**规格**：[roadmap](../../docs/specs/roadmap.md) · **状态**：已完成本地组装与无密钥覆盖，以及带凭证的飞书和 Telegram 文本 e2e；尚未实际执行 npm 发布

## 已验证组装

- ✅ Soul 在 agent 作用域内的挂载语义——由 `../../packages/openclaw/soul/tests/soul.spec.ts` 的契约测试覆盖；
- ✅ profile 解析与层叠——安装本模板后，`pnpm dsh --profile clawdsh --dump-config` 可解析；
- ✅ 安全的渠道接线——`channel-core` 保持启用，飞书、Telegram 与 Discord 默认关闭；Telegram 和 Discord 行通过 `botTokenEnv` 指定 `TELEGRAM_BOT_TOKEN` 与 `DISCORD_BOT_TOKEN`，不内嵌 secret；
- ✅ ClawDSH GUI 身份——无密钥真实 profile 浏览器门禁会启动 Web Host，并验证新 Session 默认使用界面显示为 `ClawDSH 模式` 的 `clawdsh` preset；
- ✅ 飞书真实 e2e——官方 SDK `LarkChannel` WebSocket 入站 → `channel-core` 持久 conversation/topic 回合 → DeepSeek 回复 → SDK 出站，已在飞书确认收到；
- ✅ Telegram 真实 e2e——Bot API 身份验证、私聊/群聊文本路由、原生引用、Memory 与会话恢复、web search、caption、离线补收、Unicode-safe 分片、中断恢复与同一聊天 FIFO 已通过带凭证部署；forum topic 仍只有无密钥覆盖；
- ✅ Memory 接线——`memory` 使用 `dshHomePath('memory')`；`embeddings-ark` 显式使用 `apiKeyEnv: ARK_API_KEY`，因此缺凭证时 boot 无感，只在 `memory_search` 调用时 fail-loud；
- ✅ Harness 原生渠道 Agent——`channel-core` 生成持久且不泄露平台 id 的 session id，经 `sessionPersistence` 恢复，并在创建与恢复时通过 `dsh-agent-presets` 解析、挂载日志记录的 `clawdsh` 组合；
- ✅ 飞书/Telegram/Discord 渠道行为——结构化 mention、原生引用/topic/thread、ack reaction、按平台上限 Unicode-safe 分片、SDK 自有重试与进程重启后会话连续性都有无密钥契约覆盖；
- ✅ Memory 写入与宿主编辑——`memory_append` 把存储和 sandbox 围栏委托给 Harness `ctx.fs`；watcher 只失效变化的索引条目，插件 remount 后仍能恢复 flush 归属；
- ✅ 本地安装——`tools/link-clawdsh.sh` 构建 10 个包，安装 `clawdsh` profile 与 preset，初始化 Memory，创建 10 个 `@clawdsh/*` 链接，并桥接 Harness `dsh-agent-presets`；
- ⏳ 实际 npm 发布——当前工作树尚未有意发布任何 `@clawdsh/*` tarball，symlink 仍作为本地开发过渡。

## 本地开发

```bash
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

新 Session 默认使用界面显示为 `ClawDSH 模式` 的 `clawdsh` preset。只有对话发起模型请求时才需要模型凭证；Web Host 本身可无外部凭证启动。

## 临时功能启用

Capability Settings 上线前，通过后置 `--patch` overlay 启用可选能力。各行相互独立：删除所有不需要运行的能力，并在使用前替换 Automation 示例规则。飞书沿用 profile 中的 Harness credential reference；Telegram 与 Discord 需要重复完整 Config，因为按 id 定位的 patch 会替换已提供字段。

```yaml
- id: channel-feishu
  disabled: false

- id: channel-telegram
  disabled: false
  config:
    botTokenEnv: TELEGRAM_BOT_TOKEN

- id: channel-discord
  disabled: false
  config:
    botTokenEnv: DISCORD_BOT_TOKEN
    messageContentIntent: false

- id: automation
  disabled: false
  config:
    rules:
      - id: daily-check-in
        schedule:
          kind: cron
          expr: '0 9 * * *'
        message: Review today's priorities.
```

把选中的行保存为 `clawdsh-enable.cordis.yml`，只为启用的渠道提供凭证，再检查最终组合或启动：

```bash
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml --dump-config
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml
```

禁用行可以缺少凭证；启用后，所属插件会在最早可验证点对缺失配置 fail-loud。飞书、Telegram 与 Discord 均解析各自命名的 Harness 凭证引用（`FEISHU_APP_ID` / `FEISHU_APP_SECRET`、`TELEGRAM_BOT_TOKEN`、`DISCORD_BOT_TOKEN`），并以启动环境作为回退。

## 当前部署限制

- `tools/link-clawdsh.sh` 刷新绑定当前 checkout 的资产；链接与运行必须使用相同的 `DSH_HOME`。
- 安装器发现旧 `openclaw` profile 或 preset 时只告警并保持原样，不创建兼容别名，也不迁移或删除用户数据。删除旧资产前请检查旧 `agent-presets.default` override。
- 当前 preset 位于 dsh 用户 preset 根目录，因为 launcher 尚未暴露由安装程序拥有的 ClawDSH preset 根目录。在发行 CLI 接管修复前，重新运行开发安装器可恢复仓库内置 preset 文件。
- 各 provider 的凭证、生命周期与部署 e2e 限制分别见 [Telegram](../../packages/openclaw/channel-telegram/README.md)、[Discord](../../packages/openclaw/channel-discord/README.md#known-limitations-and-deferred-work)与[飞书](../../packages/openclaw/channel-feishu/README.md)。启用规则前请阅读 [Automation 限制](../../packages/openclaw/automation/README.md#known-limitations-and-deferred-work)。

目标产品壳、Capability Settings、Activity 视图与 Harness Advanced 路由详见[本地 GUI 功能规格](../../docs/specs/feature-gui-web.md)。
