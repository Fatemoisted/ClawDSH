# @clawdsh/dsh-soul

**定位**：人格系统（Soul）——OpenClaw 的 Soul 概念在 dsh system-prompt 接缝上的落地：每个 agent 作用域可挂载一个"灵魂"（Markdown 文件或内联文本），成为该 agent 的系统提示词身份。这是 ClawDSH 阶段 0 Spike 的验证对象。

**OpenClaw 对应**：Soul 系统（人格、口吻、行为准则）。基线出处待阶段 1 定稿后补链接（见 docs/matrix/parity.md）。

**接缝**：`ctx.systemPrompt`（`@deepseek-ai/dsh-system-prompt`）+ `@deepseek-ai/dsh-scope` 的作用域原语。**不新增 seam**。与上游 `@deepseek-ai/dsh-persona` 同构（scope-only 行），差异在于：文本来自灵魂文件 + `append` 模式作为独立段落叠加（保留部署人格），而非仅影子替换。

**规格**：docs/specs/feature-soul.md · **状态**：implemented（Spike ✅）

## 使用

挂载在 agent 作用域内（即 agent preset 的 `agent.cordis.yml` 里，见 `../preset-openclaw/`）：

```yaml
- id: soul
  name: '@clawdsh/dsh-soul'
  config:
    source: ./souls/assistant.md   # 相对 process.cwd()；优先于 text
    # text: 也可以直接内联
    mode: replace                  # replace=灵魂即完整系统提示；append（默认）=叠加段落
    includeRuntimeContext: true    # false 时抑制该作用域的运行时上下文快照
```

## 设计要点

- **scope-only**：无作用域挂载直接报错（避免发布进程级灵魂），与上游 persona 的约束一致；
- **挂载即定格**：灵魂文本在挂载时读取一次，运行期不变——提示前缀稳定，KV 缓存复用不受影响（沿用上游设计）；换灵魂 = 重新挂载（patch + 会话重启）；
- **可逆**：全部注册走 `ctx.effect()`，卸载即回卷（热插拔）；
- **日志不变式**：灵魂文本作为 prompt section 参与装配，"model-visible means logged" 由上游 session 机制保证。

## 变更说明

- 0.1.0：Spike 初始实现（replace/append 双模式 + 文件加载 + 契约测试）。
