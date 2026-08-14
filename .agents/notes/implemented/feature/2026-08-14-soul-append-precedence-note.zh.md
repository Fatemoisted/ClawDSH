# Agent Note: Soul append 模式新增 OpenClaw 风格优先级声明

Status: implemented

[English](2026-08-14-soul-append-precedence-note.md) | 中文

## 问题

OpenClaw 把每个 soul.md 注入系统提示词时自带一句优先级声明："SOUL.md: persona/tone. Follow it unless higher-priority instructions override."。ClawDSH 的 append 模式此前把灵魂文本裸注册为 `clawdsh:soul` 段——装配后的提示词里没有任何内容告诉模型人格在指令层级中的位置（可能被解读为压过用户的直接指令），且渲染结果偏离所跟踪的 OpenClaw 基线。replace 模式本身让灵魂成为完整系统提示（比任何声明都强），且其精确渲染契约禁止添加文本，因此声明只属于 append 模式。

## 决策

包导出常量 `SOUL_PRECEDENCE_NOTE` —— "Soul: persona and tone. Follow it unless higher-priority instructions (such as direct user instructions) override it."——保留 OpenClaw 语义骨架，去掉文件名前缀（灵魂可为内联文本），括号示例复用 dsh 既有词汇 "direct user instructions"，两处优先级文本互不矛盾。`Config` 新增 `precedenceNote?: boolean`（schema 默认 `true`，与 `includeRuntimeContext` 同款布尔风格）。`apply()` 仅 append 模式、空文本检查之后、注册段落之前，前置 `NOTE + '\n\n' + text`；replace 模式永不添加。模型可见文本由 soul 测试与 README Model Experience 逐字钉住。

## 曾考虑的替代方案

- **逐字照抄 OpenClaw 原文**——否决。`SOUL.md:` 前缀指代文件名，内联文本灵魂没有该文件；`persona/tone` 形似路径。
- **不带括号示例的声明**——否决。省约 6 token，但失去词汇锚点：dsh 自身的工作区上下文引言已用 "direct user instructions"。
- **声明独立成 order-9 段**——否决。渲染等价，但多一个注册名和 dispose 路径，无收益。
- **恒开无开关**——否决。部署可变的选择必须是可校验的 Config 字段（禁硬编码可调项），且 replace 模式必须保持字节精确。
- **声明烘焙进灵魂文件格式**——否决。把声明耦合进文件格式升级，并破坏 replace 模式的精确渲染契约。

## 后果

- append 模式灵魂每请求多约 20 token；`precedenceNote: false` 可去掉，replace 模式从不添加。
- 声明在挂载时烘焙于灵魂文本之前，渲染段保持前缀稳定；换 flag 或换灵魂是挂载期配置变更（重新挂载）。
- 新增一个导出常量 + 一个 schema 字段；模块 JSDoc、README、功能规格共同记录三种状态。

## 验证

- `packages/openclaw/soul/tests/soul.spec.ts` 契约测试 13 个：新增 3 个（`precedenceNote: false` 裸文本、replace 双 flag 免疫、apply 级兜底），另有 5 处既有断言钉在带声明文本上；`src/index.ts` 语句/分支/函数/行覆盖 100%。
- soul README 通过 `verify-package-readme-model-experience` 与 `verify-package-readme-limitations`（新增含逐字声明围栏的 Model Experience 条目 + Known Limitations 节）。
- `pnpm run typecheck` 保持全绿；`--dump-config` 冒烟不受影响。
