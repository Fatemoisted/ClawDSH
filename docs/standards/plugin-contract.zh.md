# 插件契约规范（plugin-contract）

[English](plugin-contract.md) | 中文

> 本规范是 ClawDSH 插件开发的宪法：一切自有代码遵守，一切社区 PR 以此为准入门槛。理论基础：dsh 的 Cordis 框架（`docs/cordis-primer.md`、`docs/capability-seams.md`）。

## 1. 基本形态

- 一个功能 = 一个包（`packages/openclaw/<pkg>/`），包名 `@clawdsh/dsh-<kebab-case>`；
- 插件 = 一个 Cordis plugin：`inject` 声明依赖 + `apply(ctx)` 挂载，禁止手动引导顺序；
- 复制 `tools/openclaw-plugin-template/` 起步，按 `packages/openclaw/README.md` 的接入流程注册。

## 2. 依赖声明（inject）

- 只依赖 seam 服务 key（`ctx.tools`、`ctx.llm`、`ctx.sessions`…），**禁止跨包 import 具体实现**；
- 依赖即契约：inject 列表只增不减；减少依赖视为破坏性变更，需在包 README 声明迁移说明。

## 3. 事件与 effect

- 观察用 `emit`，拦截/策略用 `waterfall`/`serial`，分发用 `parallel`；
- 一切注册必须可逆：`ctx.effect()` / `ctx.on()` 返回 disposer，卸载自动回卷；同一功能的关联注册放同一个 effect 里，保证回卷顺序；
- 禁止全局副作用：不写全局变量、不 monkey-patch、不依赖进程启动顺序。

## 4. 日志不变式（最高优先级）

- **"model-visible means logged"**：任何进入模型视野的内容（含渠道消息、记忆检索结果、技能内容）必须能由 session log 重建；
- 插件产出的持久数据要么走 session 事件，要么走声明的持久化 seam，禁止私建旁路存储。

## 5. 新 seam 的准入

新增 `ctx.*` 服务是最高成本变更，流程强制：

1. 写 ADR（模板见 `docs/adr/0001-project-foundation.md` 顶部）；
2. 契约草案在 ADR 中给出（接口 + 最小面）；
3. **upstream-first（有例外）**：默认先向 dsh 上游提 PR、本地以 profile patch 过渡；但发起人 2026-08-14 决定跳过上游 PR、快速推进（见 ADR-0002 决策 4），`ctx.channels` 作为 ClawDSH 自有 seam 长期保留；
4. 新 seam 未获批前，功能冻结，不得绕过。

## 6. 契约测试（合入门槛）

每个包必须提供：

- **契约测试**：对自己实现的 seam 接口跑通最小行为面（挂载 → 行为 → 卸载回卷）；
- **profile 冒烟**：`pnpm dsh --profile openclaw --dump-config` 能解析出该包的挂载行；
- 渠道类插件：一次入站 → 一次出站的端到端会话测试（可 mock 渠道 API）。

## 7. 公开面变更

- 包对外 API（exports、服务 key、事件名）变更必须在 README 的变更说明段记录；
- 参考上游惯例：改公开行为同步更新 owning README/JSDoc。

## 8. OpenClaw 功能移植原则（先看实现，再接入 Cordis）

移植 OpenClaw 的功能到 dsh 时，顺序固定为**先看上游实现，再设计 Cordis 接入**：

1. **先读 OpenClaw 上游如何实现**：定位该功能在 OpenClaw 源仓库的出处（`src/`、`extensions/<name>/`，基线出处见 `docs/matrix/parity.md`），搞清它用哪个官方 SDK/依赖、订阅哪些事件、申请哪些权限/scope、处理哪些边界（幂等、去重、限流、长连接 vs webhook）；
2. **再选 Cordis 接入形态**：确定落到哪个既有 seam（或按第 5 节 ADR 流程新增 seam），按第 1 节「一个功能 = 一个包」、第 2 节依赖声明、第 4 节日志不变式，落一个最小面适配器；
3. **优先复用上游已证明的 SDK/依赖**：上游踩过坑的库（飞书 `@larksuiteoapi/node-sdk`、Telegram `grammy`）优先采用，**禁止手搓底层协议**——除非上游无对应 SDK 且手写能显著删代码。这既是「prefer maintained dependencies over hand-rolling」，也避免重蹈上游踩过的坑。

动机：OpenClaw 的渠道接入有大量非显而易见的繁琐程序（权限、长连接、事件格式、幂等），手搓极易出错；先看上游实现能继承这些已验证的决策，再裁剪成 Cordis 的最小面。
