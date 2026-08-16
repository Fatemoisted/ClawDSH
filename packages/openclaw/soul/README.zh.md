# @clawdsh/dsh-soul

[English](README.md) | 中文

**定位**：人格系统（Soul）——OpenClaw 的 Soul 概念在 dsh system-prompt 接缝上的落地：每个 agent 作用域可挂载一个"灵魂"（Markdown 文件或内联文本），成为该 agent 的系统提示词身份。这是 ClawDSH 阶段 0 Spike 的验证对象。

**OpenClaw 对应**：Soul 系统（人格、口吻、行为准则）。基线出处：OpenClaw `v2026.1.5` `src/agents/` 的 identity 机制（见 docs/matrix/parity.md）。阶段 2 深读定稿：replace/append 即最终形态，映射见下方「OpenClaw identity 映射」。

**接缝**：`ctx.systemPrompt`（`@deepseek-ai/dsh-system-prompt`）+ `@deepseek-ai/dsh-scope` 的作用域原语。**不新增 seam**。与上游 `@deepseek-ai/dsh-persona` 同构（scope-only 行），差异在于：文本来自灵魂文件 + `append` 模式作为独立段落叠加（保留部署人格），而非仅影子替换。

**规格**：docs/specs/feature-soul.md · **状态**：implemented（Spike ✅）

## 使用

挂载在 agent 作用域内（即 agent preset 的 `agent.cordis.yml` 里，见 `../preset-openclaw/`）：

```yaml
- id: soul
  name: '@clawdsh/dsh-soul'
  config:
    enabled: true                 # false skips the Soul section for new sessions
    source: ./souls/assistant.md   # 相对当前 preset/profile 组装目录；优先于 text
    # text: 也可以直接内联
    mode: replace                  # replace=灵魂即完整系统提示；append（默认）=叠加段落
    includeRuntimeContext: true    # false 时抑制该作用域的运行时上下文快照
```

Host 仅挂载一次 `@clawdsh/dsh-soul/settings-host`，由它独占 `clawdsh-soul` 设置 namespace。每个 agent scope 只在挂载时读取该用户层，因此修改只影响新会话，不会改写运行中会话的 prompt。

## OpenClaw identity 映射（阶段 2 深读定稿）

OpenClaw 的 identity 由四层组成（`src/gateway/` 无装配代码，全部在 `src/agents/`），soul 的 replace/append 已完整覆盖其中「承载人格」的部分，其余映射到 dsh 既有接缝——完整论证见 [Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping.md)：

| OpenClaw identity 组成部分 | dsh 对应落地 |
|---|---|
| `system-prompt.ts` 硬编码首行 | `deployment:persona`（order 0，显式部署配置） |
| `SOUL.md` 人格 | soul `append`（`clawdsh:soul`，order 10） |
| 「灵魂即完整系统提示」极简形态 | soul `replace`（complete 段独占） |
| `AGENTS.md` 操作指令 | preset soul 文本承载 |
| `TOOLS.md` 工具使用偏好 | 工具指引带（order 100–199，各工具包自带） |
| `IDENTITY.md` name/emoji | 渠道呈现，非 prompt（Deferred） |
| `USER.md` 用户画像 | preset persona/soul 文本 |
| `BOOTSTRAP.md` 首启仪式 | 非目标（preset 显式下发灵魂，无冷启动场景） |
| 每次运行的场景段 | `PromptContext`（不属于 soul） |
| `system-prompt-report` | `request/header.header.system` 日志链路（已成立） |

不补模板自举与 `[MISSING]` 占位符：前者服务于无 preset 的首启（ClawDSH 不存在该场景）；后者与 dsh fail-loud 文化冲突（soul 已对空文本/缺失文件抛错）。

## 设计要点

- **scope-only**：无作用域挂载直接报错（避免发布进程级灵魂），与上游 persona 的约束一致；
- **挂载即定格**：灵魂文本在挂载时读取一次，运行期不变——提示前缀稳定，KV 缓存复用不受影响（沿用上游设计）；换灵魂 = 重新挂载（patch + 会话重启）；
- **Host 独占设置**：一个 Host singleton 注册 namespace；Session 行只消费挂载时快照，`enabled: false` 不贡献 prompt 段；
- **关闭即无副作用**：关闭的 Soul 快照不需要占位 `source` 或 `text`；只有新 Session 真正启用 Soul 时才要求非空白内容；
- **相对 source 按挂载树解析**：相对路径以 `ctx.baseUrl` 为锚——agent preset 里即组合目录（preset 目录随 `copyComposition` 传播，灵魂文件跟着走）、profile 启动器下即 profile 目录；无 baseUrl 的裸上下文回退 `process.cwd()`。与相对模块说明符同语义（typert-loader/client-modules 同款 seam）；
- **可逆**：全部注册走 `ctx.effect()`，卸载即回卷（热插拔）；
- **日志不变式**：灵魂文本作为 prompt section 参与装配，"model-visible means logged" 由上游 session 机制保证。

## 变更说明

- 0.1.0：Spike 初始实现（replace/append 双模式 + 文件加载 + 契约测试）。
- 0.1.0（2026-08-14 深读定稿）：OpenClaw identity 映射文档化（README/规格/矩阵三处一致），代码零改动。
- 0.1.0（2026-08-16 干净配置修正）：关闭设置不再要求占位内容，纯空白内容在挂载时拒绝，纯空白 `source` 改为回退到内联 `text`。

## Model Experience

### The soul section

#### What the model sees

The soul text (from `source` file or inline `text`) is added as an ordered system-prompt section through `ctx.systemPrompt.section(...)`. In `replace` mode the model sees only the soul text as the system prompt; in `append` mode it appears as a section alongside the deployment persona.

#### Token effect

Fixed per mounted scope: the soul's own tokens appear on every request an agent in that scope makes, and none for agents outside it. A disabled Soul contributes nothing; enabled empty or whitespace-only content fails at mount.

#### KV Cache effect

Prefix-stable for the life of an agent — the text is read once at mount, before the first request, and never changes while the agent runs.

## Known Limitations and Deferred Work

- **挂载即定格**：灵魂文本在挂载时读取一次，运行期不变；换灵魂需重新挂载 + 会话重启。
- **scope-only**：无作用域挂载直接报错，避免发布进程级灵魂（与上游 persona 约束一致）。
- **bundle patch 层的相对 source**：由 bundle patch 层提供的行解析到 profile 目录（根树的 baseUrl），不是 bundle 包目录——与相对模块说明符语义一致，非缺陷。
- **真实 e2e**：系统提示装配的组装测试需真 key，当前以契约测试（20 例）覆盖。
