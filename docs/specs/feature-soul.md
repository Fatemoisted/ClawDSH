# 功能规格：Soul（人格系统）

- **状态**：implemented（阶段 0 Spike ✅，2026-08-14）
- **实现包**：`packages/openclaw/soul`（`@clawdsh/dsh-soul`）
- **OpenClaw 对应**：Soul 系统（人格、口吻、行为准则）。基线出处：OpenClaw `v2026.1.5`（`197b8f7c3b`）的 `src/agents/` identity 机制——具体形态待阶段 2 深读后补细节（见 docs/matrix/parity.md）。

## 目标

- 每个 agent 可绑定一个"人格"：一段可版本化、可分享的人格定义（自述、口吻、行为准则、默认回复习惯）；
- 人格作为 dsh system-prompt 装配的 provider 挂载：替换/叠加默认系统提示词；
- 人格切换热插拔：卸载即回卷，无需重启；
- 人格内容通过 profile/patch 配置，不改上游源码。

## 非目标

- 不做人格市场/分享协议（后续可复用 ClawHub 式分发，另立规格）；
- 不做多智能体间的人格社交（阶段 3 后再议）；
- **文件路径随 preset 目录解析**（当前 `source` 相对 process.cwd()）——阶段 2 待办，见 packages/openclaw/preset-openclaw/README.md；
- 不做灵魂文件热重载（挂载即定格，与上游 KV 前缀稳定设计一致；换灵魂 = 重挂载）。

## 接缝（Spike 已确认）

`ctx.systemPrompt`（`@deepseek-ai/dsh-system-prompt`）：`section({name, order, text, complete?})` 贡献有序提示段（order 0 = 部署人格，100–199 = 工具指引；`complete` 段在装配后成为唯一提示）。作用域用 `@deepseek-ai/dsh-scope` 的 `createScope`/`scopeOf` 实现（scope-only 行，与上游 `dsh-persona` 同构）。

**结论：接缝假设成立**——不需要改上游一行源码，soul 作为独立行挂载即可替换/叠加人格。

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

**阶段 0 退出标准达成：接缝假设成立，项目继续。**
