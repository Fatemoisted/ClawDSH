# Agent Note: soul `source` 按挂载树的 `ctx.baseUrl` 解析

Status: implemented

[English](2026-08-14-soul-preset-relative-source.md) | 中文

## 问题

`@clawdsh/dsh-soul` 的 `source` 配置相对 `process.cwd()` 解析，导致 preset 内自带的灵魂文件无法用相对路径引用——daemon 的 cwd 与 preset 目录毫无关系。阶段 2 待办即「文件路径随 preset 目录解析」。preset 的灵魂应随 preset 走（preset 自带 `souls/assistant.md`；`copyComposition` 会复制整个组合目录）。

## 决策

在 `apply` 里把相对 `source` 按上下文自身的挂载锚点 `ctx.baseUrl` 解析：

```ts ignore-check
const base = ctx.baseUrl === undefined ? undefined : fileURLToPath(ctx.baseUrl)
const text = config.source ? readFileSync(resolve(base ?? '.', config.source), 'utf8') : (config.text ?? '')
```

`ctx.baseUrl` 是现成的 Loader seam，代表配置树的目录：`Include` 把每个配置文件加载时把 baseUrl 重写到该文件所在目录，agent preset 经 `PresetTree extends Include` 继承该行为（`agent.cordis.yml` 子树内即组合目录），profile 启动器则把根 `cordis.yml` 写进 profile 目录以锚定 baseUrl。上游已有两个插件把 `ctx.baseUrl` 当作配置树锚点（`typert-loader`、`client-modules`），soul 是加入既有模式而非自创。

刻意保持的语义：
- 绝对 `source` 路径行为不变（`resolve(base, absolute)` 返回绝对路径本身）；
- 无 base 的上下文（裸 `new Context()` 测试或非 Loader 组合）回退 `process.cwd()`，一切既有挂载方式照旧；
- fail-loud 不变：文件缺失仍由 `readFileSync` 抛错，空灵魂仍拒绝。

bundle patch 层提供的行落在根树上，其相对 `source` 解析到 profile 目录而非 bundle 包目录——与相对模块说明符在 Loader 下的语义一致，已写入 soul README。

## 考虑过的替代方案

**纯配置 `!!js` 绕行。** 否决：`source: !!js dshHomePath('profiles/openclaw/souls/assistant.md')` 硬编码 profile 名且只覆盖 profile 安装形态；`new URL('souls/assistant.md', ctx.baseUrl)` 需百分号解码且在 Windows 上坏掉。它们今天能用，但对 preset 消费者不如 seam 本身。

**在 `dshHomePath` 旁加 profile 目录 helper。** 否决：只解决 profile 路径（不覆盖任意 `.agent-presets/<id>/` 安装）且硬编码目录布局；`ctx.baseUrl` 已同时覆盖两种安装形态。

**Loader 内做逐行来源追踪（记录每行来自哪个文件）。** 否决：唯一具备完整层来源的方案，但要动两个 vendor 包（`vendor/loader`、`vendor/include`）、需登记本地修改，且 bundle 相对灵魂成为真实需求前不必要。

## 影响

- preset 可以写 `source: ./souls/assistant.md`，灵魂随 preset 走（`clawdsh` preset 正是如此）；
- 相对路径语义与 Loader 下相对模块说明符一致——一条锚点规则取代插件私有 cwd 规则；
- bundle patch 层的注记是文档化限制而非回归：改动前那些行同样按 cwd 解析，并不更好。
