# 功能规格：Soul（人格系统）

[English](feature-soul.md) | 中文

- **状态**：implemented（阶段 0 Spike ✅ + 阶段 2 深读定稿 ✅，2026-08-14）
- **实现包**：`packages/openclaw/soul`（`@clawdsh/dsh-soul`）
- **OpenClaw 对应**：Soul 系统（人格、口吻、行为准则）。基线出处：OpenClaw `v2026.1.5`（`197b8f7c3b`）`src/agents/` 的 identity 机制（`system-prompt.ts` 首行 + workspace 六文件）。阶段 2 深读结论：replace/append 已完整表达该机制，「具体形态」定稿为现有 spike 不变——完整映射见 Agent Note [2026-08-14-openclaw-identity-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping.md)。

## 目标

- 每个 agent 可绑定一个"人格"：一段可版本化、可分享的人格定义（自述、口吻、行为准则、默认回复习惯）；
- 人格作为 dsh system-prompt 装配的 provider 挂载：替换/叠加默认系统提示词；
- 人格切换热插拔：卸载即回卷，无需重启；
- 人格内容通过 profile/patch 配置，不改上游源码。

## 非目标

- 不做人格市场/分享协议（后续可复用 ClawHub 式分发，另立规格）；
- 不做多智能体间的人格社交（阶段 3 后再议）；
- ~~文件路径随 preset 目录解析~~（阶段 2 收尾已实现：相对 `source` 按挂载树 `ctx.baseUrl` 解析，见 Agent Note 2026-08-14-soul-preset-relative-source）；
- 不做灵魂文件热重载（挂载即定格，与上游 KV 前缀稳定设计一致；换灵魂 = 重挂载）；
- **不做模板自举（`flag:"wx"` 首启写模板）**：OpenClaw 需要它是因为首启向导没有 preset；ClawDSH 经 preset/profile 显式下发灵魂，ensure-if-missing 无适用场景；
- **不做 `[MISSING] Expected at:` 占位符**：静默占位会把缺失的身份放进 prompt；dsh 文化是 misconfiguration fail-loud，soul 已对空文本/缺失文件抛错，保持一致。

## 接缝（Spike 已确认）

`ctx.systemPrompt`（`@deepseek-ai/dsh-system-prompt`）：`section({name, order, text, complete?})` 贡献有序提示段（order 0 = 部署人格，100–199 = 工具指引；`complete` 段在装配后成为唯一提示）。作用域用 `@deepseek-ai/dsh-scope` 的 `createScope`/`scopeOf` 实现（scope-only 行，与上游 `dsh-persona` 同构）。

**结论：接缝假设成立**——不需要改上游一行源码，soul 作为独立行挂载即可替换/叠加人格。

### 阶段 2 深读定稿：OpenClaw identity 映射

OpenClaw identity 由四层组成（gateway 无装配代码，全部在 `src/agents/`）：硬编码首行 → `deployment:persona`（order 0）；`SOUL.md` → soul `append`（order 10）；「灵魂即完整提示」→ `replace`=complete 段；`AGENTS.md` → preset soul 文本承载；`TOOLS.md` → 工具指引带（100–199，各工具包自带）；`IDENTITY.md`（name/emoji）→ 渠道呈现非 prompt，经 channel-core `identity`/`responsePrefix`/`ackReaction` 配置（阶段 3 ✅，见 [Agent Note](../../.agents/notes/implemented/feature/2026-08-14-channel-identity-presentation.md)）；`USER.md` → preset persona/soul 文本；每次运行的场景段 → `PromptContext`；`system-prompt-report` → `request/header.header.system` 日志链路。完整映射表与「为何不补」论证见 [Agent Note](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping.md)。

## 配置面（草案）

```yaml
soul:
  enabled: true
  source: ./souls/<name>.md        # 或远端 URL / ClawHub 引用
  # 叠加模式：replace（替换默认系统提示）| append（追加段落）
  mode: replace
```

## 验收标准（阶段 0 结论）

1. ✅ **替换系统提示词**：replace 模式下灵魂成为完整系统提示（测试：`replace mode: the soul is the complete system prompt`，renderPrompt 精确等于灵魂文本）；
2. ✅ **热插拔**：fiber dispose 后提示恢复默认（测试：`restores the default prompt when its fiber unloads`）；两个作用域人格互不干扰（`gives two scopes independent souls`）；
3. ✅ **不改上游源码**：仅新增 `packages/openclaw/soul` + 构建注册（tsconfig paths/reference，属 ADR-0001 豁免）；全量 `pnpm typecheck` 绿；
4. ✅ **日志不变式**：灵魂文本是 prompt section，参与装配即进入 session 事件流（由上游 session 机制保证，"model-visible means logged"）；
5. ✅ **profile 层叠**：`--profile openclaw --dump-config` 解析出 dsh-base + dsh-headless + 我们的 persona 覆盖（冒烟通过）。
6. ⏳ `--profile openclaw` 下**真实 agent 挂载 preset**：属阶段 2（headless 形态的 preset 接线），见 preset-openclaw/README.md。
7. ✅ **identity 映射文档化（阶段 2 深读定稿）**：OpenClaw identity 四层结构到 dsh 接缝的完整映射落于 Agent Note（`.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping`）、本规格与 parity 矩阵三处一致；soul 代码零改动。
8. ✅ **文件路径随 preset 目录解析（阶段 2 收尾）**：相对 `source` 以挂载树 `ctx.baseUrl` 为锚解析（preset → 组合目录、profile → profile 目录、裸上下文 → cwd 回退）；测试 12 例含 baseUrl 相对解析与 cwd 回退两例。

**阶段 0 退出标准达成：接缝假设成立，项目继续。阶段 2 深读定稿：replace/append 形态即最终形态。**
