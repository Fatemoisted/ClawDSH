# Agent Note: OpenClaw identity 机制 → dsh soul 形态映射

Status: implemented

[English](2026-08-14-openclaw-identity-mapping.md) | 中文

## 问题

对齐矩阵的 soul 行把具体形态留作「具体形态阶段 2 深读」。`@clawdsh/dsh-soul` spike（system-prompt 接缝上的 replace/append 双模式）建于阶段 0，当时尚未深读 OpenClaw 的 identity 机制。阶段 2 需要决定最终形态：replace/append 是否完整表达 OpenClaw 的 identity 机制，还是 soul 需要补结构？

## 决策

深读 OpenClaw `v2026.1.5`（`197b8f7c3b`）确认 identity 由四层组装，全部在 `src/agents/`——gateway（`src/gateway/`）没有任何 prompt 装配代码：

1. `src/agents/system-prompt.ts` 里的一行硬编码开场（"You are Clawd, a personal assistant running inside Clawdbot."）。
2. 六个用户可编辑的 workspace 文件——`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`BOOTSTRAP.md`——首次启动时从模板写入（`flag: "wx"`，永不覆盖），并以 `## <文件名>` 段落注入 `# Project Context`。
3. 配置项 `identity.name/theme/emoji`，从不进 prompt；只驱动渠道呈现（mention 正则、消息前缀、ack 表情）。
4. 每次运行的场景文本（`extraSystemPrompt`，如群聊简介），渲染为独立段落。

soul 的最终形态就是现有 spike，不改动。replace/append 已完整覆盖机制中「承载人格」的部分；其余部分映射到 dsh 已有接缝：

| OpenClaw identity 组成部分 | dsh 对应落地 |
|---|---|
| 硬编码首行 | `deployment:persona` 段（order 0）——显式部署配置，而非硬编码文本 |
| `SOUL.md` 人格 | soul `append`——`clawdsh:soul` 段（order 10），在部署人格之后、工具指引之前 |
| 「灵魂即完整系统提示」的极简形态 | soul `replace`——`deployment:persona` 上的 `complete` 段，装配后唯一提示 |
| `AGENTS.md` 操作指令 | dsh 无独立接缝；由 ClawDSH 的 preset soul 文本承载（上游 `agent-instructions` 覆盖的是 workspace 指令，属另一表面） |
| `TOOLS.md` 工具使用偏好 | 既有工具指引带（order 100–199）；各工具包自带段落，soul 无需为此补结构 |
| `IDENTITY.md` 名字/物种/vibe/emoji | 渠道呈现，不进 prompt——与 OpenClaw 经 config identity 保持的切分一致；ClawDSH 渠道适配器暂未做昵称/头像映射（延后） |
| `USER.md` 用户画像 | 用 preset 的 persona/soul 文本即可表达；无需结构 |
| `BOOTSTRAP.md` 首启仪式 | 冷启动引导的锦上添花；ClawDSH 由 preset 显式提供灵魂，不存在冷启动场景——非目标 |
| 每次运行的场景段（群聊简介） | dsh `PromptContext` / 渠道入站上下文，不属于 soul |
| `system-prompt-report.ts`（每轮注入文件清单入 session store） | dsh 已成立：`request/header.header.system` 经 agent-loop → session log 记录渲染后的系统提示，「model-visible means logged」无需新事件 |

为何不补结构：

- **模板自举（`flag: "wx"` 一次性模板写入）。** OpenClaw 需要它，因为首启向导没有 preset。ClawDSH 通过 preset/profile 显式下发灵魂，ensure-if-missing 没有适用场景。
- **`[MISSING] Expected at:` 占位符。** 静默占位把「缺失的身份」放进 prompt，并诱导模型自行补一个。dsh 的文化是配置错误 fail-loud，而 soul spike 已在空文本或缺失文件时抛错——保持 fail-loud。

本次交付 soul 代码零改动；映射关系落文档：`docs/specs/feature-soul.md`、对齐矩阵、soul README。

## 考虑过的替代方案

**新增 identity seam（身份注册表服务）。** 否决：OpenClaw identity 的每个部分都映射到 dsh 既有接缝（`system-prompt`、`context`、`channels`）；不存在需要新 seam 承载的能力面。

**移植模板自举与 `[MISSING]` 占位符。** 否决：自举服务于 OpenClaw 无 preset 的首启，ClawDSH 不存在该场景；占位符与 fail-loud 冲突，且 spike 已对空/缺失灵魂响亮失败。

**把 `IDENTITY.md`（名字/emoji）放进 prompt。** 否决：OpenClaw 刻意把身份配置留在 prompt 之外、用于渠道呈现（mention 正则、`[Name]` 前缀、ack 表情）。ClawDSH 保持同一切分；呈现工作延后给渠道包。

**每请求动态装配身份（provider 求值段）。** 否决：破坏 KV 前缀稳定；soul 文本挂载时读取一次，与上游 persona 一致，换灵魂即重挂载。

**对 identity seam 走 upstream-first 提案。** 不适用：不需要新 seam；映射完全落在既有 `system-prompt` 接缝上，ADR → 上游 PR → patch 过渡流程不触发。

## 影响

- 映射表是 soul 包与渠道包的身份事实源；上游 identity 演进时（如 `v2026.1.15` 的 per-agent identity 与重写的 `src/agents/system-prompt.ts`）据此对照复查。
- 身份渠道呈现（名字前缀、ack 表情）是显式延后事项，记录在对齐矩阵 soul 行。
- soul 保持双模式段插件；未来若需多文件身份段，回到本 Note 重新论证而非默认补结构。
