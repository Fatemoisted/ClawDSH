# Agent Note: 经 dsh web bundle 的 ClawDSH GUI 前台

Status: implemented

[English](2026-08-15-openclaw-gui-dsh-web-app.md) | 中文

## 问题

OpenClaw 有两种用法：本机命令行，以及经 Gateway 桥接到通讯软件（飞书等）。ClawDSH 已通过 `ctx.channels` 交付渠道前台；「GUI」模式却无家可归。DeepSeek Harness 自带完整浏览器 GUI（`@deepseek-ai/dsh-web-app`），且它经与 `channel-agent` 相同的 `ctx.agents` / `ctx.sessions` / agent-loop seam 驱动回合，所以 GUI 无需任何上游改动即可承载 OpenClaw 功能——这是组合问题，不是代码问题。

## 决策

物理 `preset-openclaw` 组装组合 web bundle 并交付完整 `clawdsh` agent preset，因此公开托管启动器与隔离的源码开发启动器都能带 ClawDSH 的 OpenClaw 衍生功能启动浏览器 GUI。组合仍位于 ClawDSH 自有文件内：

- **源码 profile 与启动器** — `profile/package.template.json` 声明 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与私有 `@clawdsh/dsh-dev-bundle`。`tools/run-clawdsh-dev.sh` 刷新该源码安装，以 `~/.clawdsh-dev` 为默认值解析 `CLAWDSH_DEV_HOME`，把结果导出为 `DSH_HOME`，再启动 `clawdsh` profile。源码开发绝不 fallback 到公开 `DSH_HOME`。
- **产品层与用户层** — `profile/dev-bundle/cordis.patch.yml` 所有产品组合，包括 `system-prompt` persona 与 `agent-presets.default: clawdsh`。安装后的 `profiles/clawdsh/cordis.patch.yml` 是初始为空的用户层，源码刷新会逐字节保留它。[源码开发与托管迁移决策](../architecture/2026-08-17-clawdsh-source-development-and-managed-migration.md)所有 marker、备份与接管行为。
- **agent preset 工具集** — `agent.cordis.yml` 现在镜像 `standard` 预设的全套 agent-plane 工具（shell、fs、skills、plan、compaction、delegation/workflow、web、todo），仅一处替换：`persona` 行（`@deepseek-ai/dsh-persona` 的「coding agent」）换成 `@clawdsh/dsh-soul`（`souls/assistant.md`，见 [feature-soul](../../../../docs/specs/feature-soul.md)）。web bundle 把模型可见工具挪进 preset，不补则 GUI agent 只见 soul 加 host-plane 的 memory 工具。
- **preset 安装** — 源码安装器把 `preset.yml`、`agent.cordis.yml` 与 `souls/` 的受管副本经摘要校验后记录到 `$CLAWDSH_DEV_HOME/.agent-presets/clawdsh/` 下（preset id 即目录名）。受管资产有修改时，除非操作者显式请求先创建仅属主可访问的备份，否则安装器拒绝替换。安装名称与历史资产处理由[身份和安全默认值决策](2026-08-15-clawdsh-identity-and-safe-defaults.md)所有。

## 影响

- 启动器打印选定的 loopback origin；ClawDSH 产品入口为 `/clawdsh/`，`/` 则保留原生 Harness 界面。GUI 对话呈现与渠道路径相同的 soul 人格、`clawdsh:memory-recall` 段、`memory_search`/`memory_get` 工具与 skills 目录，外加全套 standard 工具。
- Web server 独立于可选外部集成启动。干净安装默认禁用 OpenClaw Gateway 与 Automation；显式启用锁定 Gateway 后保留其 fail-closed 准入与配置校验。
- `soul` 保留 `mode: append`；若 web-runtime 的「coding agent」段漏进组装后的 prompt，则把 `soul` 切 `mode: replace`（complete persona 会同时抑制 host 默认与 web-runtime 段）。

## 考虑过的替代方案

**自建 ClawDSH GUI 插件。** 否决：dsh 已交付完整浏览器控制台（webserver、client roster、API gateway）；再做一个 GUI 只会全部重复、零能力收益。

**保留 `standard` 预设、只覆盖其 persona。** 否决：web bundle 禁用了 host-plane 工具行，`standard` 预设是 GUI 下暴露 shell/fs/skills 的唯一来源；把它复制进 `clawdsh` 预设、用 soul 换 persona，既保住 ClawDSH 身份又不分叉工具接线。

**只在 UI 里逐会话选 preset、不改默认。** 仅作为补充路径否决：逐会话选择仍保留，但设 `default: clawdsh` 让 GUI 无需手动步骤即呈现 `ClawDSH 模式`。
