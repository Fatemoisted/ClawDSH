# Agent Note: ClawDSH 身份与安全的干净安装默认值

Status: implemented

[English](2026-08-15-clawdsh-identity-and-safe-defaults.md) | 中文

## 问题

本地 GUI 组合以 profile 与 preset id `openclaw` 安装，显示为 OpenClaw 形态，并通过 `tools/link-openclaw.sh` 刷新。这些名称把上游功能来源误作 ClawDSH 产品身份。profile 还默认挂载飞书，因此其凭据校验会阻止没有渠道凭据的干净 home 启动 Web Host。

改名已安装资产还带来另一项兼容风险：既有 Session 可能持久化旧 preset id，用户所有的 `openclaw` profile 或 preset 目录也可能包含本地修改。产品改名不得静默设置别名、接管、改写、移动或删除这些资产。

## 决策

安装后的 profile id、agent preset id 与默认 preset 统一为 `clawdsh`；preset 标签为 `ClawDSH 模式`；本地开发刷新入口为 `tools/link-clawdsh.sh`。物理源码目录保留 `tools/openclaw-preset-openclaw/`，因为仓库检查识别该路径。目录名属于内部实现，不定义产品文案、安装 id 或兼容别名。只有功能来源、上游字面路径等需要来源说明时，OpenClaw 才继续作为上游名称出现。

profile 保持 `channel-core` 挂载，但把飞书、Telegram、Discord 与 Automation Loader entry 标为 disabled。因此干净 home 无需飞书、Telegram、Discord、Ark 或 automation 凭据即可启动 Web 应用，也不会产生外部渠道或定时运行副作用。启用带凭据的适配器仍是显式配置动作；适配器挂载后继续执行既有的 fail-loud 凭据校验。

`tools/link-clawdsh.sh` 在安装新资产前检查旧 `$DSH_HOME/profiles/openclaw/` 与 `$DSH_HOME/.agent-presets/openclaw/` 路径。任一路径存在时，它打印迁移说明，并让两者保持原样。ClawDSH 不安装 `openclaw` 别名，脚本也绝不自动删除、移动、改写或接管旧目录。只要已保存 Session 仍引用旧 id，用户就保留旧 preset。

ClawDSH preset 仍是 dsh 用户 preset 根目录中的受管副本；它不具备 system-trusted 或不可删除属性，原生 Harness 控件仍可移除它。[产品壳提案](../../proposed/architecture/2026-08-15-clawdsh-product-shell.md)不向 ClawDSH 产品 UI 提供删除入口，但不改变该信任模型。本增量不交付产品壳、`clawdsh` 可执行文件、`clawdsh doctor` 或受管安装 manifest；可用的修复路径是重新运行开发刷新脚本。公共发行增量负责基于 manifest 的安装与 doctor 修复。

## 考虑过的替代方案

**把 `openclaw` 保留为受支持别名。** 否决：两个持久 id 会让产品身份含混，并迫使所有安装器、Session selector、诊断与未来设置页面无限期定义优先级。

**自动重命名或删除旧目录。** 否决：恢复已保存 Session 可能仍需旧 preset，任一目录也可能属于用户。用精确路径警告能保留可恢复性，并把清理决定留给用户。

**随安装 id 一并重命名 `tools/openclaw-preset-openclaw/`。** 本增量否决：仓库检查当前识别该物理组装路径。保留一个明确属于内部的源码路径，避免把身份改动扩大到根检查或上游自有配置。

**发现对应环境变量后自动启用渠道适配器。** 否决：干净安装行为会依赖环境中的凭据，并可能意外启动外部 listener。默认 disabled 使每项外部副作用都必须显式开启。

## 影响

- 新开发安装在命令、profile、preset、默认选择与可见标签上使用同一产品身份。
- 干净 home 的 GUI 启动不依赖可选渠道和 automation 凭据；本增量中这些能力在 Loader 层保持 opt-in。
- ClawDSH 冒烟工作流运行无密钥真实 profile 浏览器测试：从空 dsh home 启动构建后的 Host，并对可见的 `ClawDSH 模式` 入口和已选 `clawdsh` preset id 做快照。其 `gui-tests/` 源码使用专用 TypeScript program，不进入根 Host aggregate。
- 既有 `openclaw` 资产会收到警告，但不获得兼容承诺或自动生命周期管理。
- 普通 dsh 用户 preset 的信任模型保持可见：Harness 自有控件仍可删除该 preset，ClawDSH 产品 UI 不增加删除入口，重新运行 `tools/link-clawdsh.sh` 可修复开发安装。
- 正式 `clawdsh doctor` 命令与受管安装 manifest 暂不提供，直至公共发行增量定义其所有权与覆盖策略。
